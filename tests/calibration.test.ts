import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ContentSource } from '../src/contracts/content-schema.js';
import type { FighterWorld } from '../src/contracts/fighter.js';
import { compilePhase3BContent } from '../src/content/phase3b.js';
import { resolveExchange, type PredictedImpact } from '../src/ai/exchange.js';
import { UtilityController } from '../src/ai/utility.js';
import { UtilityRunner } from '../src/runner/utility.js';
import { fighterConfig } from '../src/runner/fighter.js';
import { ObservationBuffer } from '../src/runner/observation.js';
import { initialFighterState } from '../src/sim/fighter-state.js';
import { replayInputs } from '../src/runner/input-replay.js';
import { ProductionConfigSchema, BatchManifestSchema } from '../src/contracts/production.js';

const impact = (tick: number, extra: Partial<PredictedImpact> = {}): PredictedImpact =>
    ({ tick, amount: 8, stunTicks: 12, releaseTick: tick, ...extra });

describe('causal exchange settlement', () => {
    it('nonfatal startup interruption removes the unrealizable attack reward', () => {
        const result = resolveExchange([impact(8, {newCast: true})], [impact(4)], 100, 100, true);
        expect(result).toMatchObject({damage: 0, castDamage: 0, loss: 8, death: 0});
    });
    it('an earlier strike interrupts the opposing cast', () => {
        expect(resolveExchange([impact(4)], [impact(8)], 100, 100, true)).toMatchObject({damage: 8, loss: 0});
    });
    it('contacts in the same simulation tick trade, including double KO', () => {
        expect(resolveExchange([impact(4.8)], [impact(4.1)], 8, 8, true)).toMatchObject({damage: 8, loss: 8, kill: 1, death: 1});
    });
    it('released projectiles survive hitstun but future uncommitted emissions do not', () => {
        const shots = [impact(8, {releaseTick: null}), impact(10, {releaseTick: 6})];
        expect(resolveExchange(shots, [impact(4)], 100, 100, true).damage).toBe(8);
        // A before-first-emission volley has committed all scheduled emissions at tick 2.
        expect(resolveExchange(shots.map(h => ({...h, releaseTick: 2})), [impact(4)], 100, 100, true).damage).toBe(16);
    });
    it('a terminal damage batch ends the forecast before a later projectile arrives', () => {
        expect(resolveExchange([impact(8, {releaseTick: null})], [impact(4)], 8, 100, true)).toMatchObject({damage: 0, loss: 8, kill: 0, death: 1});
    });
    it('an uncommitted possible basic is a scenario, not a guaranteed interruption', () => {
        const attacks = [impact(8)], possible = [impact(4, {possible: true})];
        expect(resolveExchange(attacks, possible, 100, 100, false).damage).toBe(8);
        expect(resolveExchange(attacks, possible, 100, 100, true).damage).toBe(0);
    });
    it('reflection release depends on the original caster, and existing shots have no new-cast credit', () => {
        expect(resolveExchange([impact(8, {releaseTick: 6, releaseOwner: 'opponent'})], [impact(4)], 100, 100, true).damage).toBe(8);
        expect(resolveExchange([impact(8, {releaseTick: null})], [], 100, 100, true).castDamage).toBe(0);
    });
});

const source = JSON.parse(readFileSync('content/fighter-phase3b.json', 'utf8')) as ContentSource;
const calibrated = structuredClone(source);
for (const p of calibrated.profiles) { p.predictionModel = 'causal-v1'; p.version++; }
const content = compilePhase3BContent(calibrated);

