/** A bounded causal approximation over already predicted contacts. No hidden world or future action search. */
export interface PredictedImpact {
    tick: number;
    amount: number;
    stunTicks: number;
    /** Last tick through which the cast must remain uninterrupted. null = already independent projectile. */
    releaseTick: number | null;
    releaseOwner?: 'self' | 'opponent';
    possible?: boolean;
    newCast?: boolean;
}
export function resolveExchange(attacks: readonly PredictedImpact[], hits: readonly PredictedImpact[], ownHp: number, enemyHp: number, includePossible: boolean) {
    let ownRemaining = ownHp, enemyRemaining = enemyHp;
    let ownCancelled = Infinity, enemyCancelled = Infinity, earlyLoss = 0, castDamage = 0;
    const impactTick = (tick: number) => Math.max(0, Math.floor(tick + 1e-7));
    const included = (h: PredictedImpact) => includePossible || !h.possible;
    const ticks = [...new Set([...attacks, ...hits].filter(included).map(h => impactTick(h.tick)))].sort((a, b) => a - b);
    for (const tick of ticks) {
        const active = (h: PredictedImpact, cancelled: number) => included(h) && impactTick(h.tick) === tick &&
            (h.releaseTick === null || Math.floor(h.releaseTick + 1e-7) <=
                (h.releaseOwner === 'self' ? ownCancelled : h.releaseOwner === 'opponent' ? enemyCancelled : cancelled));
        // Both sides use the pre-batch state: same-tick trades remain possible.
        const outgoing = attacks.filter(h => active(h, ownCancelled)), incoming = hits.filter(h => active(h, enemyCancelled));
        const damage = Math.min(enemyRemaining, outgoing.reduce((sum, h) => sum + h.amount, 0));
        const loss = Math.min(ownRemaining, incoming.reduce((sum, h) => sum + h.amount, 0));
        castDamage += Math.min(damage, outgoing.filter(h => h.newCast).reduce((sum, h) => sum + h.amount, 0));
        enemyRemaining -= damage;
        ownRemaining -= loss;
        if (tick <= 12) earlyLoss += loss;
        if (incoming.some(h => h.stunTicks > 0)) ownCancelled = Math.min(ownCancelled, tick);
        if (outgoing.some(h => h.stunTicks > 0)) enemyCancelled = Math.min(enemyCancelled, tick);
        // The real match terminates after this damage batch, even with projectiles in flight.
        if (ownRemaining <= 0 || enemyRemaining <= 0) break;
    }
    return { damage: enemyHp - enemyRemaining, castDamage, loss: ownHp - ownRemaining, earlyLoss,
        kill: enemyRemaining <= 0 ? 1 : 0, death: ownRemaining <= 0 ? 1 : 0 };
}
