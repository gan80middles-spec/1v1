import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, relative} from 'node:path';
import {hashCanonical} from '../dist/node/math/hash.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';

export function argumentsFor(allowed, defaults = {}) {
  const result = {...defaults};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    assert(allowed.includes(key), `Unknown option ${key}`);
    if (key === '--trace') result[key] = true;
    else { assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing ${key} value`); result[key] = process.argv[++i]; }
  }
  return result;
}
export async function fingerprint() {
  const hashes = {};
  async function visit(directory) {
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else hashes[relative(process.cwd(), path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await visit('src'); await visit('dist/node');
  for (const name of (await readdir('scripts')).filter(n => n.includes('optimization')).sort()) {
    hashes[`scripts/${name}`] = createHash('sha256').update(await readFile(`scripts/${name}`)).digest('hex');
  }
  return {hashes, hash: hashCanonical(hashes)};
}
export async function loadManifest(path) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const {datasetHash, ...body} = manifest;
  assert.equal(hashCanonical(body), datasetHash, 'Manifest hash mismatch');
  assert.equal(manifest.caseCount, manifest.cases.length);
  assert.equal(new Set(manifest.cases.map(c => c.caseId)).size, manifest.cases.length);
  const bySeed = new Map();
  for (const item of manifest.cases) {
    const prior = bySeed.get(item.seed);
    assert(!prior || prior.split === item.split && prior.pairId === item.pairId, 'Seed crosses splits or unrelated cases');
    bySeed.set(item.seed, item);
  }
  return manifest;
}
export function caseConfig(content, item) {
  const config = fighterConfig(content, item.seed, item.a, item.b);
  config.matchId = item.caseId;
  if (item.participantIds) config.participants.forEach((p,i) => p.participantId = item.participantIds[i]);
  if (item.baseline) { config.participants[item.side].participantId = 'utility'; config.participants[1-item.side].participantId = 'baseline'; }
  return config;
}
export const quantile = (values, q) => values.length ? [...values].sort((a,b) => a-b)[Math.ceil(values.length*q)-1] : null;
export function summarize(rows) {
  const successful = rows.filter(r => !r.error), sum = key => successful.reduce((s,r) => s+r.pacing[key], 0);
  const ticks = sum('ticks'), casts = sum('basicCasts'), misses = sum('basicMisses');
  return {matches: rows.length, failures: rows.length-successful.length, ticks,
    basicCasts: casts, basicMisses: misses, basicMissRate: casts ? misses/casts : null,
    effectiveBasics: casts-misses, effectiveBasicsPerMinute: ticks ? (casts-misses)*3600/ticks : null,
    interactionFraction: ticks ? successful.reduce((s,r) => s+r.pacing.interactionFraction*r.pacing.ticks,0)/ticks : null,
    coldP90Seconds: quantile(successful.flatMap(r => r.pacing.coldIntervalsTicks), .9)/60,
    longestColdP90Seconds: quantile(successful.map(r => r.pacing.longestColdTicks), .9)/60,
    oneSidedFraction: successful.length ? successful.filter(r => r.pacing.oneSided).length/successful.length : null,
    meanDurationSeconds: ticks/Math.max(1,successful.length)/60,
    repeatedMisses: sum('repeatedConfirmedAttackMisses'), rejectedRequests: sum('rejectedRequests'),
    ultimateCasts: sum('ultimateCasts'), effectiveUltimates: sum('effectiveUltimates')};
}
