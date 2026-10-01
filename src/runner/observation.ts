import type { ActionReceipt, BattleEvent, Observation, PublicSnapshot, WorldView } from '../contracts/fighter.js';
import type { ContentBundle } from '../contracts/content.js';
import { rulesetFor } from '../sim/rulesets.js';
import { SLOTS } from '../contracts/versions.js';
import { deepFreeze } from '../math/canonical.js';
import { publicSnapshot } from '../replay/frame.js';
import { castRejection, phaseAt } from '../sim/abilities/effective.js';
import type { ObservationSnapshot } from '../contracts/ai.js';
import { ObservationSnapshotSchema } from '../contracts/ai-schema.js';
export class ObservationBuffer {
    private ring: PublicSnapshot[] = [];
    private pending: ActionReceipt[] = [];
    private lastSensed = [-1, -1];
    constructor(private content: ContentBundle) { }
    push(w: WorldView, events: readonly BattleEvent[], receipts: readonly ActionReceipt[]): void {
        if (this.ring.length && w.tick !== this.ring.at(-1)!.tick + 1)
            throw new Error('Observation source snapshots must be contiguous');
        this.ring.push(publicSnapshot(w, events, this.content));
        if (this.ring.length > 64)
            this.ring.shift();
        this.pending.push(...receipts);
    }
    observe(w: WorldView, index: 0 | 1): Observation {
        const e = w.entities[index], profile = this.content.source.profiles.find(p => p.id === w.config.participants[index].profileId)!, cutoff = w.tick - profile.reactionDelayTicks;
        const sensed = this.ring.findLast(s => s.tick <= cutoff) ?? null;
        if (sensed && sensed.tick !== cutoff)
            throw new Error('Observation maturity interval has missing snapshots');
        const visibleEvents = sensed ? this.ring.filter(s => s.tick > this.lastSensed[index]! && s.tick <= sensed.tick).flatMap(s => s.events) : [];
        if (sensed)
            this.lastSensed[index] = sensed.tick;
        const receipts = this.pending.filter(r => r.entityId === e.id);
        this.pending = this.pending.filter(r => r.entityId !== e.id);
        const arena = this.content.source.arenas.find(a => a.id === w.config.arenaId)!, phase = phaseAt(e, w.tick);
        return deepFreeze({ nowTick: w.tick, sensedTick: sensed?.tick ?? null, self: { entity: e, legalSlots: SLOTS.filter(s => castRejection(e, s, this.content, w.tick) === null), canMove: phase !== 'dead' && phase !== 'hitstun', canJump: rulesetFor(w.config.rulesetId).capabilities().jump && phase === 'free' && e.body.grounded, receipts, passives: w.passiveRuntime.filter(r => r.entityId === e.id) }, opponent: sensed?.fighters.find(f => f.id !== e.id) ?? null, projectiles: sensed?.projectiles ?? [], visibleEvents, arena: { width: arena.width, height: arena.height, gravity: arena.gravity }, capabilities: rulesetFor(w.config.rulesetId).capabilities() });
    }
    snapshot(): ObservationSnapshot { return deepFreeze({ version: 1, ring: [...this.ring], pending: [...this.pending], lastSensed: [this.lastSensed[0]!, this.lastSensed[1]!] }); }
    restore(input: unknown): void {
        const data = ObservationSnapshotSchema.parse(input);
        if (data.ring.some((s, i) => i > 0 && s.tick !== data.ring[i - 1]!.tick + 1) || data.lastSensed.some(t => t > (data.ring.at(-1)?.tick ?? -1)))
            throw new Error('Observation ring/cursor mismatch');
        for (const s of data.ring) {
            if (s.events.some(e => e.sourceTick >= s.tick) || new Set(s.fighters.map(f => f.id)).size !== 2)
                throw new Error('Observation event maturity/identity mismatch');
        }
        this.ring = data.ring;
        this.pending = data.pending;
        this.lastSensed = [...data.lastSensed];
    }
}
