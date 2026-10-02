import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { compilePhase3BContent } from '../dist/node/content/phase3b.js';
import { PHASE3A_RULES_HASH } from '../dist/node/sim/fighter-state.js';
import { hashCanonical } from '../dist/node/math/hash.js';
import { Xoshiro128ss, deriveSeed } from '../dist/node/math/random.js';

const { values } = parseArgs({ options: { 'implementation-commit': { type: 'string' } } });
if (values['implementation-commit']) assert.match(values['implementation-commit'], /^[0-9a-f]{40}$/);
const root = 'artifacts/phase-3b';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const reportNames = ['unit-tests', 'boundaries', 'evaluation', 'correctness', 'browser', 'review', 'cost', 'legacy'];
const reports = Object.fromEntries(await Promise.all(reportNames.map(async name => [name, await json(`${root}/${name}.json`)])));
const { evaluation, correctness, browser, review, cost, legacy, 'unit-tests': unit } = reports;
const content = compilePhase3BContent(await json('content/fighter-phase3b.json'));
assert(unit.success && unit.numFailedTests === 0);
for (const name of ['boundaries', 'evaluation', 'correctness', 'browser', 'cost', 'legacy']) assert.equal(reports[name].passed, true, name);
for (const report of [evaluation, correctness, cost]) assert.equal(report.contentHash, content.bundleHash);
assert.equal(evaluation.configs, 200); assert.equal(evaluation.executions, 400);
assert.equal(evaluation.off.invalid + evaluation.pace.invalid, 0);
assert.equal(correctness.inputReplayExecutions, 400);
assert.equal(correctness.offObserveExecutions, 200);
assert(correctness.restoreCount >= 20 && correctness.checkpointsCompared > 0);
assert(correctness.independentProcessesByteEqual && correctness.cliResumeByteEqual);
assert.equal(review.pairs, 20); assert.equal(review.clips, 40);
assert.equal(review.status, 'pending-human-review');
assert(browser.nodeChromiumReplayAndTraceEqual && browser.freshRunIdOnModeChange && browser.privateKeyNotServed);
assert.equal(cost.measuredMatches, 270); assert.equal(legacy.baselineExecutions, 800);
for (const [path, hash] of Object.entries(evaluation.sourceFiles)) assert.equal(await sha(path), hash, `Evaluation producer changed: ${path}`);
assert.equal(hashCanonical(evaluation.sourceFiles), evaluation.sourceIdentity);

const manifests = {};
for (const name of ['dev-smoke', 'correctness-v1', 'ai-baseline-v1', 'pacing-pairs-v1', 'performance-v1']) {
  const path = `fixtures/seeds/${name}.json`, data = await json(path);
  const { datasetHash, ...body } = data; assert.equal(hashCanonical(body), datasetHash);
  manifests[name] = { datasetHash, cases: data.cases.length, fileHash: await sha(path) };
}
assert.equal(manifests['pacing-pairs-v1'].datasetHash, evaluation.manifestHash);
assert.equal(correctness.manifestHash, evaluation.manifestHash);
assert.equal(legacy.manifestHash, manifests['ai-baseline-v1'].datasetHash);

const sourceFiles = [];
async function collect(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path, files); else files.push(path);
  }
}
for (const directory of ['src', 'scripts', 'content', 'tests', 'fixtures']) await collect(directory, sourceFiles);
sourceFiles.push('package.json', 'package-lock.json', 'toolchain-lock.json', 'index.html', 'h2.html', 'phase0.html',
  'tsconfig.base.json', 'tsconfig.build.json', 'tsconfig.node.json', 'tsconfig.web.json', 'vite.config.ts', 'vitest.config.ts');
sourceFiles.sort();
const sourceDigests = await Promise.all(sourceFiles.map(async path => ({ path,
  sha256: createHash('sha256').update((await readFile(path, 'utf8')).replaceAll('\r\n', '\n')).digest('hex') })));
