import type { CandidateTrace, ExecutionMemory, Option } from '../contracts/ai.js';
export function switchMargin(option: Option, current: number | null): number { return current === null ? 0 : option.kind === 'cast' ? .35 : option.kind === 'jump' ? .75 : 1.5 + .1 * Math.abs(current); }
export function eligiblePool(candidates: CandidateTrace[], current: number | null, held: boolean, emergency: boolean, band = .8): CandidateTrace[] {
    for (const c of candidates) {
        c.switchMargin = switchMargin(c.option, current);
        c.eligible = c.option.legal && c.score !== null && (!held || emergency) && (current === null || c.score.Uraw > current + c.switchMargin);
    }
    const eligible = candidates.filter(c => c.eligible);
    if (!eligible.length)
        return [];
    const best = Math.max(...eligible.map(c => c.score!.Uraw));
    return eligible.filter(c => best - c.score!.Uraw <= band).sort((a, b) => a.option.key < b.option.key ? -1 : a.option.key > b.option.key ? 1 : 0);
}
export function choose(pool: readonly CandidateTrace[], draw: number, random: boolean, band = .8): CandidateTrace | null {
    if (!pool.length)
        return null;
    const best = Math.max(...pool.map(c => c.score!.Uraw));
    if (!random || band === 0)
        return pool.find(c => c.score!.Uraw === best)!;
    const weights = pool.map(c => (.1 + Math.max(0, 1 - (best - c.score!.Uraw) / band)) ** 2), sum = weights.reduce((a, b) => a + b, 0);
    let target = draw * sum;
    for (let i = 0; i < pool.length; i++) {
        target -= weights[i]!;
        if (target < 0)
            return pool[i]!;
    }
    return pool.at(-1)!;
}
export function continuation(e: ExecutionMemory, options: readonly Option[]): Option | null {
    if (e.optionKey === null)
        return null;
    // A submitted trigger is never proposed again; only its horizontal continuation is rescored.
    return options.find(o => o.kind === 'move' && o.moveX === e.moveX && o.legal) ?? null;
}
