import type { AIProfile } from './content-schema.js';
import type { DeepReadonly } from './content.js';
import type { ActionReceipt, BattleEvent, ControllerKind, FighterConfig, InputEntry, PublicFighter, PublicSnapshot, WorldView } from './fighter.js';
import type { ActionIntent, RngState, Vec2 } from './state.js';
import type { Slot } from './versions.js';
export const UTILITY_BUILD = 'phase2-v1' as const;
export const AI_VERSION = 'utility-v1' as const;
export type RunnerControllerKind = ControllerKind | 'utility';
export interface UtilitySettings {
    noise: boolean;
    randomChoice: boolean;
    memory: boolean;
}
export const DEFAULT_UTILITY_SETTINGS: UtilitySettings = { noise: true, randomChoice: true, memory: true };
export type ContextKind = 'near-ground' | 'far-ground' | 'air';
export type EncounterOutcome = 'basic' | 'skill' | 'jump' | 'retreat' | 'other';
export interface EncounterSample {
    startedTick: number;
    completedTick: number;
    context: ContextKind;
    outcome: EncounterOutcome;
}
export interface OwnResult {
    slot: Slot;
    completedTick: number;
    result: 'hit' | 'defended' | 'repositioned' | 'miss';
}
export interface PendingOwnResult {
    requestId: number;
    castId: number | null;
    slot: Slot;
    abilityId: string;
    startedTick: number;
    aimX: -1 | 1;
    startPosition: Vec2;
    finalEffectTick: number;
    resultDueTick: number;
    effective: OwnResult['result'] | null;
    accepted: boolean;
    finished: boolean;
}
export interface AIMemory {
    lastVisibleEventSeq: number;
    encounters: EncounterSample[];
    recentOwnResults: OwnResult[];
    lastEffectiveInteractionTick: number;
    ultimateReadySinceTick: number | null;
    lastPositions: {
        tick: number;
        position: Vec2;
        grounded: boolean;
    }[];
    opponentCooldownEstimates: {
        abilityId: string;
        earliestReadyTick: number;
        latestReadyTick: number;
        confidence: number;
    }[];
    pendingEncounter: null | {
        startedSourceTick: number;
        context: ContextKind;
        observedOutcome: EncounterOutcome | null;
    };
    pendingOwnResults: PendingOwnResult[];
    stuckUntilTick: number;
    blockedMoveX: -1 | 0 | 1;
    blockedSinceTick: number | null;
    lastEncounterStartedTick: number;
    lastSensedTick: number | null;
    lastDistance: number | null;
    insideBand: boolean;
    retreatSinceTick: number | null;
    lastHp: number | null;
    lastMatureProjectileIds: number[];
    diagnostics: {
        tick: number;
        code: string;
    }[];
}
export interface ExecutionMemory {
    optionKey: string | null;
    moveX: -1 | 0 | 1;
    selectedTick: number;
    minimumHoldUntilTick: number;
    activeRequestId: number | null;
    triggerSent: boolean;
    expectedFinishTick: number | null;
    lastReceiptSeq: number;
    nextRequestId: number;
    activeSlot: Slot | null;
    activeAimX: -1 | 1;
    activeStartedTick: number | null;
}
export interface UtilitySnapshot {
    version: 1;
    aiVersion: typeof AI_VERSION;
    contentHash: string;
    profile: AIProfile;
    settings: UtilitySettings;
    decisionIndex: number;
    lastDecisionTick: number | null;
    nextDecisionTick: number;
    rngState: RngState;
    memory: AIMemory;
    execution: ExecutionMemory;
}
export interface Option {
    key: string;
    kind: 'move' | 'jump' | 'cast';
    moveX: -1 | 0 | 1;
    slot: Slot | null;
    aimX: -1 | 1;
    legal: boolean;
    reason: string | null;
    tag: string;
}
export interface MotionState {
    position: {
        x: number;
        y: number;
    };
    velocity: {
        x: number;
        y: number;
    };
    radius: number;
    mass: number;
    grounded: boolean;
    facing: -1 | 1;
}
export interface MotionParams {
    restitution: number;
    moveSpeed: number;
    groundAcceleration: number;
    airAcceleration: number;
    jumpSpeed: number;
    damageTaken: number;
    knockbackTaken: number;
    wallGrowth: number;
}
export interface Belief {
    opponent: PublicFighter | null;
    age: number | null;
    confidence: number;
    offsets: {
        x: number;
        y: number;
        vx: number;
        vy: number;
    };
    hypotheses: {
        kind: 'keep' | 'approach' | 'retreat';
        moveX: -1 | 0 | 1;
        weight: number;
    }[];
    adapted: boolean;
}
export interface ThreatWindow {
    id: string;
    sourceId: number;
    kind: 'committed' | 'possible-basic';
    origin: 'projectile' | 'cast' | 'possible';
    abilityId: string;
    startInTicks: number;
    endInTicks: number;
    estimatedDamage: number;
    likelihood: number;
    reflectable: boolean;
    projectileId: number | null;
}
export interface OutcomeEstimate {
    expectedDamageDealtPct: number;
    meanDamageTakenPct: number;
    worstDamageTakenPct: number;
    killLikelihood: number;
    deathLikelihood: number;
    positionQualityBefore: number;
    positionQualityAfter: number;
    bandProgressPx: number;
    residualExposurePct: number;
    setupValue: number;
    confidence: number;
    earlyRiskPct: number;
    hitTicks: number[];
    segmentsUsed: number;
    budgetExceeded: boolean;
    setupConfidence: number;
    setupReason: string;
}
export interface UtilityScore {
    D: number;
    L: number;
    P: number;
    K: number;
    X: number;
    C: number;
    E: number;
    R: number;
    B: number;
    wD: number;
    wL: number;
    wP: number;
    wC: number;
    Uraw: number;
    stuckBonus: number;
    wallCost: number;
}
export interface CandidateTrace {
    option: Option;
    outcome: OutcomeEstimate | null;
    score: UtilityScore | null;
    switchMargin: number;
    eligible: boolean;
}
export interface AITrace {
    aiVersion: typeof AI_VERSION;
    nowTick: number;
    sensedTick: number | null;
    decisionIndex: number;
    profileId: string;
    profileVersion: number;
    belief: Belief;
    threats: ThreatWindow[];
    candidates: CandidateTrace[];
    continuationKey: string | null;
    continuationScore: number | null;
    selectedKey: string | null;
    poolKeys: string[];
    randomBits: number;
    choiceDraw: number;
    emergency: boolean;
    commitmentHeld: boolean;
    stuck: boolean;
    blockedMoveX: -1 | 0 | 1;
    requestId: number | null;
    input: ActionIntent;
    executionBefore: ExecutionMemory;
}
export interface ObservationSnapshot {
    version: 1;
    ring: PublicSnapshot[];
    pending: ActionReceipt[];
    lastSensed: [
        number,
        number
    ];
}
export type ControllerCheckpoint = {
    kind: 'utility';
    data: UtilitySnapshot;
} | {
    kind: ControllerKind;
    data: import('./fighter.js').ScriptSnapshot;
};
export interface UtilityRunnerOptions {
    kinds: readonly [
        RunnerControllerKind,
        RunnerControllerKind
    ];
    settings: UtilitySettings;
    trace: boolean;
    recordFrames: boolean;
}
export interface FullCheckpoint {
    checkpointVersion: 1;
    engineBuild: typeof UTILITY_BUILD;
    aiVersion: typeof AI_VERSION;
    contentHash: string;
    config: FighterConfig;
    nextTick: number;
    world: WorldView;
    controllers: readonly [
        ControllerCheckpoint,
        ControllerCheckpoint
    ];
    observations: ObservationSnapshot;
    settings: UtilitySettings;
    pacingDirector: null;
    recorderCursor: number;
    runnerHash: string;
    recording?: {
        inputs: readonly InputEntry[];
        events: readonly BattleEvent[];
        checkpoints: readonly {
            tick: number;
            worldHash: string;
        }[];
    };
}
export interface UtilityControllerLike {
    update(observation: import('./fighter.js').Observation): ActionIntent;
    snapshot(): DeepReadonly<UtilitySnapshot>;
}
export interface RunnerSuffix {
    inputs: readonly InputEntry[];
}
