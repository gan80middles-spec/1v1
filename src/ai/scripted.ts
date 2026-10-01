import type { ContentBundle } from '../contracts/content.js';
import type { ControllerKind, Observation, ScriptController, ScriptSnapshot } from '../contracts/fighter.js';
import type { ActionIntent } from '../contracts/state.js';
import { NEUTRAL_INTENT } from '../contracts/state.js';
import type { Slot } from '../contracts/versions.js';
import { Xoshiro128ss } from '../math/random.js';
import { deepFreeze } from '../math/canonical.js';
export class BaselineController implements ScriptController {
    private rng: Xoshiro128ss;
    private nextDecisionTick = 0;
    private moveX: -1 | 0 | 1 = 0;
    private nextRequestId = 1;
    private lastReceiptSeq = 0;
    private lastVisibleEventSeq = 0;
    constructor(private kind: ControllerKind, seed: number, private content: ContentBundle) { this.rng = new Xoshiro128ss(seed); }
    update(o: Observation): ActionIntent {
        for (const r of o.self.receipts)
            this.lastReceiptSeq = Math.max(this.lastReceiptSeq, r.receiptSeq);
        for (const e of o.visibleEvents)
            this.lastVisibleEventSeq = Math.max(this.lastVisibleEventSeq, e.seq);
        if (this.kind === 'idle')
            return NEUTRAL_INTENT;
        if (o.nowTick < this.nextDecisionTick)
            return { ...NEUTRAL_INTENT, moveX: o.self.canMove ? this.moveX : 0 };
        this.nextDecisionTick = o.nowTick + 12;
        const draw = this.rng.next01(), self = o.self.entity, p = self.body.position;
        if (!o.opponent) {
            const target = o.arena.width / 2 + (self.id === 1 ? -self.body.radius : self.body.radius);
            this.moveX = Math.abs(target - p.x) < 10 ? 0 : target > p.x ? 1 : -1;
            return { ...NEUTRAL_INTENT, moveX: o.self.canMove ? this.moveX : 0 };
        }
        const enemy = o.opponent, dx = enemy.position.x - p.x, dy = enemy.position.y - p.y, aimX: 1 | -1 = dx >= 0 ? 1 : -1, distance = Math.hypot(dx, dy);
        const preferred = this.kind === 'ranged' ? 260 : 80;
        this.moveX = Math.abs(dx) > preferred ? aimX : this.kind === 'ranged' && Math.abs(dx) < 180 ? (aimX === 1 ? -1 : 1) : 0;
        const character = this.content.source.characters.find(c => c.id === self.characterId)!;
        const candidates = o.self.legalSlots.filter(slot => {
            const a = this.content.source.abilities.find(a => a.id === character.slots[slot])!;
            if (a.tags.includes('defense'))
                return o.projectiles.some(p => p.ownerId !== self.id && Math.abs(p.position.x - self.body.position.x) < 210) || distance < 150;
            if (a.tags.includes('buff'))
                return distance < 500;
            if (a.tags.includes('mobility'))
                return distance > 100 && distance < 400 && Math.abs(dy) < 100;
            if (a.tags.includes('projectile'))
                return distance > 120 && distance < 650 && Math.abs(dy) < 75;
            return distance < 135 && Math.abs(dy) < 85;
        });
        const priority: Slot[] = self.energy >= 100 ? ['ultimate', 'skill2', 'skill1', 'basic'] : this.kind === 'ranged' ? ['skill1', 'skill2', 'basic', 'ultimate'] : draw < .5 ? ['skill2', 'basic', 'skill1', 'ultimate'] : ['basic', 'skill1', 'skill2', 'ultimate'];
        const slot = priority.find(s => candidates.includes(s));
        if (slot)
            return { moveX: o.self.canMove ? this.moveX : 0, jumpPressed: false, cast: { slot, aimX }, requestId: this.nextRequestId++ };
        const jump = o.self.canJump && (dy > 70 || (draw < .12 && distance < 450));
        return { moveX: o.self.canMove ? this.moveX : 0, jumpPressed: jump, cast: null, requestId: jump ? this.nextRequestId++ : null };
    }
    snapshot(): ScriptSnapshot { return deepFreeze({ version: 1, rngState: this.rng.snapshot(), nextDecisionTick: this.nextDecisionTick, moveX: this.moveX, nextRequestId: this.nextRequestId, lastReceiptSeq: this.lastReceiptSeq, lastVisibleEventSeq: this.lastVisibleEventSeq }); }
    restore(s: ScriptSnapshot): void {
        if (s.version !== 1 || !Number.isInteger(s.nextRequestId) || s.nextRequestId < 1)
            throw new Error('Bad controller snapshot');
        this.rng.restore(s.rngState);
        this.nextDecisionTick = s.nextDecisionTick;
        this.moveX = s.moveX;
        this.nextRequestId = s.nextRequestId;
        this.lastReceiptSeq = s.lastReceiptSeq;
        this.lastVisibleEventSeq = s.lastVisibleEventSeq;
    }
}
