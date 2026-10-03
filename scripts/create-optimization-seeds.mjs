import assert from 'node:assert/strict';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {deriveMatchSeed, deriveParticipantSeed} from '../dist/node/math/random.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {SEED_DERIVATION_VERSION} from '../dist/node/contracts/versions.js';

const path = 'fixtures/seeds/optimization-r2-v1.json';
const names = ['iron', 'mirror', 'rubber', 'standard'];
const existingSeeds = new Set();
for (const name of await readdir('fixtures/seeds')) {
  if (!name.endsWith('.json') || name === 'optimization-r2-v1.json') continue;
  const manifest = JSON.parse(await readFile(`fixtures/seeds/${name}`, 'utf8'));
  for (const item of manifest.cases ?? []) existingSeeds.add(item.seed);
}
const cases = [], uniqueSeeds = new Set();
for (const [i, a] of names.entries()) for (const b of names.slice(i)) {
  const matchupId = `${a}-vs-${b}`;
  for (let sampleIndex = 0; sampleIndex < 40; sampleIndex++) {
    const seed = deriveMatchSeed(20261003, `optimization-r2-v1:${matchupId}`, sampleIndex);
    assert(!existingSeeds.has(seed) && !uniqueSeeds.has(seed), 'Seed collision');
    uniqueSeeds.add(seed);
    for (const swap of [false, true]) cases.push({
      caseId: `${matchupId}-${sampleIndex}-${swap ? 'QP' : 'PQ'}`, matchupId, sampleIndex,
      pairId: `${matchupId}-${seed}`, seed, split: sampleIndex < 20 ? 'train' : 'holdout',
      a: swap ? b : a, b: swap ? a : b, participantIds: swap ? ['Q', 'P'] : ['P', 'Q'],
      participantAiSeeds: {P: deriveParticipantSeed(seed, 'P'), Q: deriveParticipantSeed(seed, 'Q')},
    });
  }
}
const body = {schemaVersion: 1, datasetId: 'optimization-r2-v1', rootSeed: 20261003,
  seedDerivationVersion: SEED_DERIVATION_VERSION, caseCount: cases.length,
  note: '400 train + 400 holdout; same seed and participant RNG identity follow swapped sides; pairId is bootstrap cluster.', cases};
const manifest = {...body, datasetHash: hashCanonical(body)};
const serialized = JSON.stringify(manifest, null, 2) + '\n';
try { assert.equal(await readFile(path, 'utf8'), serialized, 'Existing manifest differs'); }
catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(path, serialized, {flag: 'wx'}); }
console.log(JSON.stringify({path, cases: cases.length, independentSeeds: uniqueSeeds.size, hash: manifest.datasetHash}));
