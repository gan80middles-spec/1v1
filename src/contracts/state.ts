import type { Slot } from './versions.js';

export type Tick = number;
export type Vec2 = Readonly<{ x: number; y: number }>;
export type RngState = readonly [number, number, number, number];

export interface ActionIntent {
  readonly moveX: -1 | 0 | 1;
  readonly jumpPressed: boolean;
  readonly cast: Readonly<{ slot: Slot; aimX: -1 | 1 }> | null;
  readonly requestId: number | null;
}

export const NEUTRAL_INTENT: ActionIntent = Object.freeze({ moveX: 0, jumpPressed: false, cast: null, requestId: null });

// Phase 0 的全部持续状态。后续机制必须同步扩展 schema、restore 和 hash。
export interface Entity {
  readonly id: number;
  readonly participantId: string;
  readonly characterId: string;
  readonly body: Readonly<{
    position: Vec2; velocity: Vec2; radius: number; mass: number;
    grounded: boolean; facing: -1 | 1;
  }>;
  readonly hp: number;
  readonly maxHp: number;
  readonly energy: number;
}

export interface MatchConfig {
  readonly matchId: string;
  readonly seed: number;
  readonly rulesetId: 'phase0-neutral-fixture';
  readonly rulesetVersion: 1;
  readonly arenaId: string;
  readonly contentHash: string;
  readonly pacing: Readonly<{ mode: 'off'; profileId: null }>;
  readonly participants: readonly [
    Readonly<{ participantId: string; characterId: string; profileId: string }>,
    Readonly<{ participantId: string; characterId: string; profileId: string }>,
  ];
  readonly maxTicks: number;
}

export interface MatchResult {
  readonly matchId: string;
  readonly reason: 'timeout';
  readonly winnerParticipantId: string | null;
  readonly endedAfterTicks: number;
  readonly remainingHp: readonly [number, number];
  readonly diagnosticCode: null;
}

export interface WorldState {
  readonly schemaVersion: 1;
  readonly tick: Tick;
  readonly config: MatchConfig;
  readonly rulesHash: string;
  readonly contentHash: string;
  readonly entities: readonly [Entity, Entity];
  readonly combatRngState: RngState;
  readonly nextEventSeq: number;
  readonly result: MatchResult | null;
}

export type DomainEvent = Readonly<{
  seq: number; tick: Tick; type: 'MatchEnded'; payload: Readonly<{ result: MatchResult }>;
}>;

export interface StepResult {
  readonly state: WorldState;
  readonly events: readonly DomainEvent[];
}

// 输入重放只比较 worldHash；未来 runnerHash 必须包含这里所有持续组件。
export interface RunnerHashInput {
  readonly world: WorldState;
  readonly controllers: readonly unknown[];
  readonly pacingDirector: unknown;
  readonly publicSnapshotRing: readonly unknown[];
  readonly pendingSelfReceipts: readonly unknown[];
  readonly recorderCursor: number;
}