const records = [];
for (const item of evaluation.results) for (const mode of ['off', 'pace']) {
  records.push(`${root}/records/${item.caseId}-${mode}.json.gz`);
  records.push(`${root}/records/${item.caseId}-${mode}.director.ndjson.gz`);
}
assert.equal(records.length, 800);
const index = await json(`${root}/review/index.json`);
for (const entry of index.entries) records.push(`${root}/review/${entry.url.slice(2)}`);
for (const name of ['engage', 'vary', 'showcase']) {
  const evidence = correctness.mechanisms[name];
  assert(evidence && evidence.selectedKey !== evidence.counterfactual.selectedKey);
  for (const suffix of ['.json', '.trace.json', '.evidence.json']) records.push(`${root}/mechanisms/${name}${suffix}`);
}
records.sort();
const recordDigests = await Promise.all(records.map(async path => ({ path, sha256: await sha(path) })));
const artifactHashes = Object.fromEntries(await Promise.all(reportNames.map(async name => [name, await sha(`${root}/${name}.json`)])));
const legacyStages = {};
for (const stage of ['0', '1', '2', '3a']) {
  const webPath = `artifacts/phase-${stage}/browser.json`, web = await json(webPath);
  assert.equal(web.passed, true);
  legacyStages[`phase${stage}`] = { browserPassed: true, browserHash: await sha(webPath) };
}
const phase0 = await json('artifacts/phase-0/determinism.json');
assert.equal(phase0.finalWorldHash, 'a6de98e7d34e9210ab249df0228e4fc06c0252e1d30f6ae96722b94d1f946601');
const withoutRows = ({ rows, ...summary }) => summary;
// Resample whole off/pace pairs within each matchup, preserving pairing and matchup mix.
// These intervals describe seed variation, not human preferences or all possible content.
function bootstrap(rows, label) {
  const groups = Map.groupBy(rows, row => row.matchupId), rng = new Xoshiro128ss(deriveSeed(2026, 'pacing-bootstrap-v1', label));
  const samples = { coldP90Reduction: [], basicMissRateDifference: [], repeatMissesPerMatchDifference: [],
    ultimateEffectiveRateDifference: [], oneSidedFractionDifference: [] };
  const quantile = (values, q) => { values.sort((a,b)=>a-b); return values[Math.ceil(values.length*q)-1] ?? null; };
  const summary = (sample, mode) => {
    const metrics = sample.map(row => row[mode].metrics), sum = key => metrics.reduce((total, m) => total+m[key], 0);
    return { p90: quantile(metrics.flatMap(m=>m.coldIntervalsTicks), .9),
      basic: sum('basicMisses')/sum('basicCasts'), repeat: sum('repeatedConfirmedAttackMisses')/metrics.length,
      ultimate: sum('ultimateCasts') ? sum('effectiveUltimates')/sum('ultimateCasts') : null,
      oneSided: metrics.filter(m=>m.oneSided).length/metrics.length };
  };
  for (let i=0; i<2000; i++) {
    const sample = [...groups.values()].flatMap(group => Array.from({length:group.length},()=>group[Math.floor(rng.next01()*group.length)]));
    const off = summary(sample,'off'), pace = summary(sample,'pace');
    if (off.p90 && pace.p90 !== null) samples.coldP90Reduction.push(1-pace.p90/off.p90);
    samples.basicMissRateDifference.push(pace.basic-off.basic);
    samples.repeatMissesPerMatchDifference.push(pace.repeat-off.repeat);
    if (off.ultimate !== null && pace.ultimate !== null) samples.ultimateEffectiveRateDifference.push(pace.ultimate-off.ultimate);
    samples.oneSidedFractionDifference.push(pace.oneSided-off.oneSided);
  }
  return { method: 'Stratified paired-cluster bootstrap, percentile 95%; 2000 resamples, fixed analysis RNG',
    configurations: rows.length, matchupStrata: groups.size,
    intervals: Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,{low:quantile(values,.025),high:quantile(values,.975),validResamples:values.length}])) };
}
const confidenceIntervals = Object.fromEntries(['overall','train','holdout'].map(split => [split,
  bootstrap(split==='overall'?evaluation.results:evaluation.results.filter(row=>row.split===split),split)]));
