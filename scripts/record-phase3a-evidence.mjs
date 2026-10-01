import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compilePhase3AContent } from '../dist/node/content/phase3a.js';
import { PHASE3A_RULES_HASH } from '../dist/node/sim/fighter-state.js';
import { hashCanonical } from '../dist/node/math/hash.js';
import { aggregateEvaluation } from '../dist/node/analysis/evaluation.js';

const { values } = parseArgs({ options: { 'implementation-commit': { type: 'string' } } });
if (values['implementation-commit']) assert.match(values['implementation-commit'], /^[0-9a-f]{40}$/);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const [unit, boundaries, correctness, baseline, ablations, style, browser, examples] = await Promise.all([
  'unit-tests', 'boundaries', 'correctness', 'evaluation/baseline',
  'evaluation/ablations', 'style', 'browser', 'examples',
].map(name => json(`artifacts/phase-3a/${name}.json`)));
const content = compilePhase3AContent(await json('content/fighter-phase3a.json'));
assert(unit.success && unit.numFailedTests === 0);
for (const report of [boundaries, correctness, style, browser, examples]) assert.equal(report.passed, true);
assert.equal(baseline.status, 'passed');
assert.equal(ablations.status, 'passed');
for (const report of [correctness, baseline, ablations]) {
  assert.equal(report.contentHash, content.bundleHash);
  assert.equal(report.rulesHash, PHASE3A_RULES_HASH);
  assert.equal(report.engineBuild, 'phase3a-v1');
  assert.equal(report.aiVersion, 'utility-v2');
  assert.equal(report.pacingMode, 'off');
}
assert.equal(correctness.configs, 200);
assert.equal(correctness.repeatExecutions, 400);
assert.equal(correctness.inputReplayExecutions, 200);
assert.equal(correctness.checkpointRestores, 30);
assert.equal(baseline.n, 800);
assert.equal(baseline.train, 400);
assert.equal(baseline.holdout, 400);
assert.equal(baseline.overall.invalid, 0);
assert.equal(ablations.casesPerVariant, 96);
assert.equal(ablations.additionalExecutions, 384);
assert.equal(ablations.studies.length, 4);
for (const study of ablations.studies) assert.equal(study.overall.invalid, 0);
assert.equal(style.matches, 40);
assert.equal(style.status, 'pending-human-review');

const manifests = {};
for (const name of ['dev-smoke', 'correctness-v1', 'ai-baseline-v1', 'pacing-pairs-v1', 'performance-v1']) {
  const path = `fixtures/seeds/${name}.json`, data = await json(path);
  manifests[name] = { datasetHash: data.datasetHash, fileHash: await digest(path), cases: data.cases.length };
}
assert.equal(manifests['correctness-v1'].datasetHash, correctness.manifestHash);
assert.equal(manifests['ai-baseline-v1'].datasetHash, baseline.manifestHash);

const legacy = {};
for (const [name, path] of [['phase0', 'artifacts/phase-0/determinism.json'],
  ['phase1', 'artifacts/phase-1/smoke.json'], ['phase2', 'artifacts/phase-2/smoke.json']]) {
  const report = await json(path), web = await json(`artifacts/phase-${name.slice(-1)}/browser.json`);
  assert.equal(report.passed, true); assert.equal(web.passed, true);
  legacy[name] = { passed: true, reportHash: await digest(path), browserHash: await digest(`artifacts/phase-${name.slice(-1)}/browser.json`),
    configs: report.configs ?? report.cases ?? 1, repeatExecutions: report.repeatExecutions ?? report.repetitions,
    finalWorldHash: report.finalWorldHash ?? null, browser: web.nodeBrowserMatching ?? web.nodeBrowserMatchingSeeds };
}
assert.equal(legacy.phase0.finalWorldHash, 'a6de98e7d34e9210ab249df0228e4fc06c0252e1d30f6ae96722b94d1f946601');

const sourceFiles = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else sourceFiles.push(path);
  }
}
for (const directory of ['src', 'scripts', 'content', 'tests', 'fixtures']) await collect(directory);
sourceFiles.push('package.json', 'package-lock.json', 'toolchain-lock.json', 'index.html', 'h2.html', 'phase0.html',
  'tsconfig.base.json', 'tsconfig.build.json', 'tsconfig.node.json', 'tsconfig.web.json', 'vite.config.ts', 'vitest.config.ts');
sourceFiles.sort();
const sourceDigests = await Promise.all(sourceFiles.map(async path => ({ path,
  sha256: createHash('sha256').update((await readFile(path, 'utf8')).replaceAll('\r\n', '\n')).digest('hex') })));