describe('calibrated controller integration', () => {
    it('production config selects v4 explicitly and frozen batch metadata must agree', () => {
        const config = ProductionConfigSchema.parse(JSON.parse(readFileSync('production.calibrated.json', 'utf8')));
        expect(config.aiVersion).toBe('utility-v4');
        expect(ProductionConfigSchema.safeParse({...config, aiVersion: 'utility-v6'}).success).toBe(false);
        const runner = new UtilityRunner(content, fighterConfig(content), {recordFrames: false});
        const match = runner.config;
        const batch = {schemaVersion: 1, batchId: config.id, config, createdAt: 'test', updatedAt: 'test', status: 'pending', engineBuild: 'phase3b-v1', aiVersion: 'utility-v4', contentHash: content.bundleHash, rulesHash: runner.sim.snapshot().rulesHash, scoreVersion: 'interesting-v1', toolchainId: 'test', workerCount: 1,
            tasks: [{matchId: match.matchId, config: match, state: 'pending', attempts: 0, manifestHash: null, score: null, selectionReason: null, exportId: null, framesComplete: 0, totalFrames: 0, lastCompleteState: 'pending', failures: []}], selection: [], rankingHash: null, failures: []};
        expect(BatchManifestSchema.safeParse(batch).success).toBe(true);
        expect(BatchManifestSchema.safeParse({...batch, aiVersion: 'utility-v3'}).success).toBe(false);
    });
    it('never uses a zero-benefit basic to cross the lower cast switch threshold', () => {
        const diagnostic = structuredClone(calibrated);
        for (const p of diagnostic.profiles) { p.reactionDelayTicks = 0; p.positionNoisePx = 0; p.velocityNoisePxPerSecond = 0; }
        const c = compilePhase3BContent(diagnostic), w = structuredClone(initialFighterState(fighterConfig(c, 17), c, 'phase3b-v1')) as FighterWorld;
        w.entities[0].body.position.x = 200; w.entities[1].body.position.x = 800;
        const buffer = new ObservationBuffer(c); buffer.push(w, [], []);
        const controller = new UtilityController(17, c, c.source.profiles[0]!, {noise: false, randomChoice: false, memory: true});
        expect(controller.update(buffer.observe(w, 0)).cast?.slot).not.toBe('basic');
        const basics = controller.lastTrace!.candidates.filter(c => c.option.slot === 'basic');
        expect(basics.length).toBeGreaterThan(0);
        expect(basics.every(c => c.outcome?.castDamageDealtPct === 0 && !c.eligible && c.selectionBlockReason === 'no-predicted-basic-hit')).toBe(true);
    });
    it('v4 checkpoints restore all future inputs and hashes and reject legacy identities', () => {
        const config = fighterConfig(content, 19, 'standard', 'mirror', 360);
        const a = new UtilityRunner(content, config, {recordFrames: false}), b = new UtilityRunner(content, config, {recordFrames: false});
        for (let tick = 0; tick < 120; tick++) a.step();
        const checkpoint = JSON.parse(JSON.stringify(a.snapshot(true)));
        expect(checkpoint.aiVersion).toBe('utility-v4');
        expect(() => b.restore({...checkpoint, aiVersion: 'utility-v3'})).toThrow();
        b.restore(checkpoint);
        while (!a.sim.snapshot().result) { a.step(); b.step(); expect(a.runnerHash()).toBe(b.runnerHash()); }
        expect(a.replay()).toEqual(b.replay());
        expect(replayInputs(a.replay(), false).replay.finalWorldHash).toBe(a.replay().finalWorldHash);
    }, 30000);
    it('legacy content keeps v3 and observation-only pacing does not alter v4 inputs', () => {
        const old = compilePhase3BContent(source);
        expect(new UtilityRunner(old, fighterConfig(old), {recordFrames: false}).snapshot().aiVersion).toBe('utility-v3');
        const config = fighterConfig(content, 21, 'iron', 'rubber', 360), observe = structuredClone(config);
        observe.pacing = {mode: 'observe', profileId: 'gentle-v1'};
        const a = new UtilityRunner(content, config, {recordFrames: false}), b = new UtilityRunner(content, observe, {recordFrames: false});
        expect(a.run().inputs).toEqual(b.run().inputs);
    }, 30000);
});
