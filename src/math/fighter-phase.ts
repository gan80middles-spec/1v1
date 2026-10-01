import type { WorldView } from '../contracts/fighter.js';
export function actionPhase(entity: WorldView['entities'][number], tick: number): 'free' | 'startup' | 'active' | 'recovery' | 'hitstun' | 'dead' {
    const a = entity.action;
    if (a.kind === 'hitstun')
        return tick < a.untilTick ? 'hitstun' : 'free';
    if (a.kind !== 'cast')
        return a.kind;
    const age = tick - a.startedTick;
    return age < a.startupTicks ? 'startup' : age < a.startupTicks + a.activeTicks ? 'active' : age < a.startupTicks + a.activeTicks + a.recoveryTicks ? 'recovery' : 'free';
}
