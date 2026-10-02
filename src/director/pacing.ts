import type { ContentBundle } from '../contracts/content.js';
import type { PublicSnapshot } from '../contracts/fighter.js';
import type { DirectorCue, DirectorRecord, PacingDirectorSnapshot, PacingProfile, DirectorEvidence } from '../contracts/pacing.js';
import { PacingDirectorSnapshotSchema, PublicSnapshotSchema } from '../contracts/ai-schema.js';
import { deepFreeze } from '../math/canonical.js';
import { SLOTS } from '../contracts/versions.js';
// The director accepts public source frames only. It has no world or controller handle.
export class PacingDirector {
    private state: PacingDirectorSnapshot;
    readonly records: DirectorRecord[] = [];
    constructor(readonly content: ContentBundle, readonly profile: PacingProfile, mode: 'observe' | 'pace', readonly logEnabled = true, readonly delayTicks = 10) {
        if (!Number.isInteger(delayTicks) || delayTicks < 1 || delayTicks > 31)
            throw new Error('Director delay out of bounds');
        this.state = { version: 1, mode, profileId: profile.id, profileVersion: profile.version, nextUpdateTick: 0, nextCueId: 1, emittedCueCount: 0, neutralUntilTick: 0, currentCue: null, recentPublicSamples: [], lastConsumedEventSeq: 0, lastConsumedSnapshotTick: null, lastEffectiveInteractionTick: 0, damageSinceInteraction: 0, readySinceByEntity: [], pendingPublicCasts: [], completedUses: [] };
    }
    get nextUpdateTick(): number { return this.state.nextUpdateTick; }
    get lastConsumedSnapshotTick(): number | null { return this.state.lastConsumedSnapshotTick; }
    get currentCue(): DirectorCue | null { return this.state.currentCue; }
    update(frames: readonly PublicSnapshot[], nowTick: number): DirectorCue | null {
        if (nowTick !== this.state.nextUpdateTick)
            throw new Error('Director update schedule mismatch');
        if (frames.some(f => f.tick > nowTick - this.delayTicks))
            throw new Error('Director received an immature public snapshot');
        const cutoff = nowTick - this.delayTicks, expectedCount = Math.max(0, cutoff - (this.state.lastConsumedSnapshotTick ?? -1));
        if (frames.length !== expectedCount)
            throw new Error('Director missing public snapshot interval');
        this.state.nextUpdateTick = nowTick + this.profile.sampleIntervalTicks;
        for (const frame of frames)
            this.consume(frame);
        if (this.state.currentCue && this.state.lastConsumedSnapshotTick !== null)
            this.state.currentCue = deepFreeze({ ...this.state.currentCue, liveEvidence: { basedOnTick: this.state.lastConsumedSnapshotTick, evidence: this.evidence(this.state.lastConsumedSnapshotTick) } });
        const cue = this.state.currentCue;
        if (cue && nowTick >= cue.expiresTick) {
            this.record({ tick: nowTick, type: 'ended', cue, reason: 'fixed-envelope-ended' });
            this.state.currentCue = null;
        }
        else if (cue && nowTick >= cue.expiresTick - this.profile.rampTicks && nowTick - this.profile.sampleIntervalTicks < cue.expiresTick - this.profile.rampTicks)
            this.record({ tick: nowTick, type: 'fade', cue, reason: 'fixed-envelope-fade' });
        const basedOnTick = this.state.lastConsumedSnapshotTick;
        if (this.state.currentCue || basedOnTick === null || nowTick < this.profile.initialQuietTicks || nowTick < this.state.neutralUntilTick || this.state.emittedCueCount >= this.profile.maxCuesPerMatch)
            return this.currentCue;
        const evidence = this.evidence(basedOnTick), kind = evidence.quietTicks >= this.profile.noInteractionThresholdTicks ? 'engage' : evidence.quietTicks >= 60 && evidence.misses.some(m => m.count >= this.profile.repeatedMissThreshold) ? 'vary' : evidence.quietTicks >= 60 && evidence.ready.some(r => r.sinceTick !== null && basedOnTick - r.sinceTick >= this.profile.readyHoldThresholdTicks) ? 'showcase' : null;
        if (kind) {
            const applyTick = nowTick + 1, created: DirectorCue = { id: this.state.nextCueId++, kind, issuedTick: nowTick, basedOnTick, applyTick, expiresTick: applyTick + this.profile.cueDurationTicks, profileId: this.profile.id, profileVersion: this.profile.version, evidence };
            this.state.currentCue = deepFreeze(created);
            this.state.emittedCueCount++;
            this.state.neutralUntilTick = created.expiresTick + this.profile.neutralBetweenCuesTicks;
            this.record({ tick: nowTick, type: 'issued', cue: created, reason: kind === 'engage' ? 'no-effective-interaction' : kind === 'vary' ? 'three-confirmed-ineffective-uses' : 'public-energy-held-ready' });
        }
        return this.currentCue;
    }
    private consume(input: PublicSnapshot): void {
        // Runner frames have already been validated; restore and external calls use the same whitelist.
        const frame = PublicSnapshotSchema.parse(input), s = this.state, expected = (s.lastConsumedSnapshotTick ?? -1) + 1;
        if (frame.tick !== expected)
            throw new Error(`Director missing public snapshot ${expected}`);
        const previous = s.recentPublicSamples.at(-1);
        // S[t+1] may already have removed a buff that contributed during event tick t.
        // Reconstruct that public interval from S[t] and earlier public status receipts.
        const effectsAt = (entityId: number | null, sourceTick: number, seq: number) => {
            let effects = [...(previous?.fighters.find(f => f.id === entityId)?.visibleEffects ?? [])].filter(effect => effect.expiresTick > sourceTick);
            for (const receipt of frame.events) {
                const detail = receipt.detail;
                if (receipt.seq > seq || receipt.sourceId !== entityId || detail.kind !== 'status') continue;
                const status = this.content.source.statuses.find(status => status.id === detail.statusId)!;
                if (status.stacking !== 'stack') effects = effects.filter(effect => effect.statusId !== detail.statusId);
                if (detail.expiresTick > sourceTick) effects.push({castId: detail.castId, statusId: detail.statusId, expiresTick: detail.expiresTick});
            }
            return effects;
        };
        if (new Set(frame.fighters.map(f => f.id)).size !== 2 || frame.events.some(e => e.sourceTick >= frame.tick))
            throw new Error('Director public frame identity/maturity mismatch');
        for (const f of frame.fighters) {
            let r = s.readySinceByEntity.find(r => r.entityId === f.id);
            if (!r) {
                r = { entityId: f.id, sinceTick: null };
                s.readySinceByEntity.push(r);
            }
            r.sinceTick = f.energyBand === 'ready' ? (r.sinceTick ?? frame.tick) : null;
        }
        for (const e of frame.events) {
            if (e.seq <= s.lastConsumedEventSeq)
                throw new Error('Director duplicate/out-of-order public event');
            s.lastConsumedEventSeq = e.seq;
            const d = e.detail;
            if (d.kind === 'cast' && e.sourceId !== null) {
                if (s.pendingPublicCasts.length >= 64)
                    throw new Error('Director pending public cast budget exceeded');
                const a = this.content.source.abilities.find(a => a.id === d.abilityId);
                if (!a)
                    throw new Error('Director unknown public ability');
                const actor = frame.fighters.find(f => f.id === e.sourceId)!, other = frame.fighters.find(f => f.id !== e.sourceId)!;
                const extra = Math.max(0, ...a.timeline.flatMap(t => t.effects.map(effect => t.offsetTick + (effect.kind === 'projectile' ? effect.lifetimeTicks : effect.kind === 'hitbox' ? effect.durationTicks : effect.kind === 'status' ? this.content.source.statuses.find(x => x.id === effect.statusId)!.durationTicks : 0))));
                s.pendingPublicCasts.push({ castId: d.castId, actorId: e.sourceId, abilityId: d.abilityId, slot: d.slot, firstSeenTick: e.sourceTick, latestPossibleEffectEndTick: e.sourceTick + Math.max(a.startupTicks + a.activeTicks + a.recoveryTicks, extra), effective: false, startPosition: { ...actor.position }, startGap: this.gap(actor.characterId, actor.position, other.position), damage: 0 });
            }
            if (d.kind === 'damage') {
                s.damageSinceInteraction += d.amount;
                if (s.damageSinceInteraction >= 1) {
                    s.lastEffectiveInteractionTick = frame.tick;
                    s.damageSinceInteraction = 0;
                }
                const p = s.pendingPublicCasts.find(p => p.castId === d.castId && p.actorId === e.sourceId);
                if (p) {
                    p.damage += d.amount;
                    p.effective ||= p.damage >= 1;
                }
                for (const effect of effectsAt(e.sourceId, e.sourceTick, e.seq)) {
                    const status = this.content.source.statuses.find(x => x.id === effect.statusId)!;
                    if (status.modifiers.meleeHitboxScale > 1 && p && this.content.source.abilities.find(x => x.id === p.abilityId)!.tags.includes('melee')) {
                        const buff = s.pendingPublicCasts.find(x => x.castId === effect.castId);
                        if (buff && d.amount >= 1)
                            buff.effective = true;
                    }
                }
            }
            if ((d.kind === 'defend' && d.preventedDamage > 0) || d.kind === 'reflect' || d.kind === 'dissipate') {
                s.lastEffectiveInteractionTick = frame.tick;
                s.damageSinceInteraction = 0;
                const id = d.kind === 'defend' ? d.castId : d.defenseCastId;
                const p = s.pendingPublicCasts.find(p => p.castId === id && p.actorId === e.sourceId);
                if (p)
                    p.effective = true;
            }
            if (d.kind === 'status') {
                const p = s.pendingPublicCasts.find(p => p.castId === d.castId);
                if (p)
                    p.latestPossibleEffectEndTick = Math.max(p.latestPossibleEffectEndTick, d.expiresTick);
            }
            if (d.kind === 'growth') {
                for (const effect of effectsAt(e.sourceId, e.sourceTick, e.seq)) {
                    const status = this.content.source.statuses.find(x => x.id === effect.statusId)!;
                    if (status.modifiers.wallGrowthCoefficientOverride !== null) {
                        const p = s.pendingPublicCasts.find(p => p.castId === effect.castId);
                        if (p)
                            p.effective = true;
                    }
                }
            }
            if (d.kind === 'cast-ended' && d.interrupted) {
                const p = s.pendingPublicCasts.find(p => p.castId === d.castId);
                if (p) {
                    const a = this.content.source.abilities.find(a => a.id === p.abilityId)!;
                    if ((a.scheduledPolicy ?? 'cancel-on-interrupt') === 'cancel-on-interrupt' || e.sourceTick < p.firstSeenTick + Math.min(...a.timeline.map(t => t.offsetTick)))
                        p.latestPossibleEffectEndTick = Math.min(p.latestPossibleEffectEndTick, frame.tick);
                }
            }
        }
        for (const p of s.pendingPublicCasts) {
            const actor = frame.fighters.find(f => f.id === p.actorId)!, other = frame.fighters.find(f => f.id !== p.actorId)!, a = this.content.source.abilities.find(a => a.id === p.abilityId)!;
            if (a.tags.includes('mobility') && Math.hypot(actor.position.x - p.startPosition.x, actor.position.y - p.startPosition.y) >= 40 && p.startGap - this.gap(actor.characterId, actor.position, other.position) >= 40)
                p.effective = true;
            if (a.timeline.some(t => t.effects.some(e => e.kind === 'heal')) && previous && (actor.hpRatio - (previous.fighters.find(f => f.id === p.actorId)?.hpRatio ?? 1)) * this.content.source.characters.find(x => x.id === actor.characterId)!.stats.maxHp >= 1)
                p.effective = true;
            const hasEffect = frame.projectiles.some(x => x.sourceCastId === p.castId) || frame.fighters.some(f => f.tell?.abilityId === p.abilityId && f.tell.visibleSinceTick === p.firstSeenTick) || frame.fighters.some(f => f.visibleEffects?.some(e => e.castId === p.castId && e.expiresTick > frame.tick));
            if (frame.tick > p.latestPossibleEffectEndTick && !hasEffect)
                s.completedUses.push({ castId: p.castId, actorId: p.actorId, slot: p.slot, completedTick: frame.tick, effective: p.effective });
        }
        const completed = new Set(s.completedUses.map(p => p.castId));
        s.pendingPublicCasts = s.pendingPublicCasts.filter(p => !completed.has(p.castId));
        s.completedUses = s.completedUses.filter(p => p.completedTick >= frame.tick - 180);
        if (s.completedUses.length > 128)
            throw new Error('Director confirmed cast budget exceeded');
        s.recentPublicSamples.push(frame);
        if (s.recentPublicSamples.length > 361)
            s.recentPublicSamples.shift();
        s.lastConsumedSnapshotTick = frame.tick;
    }
    private gap(characterId: string, a: {
        x: number;
        y: number;
    }, b: {
        x: number;
        y: number;
    }): number { const c = this.content.source.characters.find(c => c.id === characterId)!, ability = this.content.source.abilities.find(x => x.id === c.slots.basic)!, d = Math.hypot(a.x - b.x, a.y - b.y), [lo, hi] = ability.ai.preferredCenterDistance; return Math.max(lo - d, 0, d - hi); }
    private evidence(tick: number): DirectorEvidence { return { lastEffectiveInteractionTick: this.state.lastEffectiveInteractionTick, quietTicks: tick - this.state.lastEffectiveInteractionTick, ready: structuredClone(this.state.readySinceByEntity), misses: this.state.readySinceByEntity.flatMap(r => SLOTS.map(slot => { const uses = this.state.completedUses.filter(p => p.actorId === r.entityId && p.slot === slot && p.completedTick >= tick - 180), last = Math.max(0, ...uses.filter(p => p.effective).map(p => p.castId), ...this.state.pendingPublicCasts.filter(p => p.actorId === r.entityId && p.slot === slot && p.effective).map(p => p.castId)); return { actorId: r.entityId, slot, count: uses.filter(p => !p.effective && p.castId > last).length }; })) }; }
    private record(record: DirectorRecord): void { if (this.logEnabled)
        this.records.push(deepFreeze(record)); }
    snapshot(): PacingDirectorSnapshot { return deepFreeze(structuredClone(this.state)); }
    finish(nowTick: number): void { if (this.state.currentCue) {
        this.record({ tick: nowTick, type: 'ended', cue: this.state.currentCue, reason: 'match-ended' });
        this.state.currentCue = null;
    } }
    restore(input: unknown): void { const data = PacingDirectorSnapshotSchema.parse(input); if (data.mode !== this.state.mode || data.profileId !== this.profile.id || data.profileVersion !== this.profile.version || data.nextCueId !== data.emittedCueCount + 1 || data.emittedCueCount > this.profile.maxCuesPerMatch || data.recentPublicSamples.at(-1)?.tick !== (data.lastConsumedSnapshotTick ?? undefined) || data.recentPublicSamples.some((f, i) => i > 0 && f.tick !== data.recentPublicSamples[i - 1]!.tick + 1) || data.currentCue && (data.currentCue.id !== data.nextCueId - 1 || data.currentCue.profileId !== this.profile.id || data.currentCue.profileVersion !== this.profile.version || data.currentCue.applyTick !== data.currentCue.issuedTick + 1 || data.currentCue.expiresTick !== data.currentCue.applyTick + this.profile.cueDurationTicks))
        throw new Error('Director checkpoint identity/cursor mismatch'); this.state = data; this.records.length = 0; }
}