const records = [];
for (const row of correctness.results) records.push(`artifacts/phase-3a/correctness/${row.recordFile}`);
for (const row of baseline.results) records.push(`artifacts/phase-3a/evaluation/${row.recordFile}`);
for (const study of ablations.studies) for (const row of study.results) records.push(`artifacts/phase-3a/evaluation/${row.recordFile}`);
records.sort();
const recordDigests = await Promise.all(records.map(async path => ({ path, sha256: await digest(path) })));
assert.equal(recordDigests.length, 1384);
assert.equal(new Set(records).size, 1384);
const artifactHashes = {};
for (const name of ['unit-tests', 'boundaries', 'correctness', 'evaluation/baseline', 'evaluation/ablations', 'style', 'browser', 'examples'])
  artifactHashes[name] = await digest(`artifacts/phase-3a/${name}.json`);
const { results: correctnessRows, ...correctnessSummary } = correctness;
const abilities = content.source.abilities.map(ability => {
  const count = key => baseline.results.reduce((total, row) => {
    const value = row[key].byAbility[ability.id];
    return { casts: total.casts + (value?.casts ?? 0), effective: total.effective + (value?.effective ?? 0) };
  }, { casts: 0, effective: 0 });
  return { abilityId: ability.id, utility: count('metrics'), baseline: count('baselineMetrics') };
});
const evidence = {
  schemaVersion: 1, stage: 'phase3a', date: '2026-10-02', branch: 'codex/phase-3a', engineeringGate: 'G3A-passed',
  implementationCommit: values['implementation-commit'] ?? 'pending-local-commit',
  baseCommit: '8f1dcd3adbf90bc7b5a50e63418a78a3010c12d8',
  scope: { tasks: ['P3-01', 'P3-02', 'P3-03', 'P3-04', 'P3-05', 'P3-06', 'P3-07'],
    expansionAuthorization: 'User explicitly requested Phase 3A on 2026-10-02; H2 was not declared passed.',
    h2: 'pending-human-review', fourCharacterStyle: 'pending-human-review', phase3b: 'not-started', pacingMode: 'off' },
  versions: { engineBuild: 'phase3a-v1', aiVersion: 'utility-v2', baselineVersion: baseline.baselineVersion,
    metricsVersion: baseline.metricsVersion, rulesHash: PHASE3A_RULES_HASH, contentHash: content.bundleHash,
    pluginVersions: content.pluginVersions, sourceFiles: sourceDigests.length, sourceTreeHash: hashCanonical(sourceDigests),
    sourceTextNormalization: 'LF, matching repository .gitattributes',
    specificationSha256: await digest('1v1自动对抗短视频内容引擎_GPT6_Sol实施规格_v1.0.md') },
  machine: baseline.machine, frozenManifests: manifests,
  unit: { passed: true, suites: unit.numPassedTestSuites, tests: unit.numPassedTests, failures: unit.numFailedTests },
  boundaries, correctness: correctnessSummary,
  baseline: { scope: baseline.scope, n: baseline.n, train: baseline.train, holdout: baseline.holdout,
    manifestHash: baseline.manifestHash, subsetHash: baseline.subsetHash, overall: baseline.overall,
    sameInformationBudget: { reactionDelaySource: 'participant profile', noiseEnabled: true,
      opponentErrorChannels: [2, 3, 4, 5], opponentErrorAmplitudeSource: 'participant profile',
      projectileView: 'exact mature public fields for both', baselineDecisionIntervalTicks: 12 },
    splitResults: ['train', 'holdout'].map(split => ({ split, ...aggregateEvaluation(baseline.results.filter(r => r.split === split)) })),
    groups: baseline.groups, coverage: baseline.coverage, abilities, predictionTiming: baseline.predictionTiming },
  ablations: { scope: ablations.scope, casesPerVariant: 96, trainPerVariant: 48, holdoutPerVariant: 48,
    additionalExecutions: 384, subsetHash: ablations.subsetHash, researchNote: ablations.researchNote,
    control: ablations.control.overall, studies: ablations.studies.map(({ results, ...study }) => study) },
  style, browser, examples, legacy,
  rawArtifacts: { reportHashes: artifactHashes, compressedInputReplayFiles: recordDigests.length,
    compressedInputReplayTreeHash: hashCanonical(recordDigests), excludedFromGit: true,
    reproduce: 'npm run verify:phase3a' },
  behavioralGaps: [
    { metric: 'basicMissRate', targetMax: .45, actual: baseline.overall.basicMissRate, status: 'not-met' },
    { metric: 'naturalSkillCoverage', status: 'sparse-opportunities',
      note: 'All 16 slots are exercised in controlled baseline scenarios. Natural control matches omit Utility iron-giant/mirror-dome/rubber-overdrive and baseline mirror-dome/rubber-cushion; no artificial casts are added to evaluation.' },
    { metric: 'memoryBenefit', status: 'not-demonstrated-in-fixed-subset', note: 'Control and no-memory both win 95/96. Human style review remains pending.' },
  ],
};
await writeFile(resolve('docs/reports/phase-3a-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ engineeringGate: evidence.engineeringGate, tests: evidence.unit.tests,
  correctness: correctness.configs, baseline: baseline.n, savedInputReplays: recordDigests.length, humanReview: 'pending' }, null, 2));
