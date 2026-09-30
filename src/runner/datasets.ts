import { SEED_DERIVATION_VERSION } from '../contracts/versions.js';
import { hashCanonical } from '../math/hash.js';
import { deriveMatchSeed,deriveParticipantSeed } from '../math/random.js';

const characters = ['iron','mirror','rubber','standard'] as const;
type Split = 'train' | 'holdout' | 'development' | 'performance';
interface SeedCase {
  readonly caseId: string;
  readonly matchupId: string;
  readonly sampleIndex: number;
  readonly seed: number;
  readonly split: Split;
  readonly participantAiSeeds: Readonly<Record<string,number>>;
  readonly a: string;
  readonly b: string;
  readonly side?: 0 | 1;
  readonly baseline?: 'rush' | 'ranged';
}
function pairs(names: readonly string[]): readonly (readonly [string,string])[] {
  return names.flatMap((a,i) => names.slice(i).map((b) => [a,b] as const));
}
function matchupCases(names: readonly string[],count: number,root: number,development = false): SeedCase[] {
  return pairs(names).flatMap(([a,b]) => Array.from({ length: count },(_,sampleIndex) => {
    const matchupId = `${a}-vs-${b}`;
    const seed = deriveMatchSeed(root,matchupId,sampleIndex);
    return {
      caseId: `${matchupId}-${sampleIndex}`, matchupId,sampleIndex,seed,
      split: development ? 'development' as const : sampleIndex < count/2 ? 'train' as const : 'holdout' as const,
      participantAiSeeds: { A: deriveParticipantSeed(seed,'A'), B: deriveParticipantSeed(seed,'B') }, a,b,
    };
  }));
}
export function createSeedManifests() {
  const dev = matchupCases(['rubber','standard'],10,1001,true);
  const correctness = matchupCases(characters,20,2001);
  const baseline: SeedCase[] = characters.flatMap((character) => (['rush','ranged'] as const).flatMap((opponent) => Array.from({ length: 50 },(_,sampleIndex) => {
    const matchupId = `${character}-vs-${opponent}`;
    const seed = deriveMatchSeed(3001,matchupId,sampleIndex);
    return ([0,1] as const).map((side): SeedCase => ({
      caseId: `${matchupId}-${sampleIndex}-side-${side}`, matchupId,sampleIndex,seed,
      split: sampleIndex < 25 ? 'train' : 'holdout',
      participantAiSeeds: { utility: deriveParticipantSeed(seed,'utility'), baseline: deriveParticipantSeed(seed,'baseline') },
      a: character,b: character, side,baseline: opponent,
    }));
  }).flat()));
  const performance: SeedCase[] = Array.from({ length: 110 },(_,sampleIndex) => {
    const seed = deriveMatchSeed(4001,'fixed-2700-tick',sampleIndex);
    return {
      caseId: `performance-${sampleIndex}`, matchupId: 'standard-vs-rubber', sampleIndex,seed,split: 'performance',
      participantAiSeeds: { A: deriveParticipantSeed(seed,'A'), B: deriveParticipantSeed(seed,'B') }, a: 'standard',b: 'rubber',
    };
  });
  const manifest = (datasetId: string,rootSeed: number,cases: readonly SeedCase[],extra: Record<string,unknown> = {}) => {
    const body = { schemaVersion: 1,datasetId,seedDerivationVersion: SEED_DERIVATION_VERSION,rootSeed,caseCount: cases.length,cases,...extra };
    return { ...body,datasetHash: hashCanonical(body) };
  };
  return {
    'dev-smoke': manifest('dev-smoke',1001,dev),
    'correctness-v1': manifest('correctness-v1',2001,correctness,{ repetitions: 2,expectedExecutions: 400 }),
    'ai-baseline-v1': manifest('ai-baseline-v1',3001,baseline,{ pacingMode: 'off',expectedExecutions: 800 }),
    'pacing-pairs-v1': manifest('pacing-pairs-v1',2001,correctness,{ pairedModes: ['off','pace'],expectedExecutions: 400 }),
    'performance-v1': manifest('performance-v1',4001,performance,{ warmupCases: 10,measuredCases: 100,fixedTicks: 2700,earlyTermination: false }),
  };
}
