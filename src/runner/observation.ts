import type { ActionReceipt, BattleEvent, Observation, PublicSnapshot, WorldView } from '../contracts/fighter.js';
import type { ContentBundle } from '../contracts/content.js';
import { SLOTS } from '../contracts/versions.js';
import { deepFreeze } from '../math/canonical.js';
import { publicSnapshot } from '../replay/frame.js';
import { castRejection, phaseAt } from '../sim/abilities/effective.js';
export class ObservationBuffer {
    private ring: PublicSnapshot[] = [];
    private pending: ActionReceipt[] = [];
    private lastSensed = [-1, -1];
    constructor(private content: ContentBundle) { }
    push(w: WorldView, events: readonly BattleEvent[], receipts: readonly ActionReceipt[]): void {
        this.ring.push(publicSnapshot(w, events, this.content));
        if (this.ring.length > 64)
            this.ring.shift();
        this.pending.push(...receipts);
    }
    observe(w: WorldView, index: 0 | 1): Observation {
        const e = w.entities[index], profile = this.content.source.profiles.find(p => p.id === w.config.participants[index].profileId)!, cutoff = w.tick - profile.reactionDelayTicks;
        const sensed = this.ring.findLast(s => s.tick <= cutoff) ?? null;
        const visibleEvents = sensed ? this.ring.filter(s => s.tick > this.lastSensed[index]! && s.tick <= sensed.tick).flatMap(s => s.events) : [];
        if (sensed)
            this.lastSensed[index] = sensed.tick;
        const receipts = this.pending.filter(r => r.entityId === e.id);
        this.pending = this.pending.filter(r => r.entityId !== e.id);
        const arena = this.content.source.arenas.find(a => a.id === w.config.arenaId)!, phase = phaseAt(e, w.tick);
        return deepFreeze({ nowTick: w.tick, sensedTick: sensed?.tick ?? null, self: { entity: e, legalSlots: SLOTS.filter(s => castRejection(e, s, this.content, w.tick) === null), canMove: phase !== 'dead' && phase !== 'hitstun', canJump: phase === 'free' && e.body.grounded, receipts, passives: w.passiveRuntime.filter(r => r.entityId === e.id) }, opponent: sensed?.fighters.find(f => f.id !== e.id) ?? null, projectiles: sensed?.projectiles ?? [], visibleEvents, arena: { width: arena.width, height: arena.height, gravity: arena.gravity }, capabilities: { jump: true, horizontalMove: true } });
    }
    snapshot(): unknown { return deepFreeze({ ring: [...this.ring], pending: [...this.pending], lastSensed: [...this.lastSensed] }); }
}
