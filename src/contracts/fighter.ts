import type { ActionIntent, RngState, Vec2 } from './state.js';
import type { DeepReadonly, ContentBundle } from './content.js';
import type { Effect } from './content-schema.js';
import type { Slot } from './versions.js';
export const FIGHTER_BUILD = 'phase1-v1' as const;
export type FighterEngineBuild='phase1-v1'|'phase2-v1';
export type ActionState = {
    kind: 'free';
} | {
    kind: 'dead';
} | {
    kind: 'hitstun';
    untilTick: number;
} | {
    kind: 'cast';
    castId: number;
    requestId: number;
    abilityId: string;
    startedTick: number;
    startupTicks: number;
    activeTicks: number;
    recoveryTicks: number;
};
export interface StatusInstance {
    instanceId: number;
    definitionId: string;
    sourceId: number;
    sourceCastId: number | null;
    appliedTick: number;
    expiresTick: number;
    stacks: number;
}
export interface FighterEntity {
    id: number;
    participantId: string;
    characterId: string;
    body: {
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
    };
    hp: number;
    maxHp: number;
    energy: number;
    energySuppressedUntilTick: number;
    lastProcessedRequestId: number;
    action: ActionState;
    cooldownReadyTick: Record<Slot, number>;
    statuses: StatusInstance[];
    lastLaunchCastId: number | null;
    lastLaunchTick: number | null;
}
export interface FighterConfig {
    matchId: string;
    seed: number;
    rulesetId: 'fighter';
    rulesetVersion: 1;
    arenaId: string;
    contentHash: string;
    pacing: {
        mode: 'off';
        profileId: null;
    };
    participants: [
        {
            participantId: string;
            characterId: string;
            profileId: string;
        },
        {
            participantId: string;
            characterId: string;
            profileId: string;
        }
    ];
    maxTicks: number;
}
export interface FighterResult {
    matchId: string;
    reason: 'ko' | 'double-ko' | 'timeout' | 'invalid';
    winnerParticipantId: string | null;
    endedAfterTicks: number;
    remainingHp: [
        number,
        number
    ];
    diagnosticCode: string | null;
}
export interface HitSpec {
    damage: number;
    launchDeltaV: Vec2;
    hitstunTicks: number;
    hitGroup: string;
}
export interface Projectile {
    id: number;
    ownerId: number;
    sourceCastId: number;
    abilityId: string;
    position: {
        x: number;
        y: number;
    };
    velocity: {
        x: number;
        y: number;
    };
    radius: number;
    expiresTick: number;
    reflectionCount: number;
    ignoreOwnerUntilOutside: boolean;
    hit: HitSpec;
}
export interface Hitbox {
    id: number;
    ownerId: number;
    castId: number;
    localOffset: Vec2;
    baseRadius: number;
    radius: number;
    expiresTick: number;
    aimX: -1 | 1;
    hit: HitSpec;
}
export interface CastRuntime {
    castId: number;
    rootEventSeq: number;
    ownerId: number;
    requestId: number;
    abilityId: string;
    aimX: -1 | 1;
    startedTick: number;
    endsTick: number;
    firstEmissionTick: number | null;
    interruptedTick: number | null;
    finishedTick: number | null;
    scheduledPolicy: 'cancel-on-interrupt' | 'before-first-emission';
}
export interface ScheduledEffect {
    id: number;
    dueTick: number;
    ownerId: number;
    castId: number;
    effects: DeepReadonly<Effect>[];
}
export interface RubberRuntime {
    entityId: number;
    passiveId: 'rubber-wall-growth';
    nextAllowedTick: number;
    stacks: number;
    expiresTick: number;
}
export interface FighterWorld {
    schemaVersion: 2;
    tick: number;
    config: FighterConfig;
    rulesHash: string;
    contentHash: string;
    entities: [
        FighterEntity,
        FighterEntity
    ];
    projectiles: Projectile[];
    hitboxes: Hitbox[];
    casts: CastRuntime[];
    scheduledEffects: ScheduledEffect[];
    hitRegistry: {
        castId: number;
        hitGroup: string;
        targetId: number;
        lastHitTick: number;
    }[];
    passiveRuntime: RubberRuntime[];
    combatRngState: RngState;
    nextEntityId: number;
    nextCastId: number;
    nextStatusId: number;
    nextScheduleId: number;
    nextEventSeq: number;
    nextReceiptSeq: number;
    diagnostics: {
        tick: number;
        code: string;
        detail: string;
    }[];
    result: FighterResult | null;
}
export type WorldView = DeepReadonly<FighterWorld>;
export type ReceiptReason = 'ok' | 'busy' | 'cooldown' | 'resource' | 'air-ground' | 'conflict' | 'duplicate' | 'hitstun' | 'dead' | 'condition';
export interface ActionReceipt {
    receiptSeq: number;
    entityId: number;
    requestId: number;
    tick: number;
    result: 'accepted' | 'rejected' | 'finished' | 'interrupted';
    reason: ReceiptReason;
}
export interface EventPayloads {
    MatchStarted: {
        matchId: string;
    };
    CastAccepted: {
        requestId: number;
        castId: number;
        abilityId: string;
        slot: Slot;
    };
    CastFinished: {
        castId: number;
    };
    CastInterrupted: {
        castId: number;
        reason: 'hitstun' | 'dead';
    };
    ActionRejected: {
        requestId: number;
        reason: ReceiptReason;
    };
    Jumped: {
        requestId: number;
    };
    ProjectileSpawned: {
        projectileId: number;
        castId: number;
    };
    ProjectileExpired: {
        projectileId: number;
        reason: 'wall' | 'lifetime' | 'hit';
    };
    HitResolved: {
        castId: number;
        hitGroup: string;
        projectileId: number | null;
    };
    DamageResolved: {
        castId: number;
        amount: number;
        hpBefore: number;
        hpAfter: number;
    };
    DamagePrevented: {
        castId: number;
        preventedDamage: number;
    };
    WallBounce: {
        wall: 'left' | 'right' | 'floor' | 'ceiling';
        incomingNormalSpeed: number;
        castId: number | null;
    };
    StatusApplied: {
        statusId: string;
        expiresTick: number;
        stacks: number;
        castId: number | null;
    };
    StatusExpired: {
        statusId: string;
    };
    PassiveTriggered: {
        passiveId: string;
        stacks: number;
        expiresTick: number;
    };
    EntityDied: {
        lastDamageCastId: number | null;
    };
    Diagnostic: {
        code: string;
        detail: string;
    };
    MatchEnded: {
        result: FighterResult;
    };
}
export interface EventMeta {
    seq: number;
    tick: number;
    sourceId: number | null;
    targetId: number | null;
    position: Vec2 | null;
    rootEventId: number;
    parentEventId: number | null;
    depth: number;
}
export type BattleEvent = {
    [K in keyof EventPayloads]: EventMeta & {
        type: K;
        payload: EventPayloads[K];
    };
}[keyof EventPayloads];
export interface FighterStep {
    state: WorldView;
    events: readonly BattleEvent[];
    receipts: readonly ActionReceipt[];
}
export interface PublicFighter {
    id: number;
    characterId: string;
    position: Vec2;
    velocity: Vec2;
    radius: number;
    facing: -1 | 1;
    grounded: boolean;
    hpRatio: number;
    energyBand: 'low' | 'mid' | 'ready';
    tell: null | {
        abilityId: string;
        phase: 'startup' | 'active' | 'recovery';
        visibleSinceTick: number;
    };
    visibleStatusIds: readonly string[];
}
export interface PublicProjectile {
    id: number;
    ownerId: number;
    sourceCastId: number;
    abilityId: string;
    position: Vec2;
    velocity: Vec2;
    radius: number;
    reflectable: boolean;
}
export interface PublicEvent {
    seq: number;
    sourceTick: number;
    sourceId: number | null;
    targetId: number | null;
    detail: {
        kind: 'cast';
        castId: number;
        abilityId: string;
        slot: Slot;
    } | {
        kind: 'damage';
        castId: number;
        amount: number;
    } | {
        kind: 'bounce';
        incomingSpeed: number;
        wall: 'left' | 'right' | 'ceiling' | 'floor';
    } | {
        kind: 'jump';
    } | {
        kind: 'defend';
        castId: number;
        preventedDamage: number;
    } | {
        kind: 'death';
    };
}
export interface PublicSnapshot {
    tick: number;
    fighters: readonly PublicFighter[];
    projectiles: readonly PublicProjectile[];
    events: readonly PublicEvent[];
}
export interface Observation {
    nowTick: number;
    sensedTick: number | null;
    self: {
        entity: DeepReadonly<FighterEntity>;
        legalSlots: readonly Slot[];
        canMove: boolean;
        canJump: boolean;
        receipts: readonly ActionReceipt[];
        passives: readonly DeepReadonly<RubberRuntime>[];
    };
    opponent: PublicFighter | null;
    projectiles: readonly PublicProjectile[];
    visibleEvents: readonly PublicEvent[];
    arena: {
        width: number;
        height: number;
        gravity: Vec2;
    };
    capabilities: {
        jump: boolean;
        horizontalMove: boolean;
    };
}
export type ControllerKind = 'rush' | 'ranged' | 'idle';
export interface ScriptSnapshot {
    version: 1;
    rngState: RngState;
    nextDecisionTick: number;
    moveX: -1 | 0 | 1;
    nextRequestId: number;
    lastReceiptSeq: number;
    lastVisibleEventSeq: number;
}
export interface ScriptController {
    update(observation: Observation): ActionIntent;
    snapshot(): ScriptSnapshot;
    restore(snapshot: ScriptSnapshot): void;
}
export interface RenderFighter {
    id: number;
    characterId: string;
    position: Vec2;
    velocity: Vec2;
    radius: number;
    facing: -1 | 1;
    hp: number;
    maxHp: number;
    energy: number;
    grounded: boolean;
    actionPhase: 'free' | 'startup' | 'active' | 'recovery' | 'hitstun' | 'dead';
    abilityId: string | null;
    visibleStatusIds: readonly string[];
    cooldownReadyTick: Readonly<Record<Slot, number>>;
    wallStacks: number;
}
export interface RenderFrame {
    tick: number;
    entities: readonly RenderFighter[];
    projectiles: readonly {
        id: number;
        ownerId: number;
        position: Vec2;
        radius: number;
    }[];
    hitboxes: readonly {
        id: number;
        position: Vec2;
        radius: number;
    }[];
    result: DeepReadonly<FighterResult> | null;
}
export interface InputEntry {
    tick: number;
    intents: readonly [
        ActionIntent,
        ActionIntent
    ];
}
export interface InputReplay {
    replaySchemaVersion: 2;
    engineBuild: FighterEngineBuild;
    config: FighterConfig;
    content: ContentBundle['source'];
    pluginVersions: ContentBundle['pluginVersions'];
    inputs: readonly InputEntry[];
    events: readonly BattleEvent[];
    checkpoints: readonly {
        tick: number;
        worldHash: string;
    }[];
    finalWorldHash: string;
    result: DeepReadonly<FighterResult>;
}
