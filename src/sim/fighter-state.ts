import type { ContentBundle } from '../contracts/content.js';
import type { FighterConfig, FighterWorld, WorldView, FighterEngineBuild } from '../contracts/fighter.js';
import { FighterConfigSchema, FighterWorldSchema } from '../contracts/fighter-schema.js';
import { deepFreeze } from '../math/canonical.js';
import { hashCanonical } from '../math/hash.js';
import { rulesetFor } from './rulesets.js';
import { deriveSeed, Xoshiro128ss } from '../math/random.js';
export const FIGHTER_RULES = deepFreeze({ id: 'fighter', version: 1, tickRate: 60, substeps: 4, maxSpeed: 1800, floorRestThreshold: 140, energyPerSecond: 1, damageEnergyCap: 12, outgoingEnergy: .35, incomingEnergy: .55, ultimateSuppressionTicks: 240, timeoutDrawTolerance: .005, build: 'phase1-v1' });
export const FIGHTER_RULES_HASH = hashCanonical(FIGHTER_RULES);
export const UTILITY_RULES_HASH=hashCanonical({...FIGHTER_RULES,build:'phase2-v1',facing:'cast-locked',defenseCausality:'defense-cast',bodyFloorContact:'projected-inverse-mass'});
export const PHASE3A_RULES_HASH=hashCanonical({...FIGHTER_RULES,build:'phase3a-v1',facing:'cast-locked',defenseCausality:'defense-cast',bodyFloorContact:'projected-inverse-mass',reflection:'swept-shield-before-damage,max-2,ignore-until-outside,one-per-substep',impact:'first-contact-relative-speed',fixture:'free-bounce-v1'});
export const fighterRulesHash=(build:FighterEngineBuild):string=>build==='phase1-v1'?FIGHTER_RULES_HASH:build==='phase2-v1'?UTILITY_RULES_HASH:PHASE3A_RULES_HASH;
export function initialFighterState(input: FighterConfig, content: ContentBundle,build:FighterEngineBuild='phase1-v1'): WorldView {
    const config = FighterConfigSchema.parse(input);
    if(build!=='phase3b-v1'&&config.pacing.mode!=='off')throw new Error('Legacy build requires pacing off');
    if(config.pacing.mode!=='off'&&!content.source.pacingProfiles.some(p=>p.id===config.pacing.profileId))throw new Error('Unknown pacing profile');
    if(config.rulesetId==='free-bounce-fixture' && !['phase3a-v1','phase3b-v1'].includes(build)) throw new Error('Fixture requires Phase 3A build');
    if (config.contentHash !== content.bundleHash || content.source.purpose !== 'production')
        throw new Error('Fighter content identity mismatch');
    const arena = content.source.arenas.find(a => a.id === config.arenaId);
    if (!arena)
        throw new Error('Unknown arena');
    if (config.participants[0].participantId === config.participants[1].participantId)
        throw new Error('Duplicate participant');
    const entities = config.participants.map((p, i) => {
        const c = content.source.characters.find(c => c.id === p.characterId);
        if (!c || !content.source.profiles.some(a => a.id === p.profileId))
            throw new Error('Unknown character/profile');
        return { id: i + 1, participantId: p.participantId, characterId: c.id, body: { position: { x: Math.max(c.body.radius, Math.min(arena.width - c.body.radius, arena.spawnPositions[i]!.x)), y: c.body.radius }, velocity: { x: 0, y: 0 }, radius: c.body.radius, mass: c.body.mass, grounded: true, facing: (i === 0 ? 1 : -1) as -1 | 1 }, hp: c.stats.maxHp, maxHp: c.stats.maxHp, energy: 0, energySuppressedUntilTick: 0, lastProcessedRequestId: 0, action: { kind: 'free' as const }, cooldownReadyTick: { basic: 0, skill1: 0, skill2: 0, ultimate: 0 }, statuses: [], lastLaunchCastId: null, lastLaunchTick: null };
    }) as unknown as FighterWorld['entities'];
    rulesetFor(config.rulesetId).initialize(entities,config,content);
    return deepFreeze({ schemaVersion: 2, tick: 0, config, rulesHash: fighterRulesHash(build), contentHash: content.bundleHash, entities, projectiles: [], hitboxes: [], casts: [], scheduledEffects: [], hitRegistry: [], passiveRuntime: entities.filter(e => content.source.characters.find(c => c.id === e.characterId)!.passiveIds.includes('rubber-wall-growth')).map(e => ({ entityId: e.id, passiveId: 'rubber-wall-growth' as const, nextAllowedTick: 0, stacks: 0, expiresTick: 0 })), combatRngState: new Xoshiro128ss(deriveSeed(config.seed, 'combat')).snapshot(), nextEntityId: 3, nextCastId: 1, nextStatusId: 1, nextScheduleId: 1, nextEventSeq: 1, nextReceiptSeq: 1, diagnostics: [], result: null });
}
export function validateFighterSnapshot(input: unknown, content: ContentBundle,build:FighterEngineBuild='phase1-v1'): WorldView {
    const w = FighterWorldSchema.parse(input);
    if (w.rulesHash !== fighterRulesHash(build) || w.contentHash !== content.bundleHash || w.config.contentHash !== w.contentHash)
        throw new Error('Snapshot identity mismatch');
    if (w.tick > w.config.maxTicks || (!w.result && w.tick >= w.config.maxTicks) || w.combatRngState.every(v => v === 0))
        throw new Error('Snapshot boundary/RNG mismatch');
    const arena = content.source.arenas.find(a => a.id === w.config.arenaId);
    if (!arena)
        throw new Error('Snapshot arena missing');
    for (let i = 0; i < 2; i++) {
        const e = w.entities[i]!, p = w.config.participants[i]!;
        if (e.id !== i + 1 || e.participantId !== p.participantId || e.characterId !== p.characterId || e.hp > e.maxHp || e.body.position.x < e.body.radius - 1e-5 || e.body.position.x > arena.width - e.body.radius + 1e-5 || e.body.position.y < e.body.radius - 1e-5 || e.body.position.y > arena.height - e.body.radius + 1e-5)
            throw new Error('Snapshot entity mismatch/bounds');
    }
    if (w.result && (w.result.endedAfterTicks !== w.tick || w.result.matchId !== w.config.matchId || w.result.remainingHp.some((hp, i) => hp !== w.entities[i]!.hp)))
        throw new Error('Snapshot result mismatch');
    return deepFreeze(w);
}
export const fighterWorldHash = (w: WorldView): string => hashCanonical(w);
