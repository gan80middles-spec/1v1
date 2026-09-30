import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSerialize } from '../dist/node/math/canonical.js';
import { sha256 } from '../dist/node/math/hash.js';

const root = fileURLToPath(new URL('../',import.meta.url));
const output = resolve(root,'artifacts/phase-0/中文 路径');
await mkdir(output,{ recursive: true });
const cli = resolve(root,'dist/node/cli/simulate.js');
const command = (args) => spawnSync(process.execPath,[cli,...args],{ cwd: root,encoding: 'utf8',windowsHide: true });
const first = resolve(output,'run-a.json');
const second = resolve(output,'run-b.json');
for (const path of [first,second]) {
  const child = command(['--seed','17','--ticks','600','--record-states','--output',path]);
  assert.equal(child.status,0,child.stderr);
}
const firstBytes = await readFile(first,'utf8');
const secondBytes = await readFile(second,'utf8');
assert.equal(firstBytes,secondBytes,'separate CLI processes changed full state/input/event report bytes');
const report = JSON.parse(firstBytes);
assert.equal(report.states.length,601);
assert.equal(report.inputs.length,600);
for (let tick=0;tick<=600;tick++) assert.equal(report.states[tick].tick,tick);
const compact = command(['--seed','17','--ticks','600']);
assert.equal(compact.status,0,compact.stderr);
const summary = JSON.parse(compact.stdout);
assert.equal(summary.stateSequenceHash,report.stateSequenceHash,'trace/recording changed sequence');
assert.equal(summary.finalWorldHash,report.finalWorldHash);

const changed = command(['--seed','18','--ticks','600']);
assert.equal(changed.status,0,changed.stderr);
assert.notEqual(JSON.parse(changed.stdout).finalWorldHash,report.finalWorldHash,'root seed was not recorded in state/RNG');
const badContent = resolve(output,'bad-content.json');
await writeFile(badContent,JSON.stringify({ schemaVersion: 1 }));
const badCases = [
  [['--seed','-1'],/seed/], [['--ticks','0'],/ticks/], [['--ticks','3601'],/ticks/],
  [['--seed','1.5'],/seed/], [['--unknown'],/Unknown option/],
  [['--content',badContent],/Content validation failed/],
];
for (const [args,error] of badCases) {
  const child = command(args);
  assert.equal(child.status,2,`bad CLI should fail: ${args}`);
  assert.match(child.stderr,error);
}
const frozen = spawnSync(process.execPath,[resolve(root,'scripts/create-seed-manifests.mjs'),'--check'],{ cwd: root,encoding: 'utf8',windowsHide: true });
assert.equal(frozen.status,0,frozen.stderr);
const verification = {
  passed: true,engineBuild: report.engineBuild,node: process.version,v8: process.versions.v8,
  seed: 17,ticks: 600,repetitions: 2,stateCountPerRun: 601,inputCountPerRun: 600,
  fullReportBytesEqual: true,fullReportFileHash: sha256(firstBytes),
  stateSequenceHash: report.stateSequenceHash,eventSequenceHash: report.eventSequenceHash,finalWorldHash: report.finalWorldHash,
  contentHash: report.contentHash,rulesHash: report.rulesHash,
  recordingOnOffEqual: true,changedSeedChangesState: true,invalidCliCasesPassed: badCases.length,frozenManifestsVerified: 5,
  artifacts: [first,second].map((path) => path.slice(root.length).replaceAll('\\','/')),
};
const path = resolve(root,'artifacts/phase-0/determinism.json');
await mkdir(dirname(path),{ recursive: true });
await writeFile(path,`${canonicalSerialize(verification)}\n`);
console.log(JSON.stringify(verification,null,2));