const evidence = {
  schemaVersion: 1, stage: 'phase3b', date: '2026-10-02', branch: 'codex/phase-3b',
  implementationCommit: values['implementation-commit'] ?? 'pending-local-commit',
  baseCommit: '176f00c234c2e64498fdd849a365b11d4e14210a', engineeringGate: 'G3B-passed', combinedGate: 'G3-engineering-passed',
  tasks: ['P3-08', 'P3-09', 'P3-10', 'P3-11', 'P3-12', 'P3-13'],
  createdAt: new Date().toISOString(), machine: cost.machine, toolchainId: (await json('toolchain-lock.json')).id,
  versions: { engineBuild: 'phase3b-v1', aiVersion: 'utility-v3', rulesHash: PHASE3A_RULES_HASH,
    contentHash: content.bundleHash, pluginVersions: content.pluginVersions, profile: content.source.pacingProfiles[0],
    profileHash: hashCanonical(content.source.pacingProfiles[0]), metricsVersion: evaluation.metricsVersion,
    specificationSha256: await sha('1v1自动对抗短视频内容引擎_GPT6_Sol实施规格_v1.0.md'),
    sourceFiles: sourceDigests.length, sourceTreeHash: hashCanonical(sourceDigests), sourceTextNormalization: 'LF',
    evaluationProducerSourceIdentity: evaluation.sourceIdentity, evaluationProducerFileHashes: evaluation.sourceFiles },
  productionPacingMode: 'off', effectConclusion: 'target-not-met', humanReview: 'pending-human-review',
  unit: { passed: true, suites: unit.numPassedTestSuites, tests: unit.numPassedTests, failures: 0 },
  boundaries: reports.boundaries, frozenManifests: manifests,
  correctness: withoutRows(correctness), browser, review, cost: withoutRows(cost),
  evaluation: { configs: evaluation.configs, executions: evaluation.executions, manifestHash: evaluation.manifestHash,
    definitions: evaluation.definitions, off: evaluation.off, pace: evaluation.pace,
    train: evaluation.train, holdout: evaluation.holdout, effect: evaluation.effect, confidenceIntervals },
  legacy: { ...withoutRows(legacy), ...legacyStages, phase0WorldHash: phase0.finalWorldHash,
    frozenPhase3AEvidenceHash: await sha('docs/reports/phase-3a-evidence.json') },
  experiment: { selected: false, scope: 'Pre-release training-only conservative thresholds; not the final implementation',
    config: { noInteractionThresholdTicks: 210, repeatedMissThreshold: 4, readyHoldThresholdTicks: 240 },
    reportPath: `${root}/conservative-v2/evaluation.json`, reportHash: await sha(`${root}/conservative-v2/evaluation.json`),
    producerArchive: `${root}/pre-release`, reason: 'Training cold-p90 and repeat metrics did not improve; retain gentle-v1, keep default off.' },
  reproduction: { command: 'npm run verify:phase3b', workerCount: 1,
    legacyCommand: 'node scripts/verify-phase3b-legacy.mjs (requires original Phase3A raw records)',
    reviewCommand: 'npm run review:pacing', artifactRoot: root, artifactHashes,
    compressedMatchFiles: 400, compressedDirectorSidecars: 400, blindClipFiles: 40, mechanismFiles: 9,
    recordTreeHash: hashCanonical(recordDigests), largeArtifactsCommitted: false },
  knownIssues: ['Cold p90 does not reach the 20% target.', 'Repeat misses and effective-ultimate rate did not improve.',
    '20 pacing pairs, historical H2 and four-character style remain awaiting human review.',
    'Timing is a single warmed host benchmark, not a multi-worker or video-production guarantee.'],
  sourceDigests, recordDigests,
};
await writeFile('docs/reports/phase-3b-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(`Recorded Phase3B evidence: ${unit.numPassedTests} tests, 400 paired executions, ${correctness.restoreCount} restores, ${recordDigests.length} artifact digests.`);
