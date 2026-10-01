import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { compileFighterContent } from '../src/content/fighter.js';
import { FighterRunner, fighterConfig } from '../src/runner/fighter.js';
import { replayInputs } from '../src/runner/input-replay.js';
import { ObservationBuffer } from '../src/runner/observation.js';
import { initialFighterState } from '../src/sim/fighter-state.js';
import { BaselineController } from '../src/ai/scripted.js';
import { canonicalSerialize } from '../src/math/canonical.js';
import type { FighterWorld } from '../src/contracts/fighter.js';
const content = compileFighterContent(JSON.parse(readFileSync('content/fighter-phase1.json', 'utf8')) as unknown);
describe('fair observations and replay', () => {
    it('cold start has no enemy; snapshot and events arrive only after delay', () => { const config = fighterConfig(content), initial = initialFighterState(config, content), buffer = new ObservationBuffer(content); buffer.push(initial, [], []); const cold = buffer.observe(initial, 0); expect(cold.opponent).toBeNull(); expect(cold.projectiles).toEqual([]); const world = JSON.parse(JSON.stringify(initial)) as FighterWorld; world.tick = 9; world.entities[1].body.position.x = 100; const obs = buffer.observe(world, 0); expect(obs.sensedTick).toBe(0); expect(obs.opponent!.position.x).toBe(initial.entities[1].body.position.x); expect(Object.keys(obs.opponent!)).not.toContain('cooldownReadyTick'); expect(Object.keys(obs.opponent!)).not.toContain('action'); });
    it('receipt arrays preserve accepted plus finished and are consumed once', () => { const config = fighterConfig(content), w = initialFighterState(config, content), b = new ObservationBuffer(content); b.push(w, [], [{ receiptSeq: 1, entityId: 1, requestId: 1, tick: 0, result: 'accepted', reason: 'ok' }, { receiptSeq: 2, entityId: 1, requestId: 1, tick: 0, result: 'finished', reason: 'ok' }]); expect(b.observe(w, 0).self.receipts.map(r => r.result)).toEqual(['accepted', 'finished']); expect(b.observe(w, 0).self.receipts).toEqual([]); });
    it('controller never gets an enemy during cold start and snapshot restore preserves decisions', () => { const c = fighterConfig(content), w = initialFighterState(c, content), b = new ObservationBuffer(content), o = b.observe(w, 0), a = new BaselineController('rush', 17, content), other = new BaselineController('rush', 18, content); const input = a.update(o); expect(input.cast).toBeNull(); expect(input.jumpPressed).toBe(false); other.restore(a.snapshot()); expect(other.update({ ...o, nowTick: 12 })).toEqual(a.update({ ...o, nowTick: 12 })); });
    it('completed battles replay only inputs, including ALL events/checkpoints; rendering off matches', () => { const c = fighterConfig(content, 17, 'standard', 'rubber', 1200), a = new FighterRunner(content, c), b = new FighterRunner(content, c, ['rush', 'ranged'], false); const ra = a.run(), rb = b.run(); expect(ra.result.reason).not.toBe('invalid'); expect(canonicalSerialize(ra)).toBe(canonicalSerialize(rb)); const replay = replayInputs(ra); expect(replay.frames).toEqual(a.frames); expect(replay.frames.at(-1)!.result).toEqual(ra.result); expect(ra.events.some(e => e.type === 'HitResolved')).toBe(true); });
    it('hit and damage events reference their accepted cast root across different ticks', () => {
        const r = new FighterRunner(content, fighterConfig(content, 17, 'standard', 'rubber', 600)).run(), byId = new Map(r.events.map(e => [e.seq, e]));
        const damage = r.events.filter(e => e.type === 'DamageResolved');
        expect(damage.length).toBeGreaterThan(0);
        for (const e of damage) {
            const parent = byId.get(e.parentEventId!)!;
            expect(parent.type).toBe('HitResolved');
            expect(byId.get(e.rootEventId)!.type).toBe('CastAccepted');
            expect(parent.seq).toBeLessThan(e.seq);
            expect(e.depth).toBe(2);
        }
    });
    it('same-character participants receive decisions from the same pre-input world', () => { const runner = new FighterRunner(content, fighterConfig(content, 33, 'standard', 'standard', 60), ['rush', 'rush']); runner.run(); expect(runner.inputs[0]!.intents[0].cast).toBeNull(); expect(runner.inputs[0]!.intents[1].cast).toBeNull(); expect(runner.inputs[0]!.intents[0].moveX).toBe(1); expect(runner.inputs[0]!.intents[1].moveX).toBe(-1); });
    it('rejects altered build, content, inputs and events rather than correcting the final frame', () => { const r = new FighterRunner(content, fighterConfig(content, 17, 'standard', 'rubber', 60)).run(); const changed = JSON.parse(JSON.stringify(r)); changed.engineBuild = 'other'; expect(() => replayInputs(changed)).toThrow(/build/); const bad = JSON.parse(JSON.stringify(r)); bad.inputs[10].tick = 11; expect(() => replayInputs(bad)).toThrow(/discontinuity/); const events = JSON.parse(JSON.stringify(r)); events.events = []; expect(() => replayInputs(events)).toThrow(/events/); const hash = JSON.parse(JSON.stringify(r)); hash.content.characters[0].stats.maxHp = 99; expect(() => replayInputs(hash)).toThrow(/content/); });
});
