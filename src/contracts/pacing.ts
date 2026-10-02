import type { PublicSnapshot } from './fighter.js';
import type { ContentSource } from './content-schema.js';
import type { Slot } from './versions.js';
export type PacingMode = 'off' | 'observe' | 'pace';
export type PacingProfile = ContentSource['pacingProfiles'][number];
export type DirectorCueKind = 'engage' | 'vary' | 'showcase';
export interface ConfirmedPublicUse {
    castId: number;
    actorId: number;
    slot: Slot;
    completedTick: number;
    effective: boolean;
}
export interface DirectorEvidence {
    lastEffectiveInteractionTick: number;
    quietTicks: number;
    misses: {
        actorId: number;
        slot: Slot;
        count: number;
    }[];
    ready: {
        entityId: number;
        sinceTick: number | null;
    }[];
}
export interface DirectorCue {
    id: number;
    kind: DirectorCueKind;
    issuedTick: number;
    basedOnTick: number;
    applyTick: number;
    expiresTick: number;
    profileId: string;
    profileVersion: number;
    evidence: DirectorEvidence;
    liveEvidence?: {
        basedOnTick: number;
        evidence: DirectorEvidence;
    } | undefined;
}
export interface PendingPublicCast {
    castId: number;
    actorId: number;
    abilityId: string;
    slot: Slot;
    firstSeenTick: number;
    latestPossibleEffectEndTick: number;
    effective: boolean;
    startPosition: {
        x: number;
        y: number;
    };
    startGap: number;
    damage: number;
}
export interface PacingDirectorSnapshot {
    version: 1;
    mode: 'observe' | 'pace';
    profileId: string;
    profileVersion: number;
    nextUpdateTick: number;
    nextCueId: number;
    emittedCueCount: number;
    neutralUntilTick: number;
    currentCue: DirectorCue | null;
    recentPublicSamples: PublicSnapshot[];
    lastConsumedEventSeq: number;
    lastConsumedSnapshotTick: number | null;
    lastEffectiveInteractionTick: number;
    damageSinceInteraction: number;
    readySinceByEntity: {
        entityId: number;
        sinceTick: number | null;
    }[];
    pendingPublicCasts: PendingPublicCast[];
    completedUses: ConfirmedPublicUse[];
}
export interface DirectorRecord {
    tick: number;
    type: 'issued' | 'fade' | 'ended';
    cue: DirectorCue;
    reason: string;
}
export interface DirectorAdjustment {
    cueId: number;
    kind: DirectorCueKind;
    intensity: number;
    raw: number;
    applied: number;
    riskAllowed: boolean;
    baseAllowed: boolean;
    stackCap: number;
    reason: string;
}
export function cueIntensity(cue: DirectorCue, nowTick: number, rampTicks: number): number { return Math.max(0, Math.min(1, (nowTick - cue.applyTick) / rampTicks, (cue.expiresTick - nowTick) / rampTicks)); }
