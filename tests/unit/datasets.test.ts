import { expect,test } from 'vitest';
import { createSeedManifests } from '../../src/runner/datasets.js';

test('frozen sample sizes, distinct train/holdout seeds and original seed on paired runs',() => {
  const manifests = createSeedManifests();
  expect(manifests['dev-smoke'].caseCount).toBe(30);
  expect(manifests['correctness-v1'].caseCount).toBe(200);
  expect(manifests['ai-baseline-v1'].caseCount).toBe(800);
  expect(manifests['pacing-pairs-v1'].caseCount).toBe(200);
  expect(manifests['performance-v1'].caseCount).toBe(110);
  for (const manifest of [manifests['correctness-v1'],manifests['ai-baseline-v1']]) {
    const train = new Set(manifest.cases.filter((item) => item.split === 'train').map((item) => item.seed));
    const holdout = new Set(manifest.cases.filter((item) => item.split === 'holdout').map((item) => item.seed));
    expect([...train].filter((seed) => holdout.has(seed))).toEqual([]);
    expect(manifest.cases.filter((item) => item.split === 'holdout')).toHaveLength(manifest.caseCount/2);
    expect(new Set(manifest.cases.map((item) => item.caseId)).size).toBe(manifest.caseCount);
  }
  const baseline = manifests['ai-baseline-v1'].cases;
  for (let i=0;i<baseline.length;i+=2) {
    expect(baseline[i]!.seed).toBe(baseline[i+1]!.seed);
    expect(baseline[i]!.participantAiSeeds).toEqual(baseline[i+1]!.participantAiSeeds);
    expect([baseline[i]!.side,baseline[i+1]!.side]).toEqual([0,1]);
  }
  expect(manifests['pacing-pairs-v1'].cases).toEqual(manifests['correctness-v1'].cases);
});
