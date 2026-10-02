import type { AITrace } from '../contracts/ai.js';
import type { BattleEvent, RenderFrame } from '../contracts/fighter.js';
export interface TraceEntry {
    entityId: number;
    trace: AITrace;
}
const number = (n: number | null | undefined): string => n === null || n === undefined ? '—' : n.toFixed(2);
export function displayTrace(entry: TraceEntry | null, events: readonly BattleEvent[], summary: HTMLElement, table: HTMLElement, threats: HTMLElement, outcome: HTMLElement): void {
    table.replaceChildren();
    threats.replaceChildren();
    if (!entry) {
        summary.textContent = '选择 Utility 打法运行比赛，可逐次查看决策。导入输入回放后可另行导入同场 trace。';
        outcome.textContent = '';
        return;
    }
    const t = entry.trace;
    summary.textContent = `${entry.entityId === 1 ? 'A' : 'B'} · 决策 ${t.decisionIndex} · tick ${t.nowTick} / 感知 ${t.sensedTick ?? '未送达'} · ${t.profileId} · 继续 ${t.continuationKey ?? '无'} (${number(t.continuationScore)}) → ${t.selectedKey ?? '中立'}${t.commitmentHeld ? ' · 保持承诺' : ''}${t.emergency ? ' · 紧急避险' : ''}${t.stuck ? ' · 脱困' : ''} · 随机池 ${t.poolKeys.length} 项`;
    for (const c of t.candidates) {
        const tr = document.createElement('tr');
        if (c.option.key === t.selectedKey)
            tr.className = 'chosen';
        const cells = [c.option.key, c.option.legal ? '合法' : c.option.reason ?? '过滤', ...(['D', 'L', 'P', 'K', 'X', 'C', 'E', 'R', 'B', 'stuckBonus', 'wallCost', 'Uraw'] as const).map(k => number(c.score?.[k])), number(c.score?.Ubase??c.score?.Uraw),number(c.score?.director?.raw??0),number(c.score?.director?.applied??0),c.score?.director?`${c.score.director.baseAllowed?'基础分通过':'基础分过滤'} / ${c.score.director.riskAllowed?'风险通过':'风险过滤'} · ${c.score.director.reason} · 上限 ${number(c.score.director.stackCap)}`:'—',number(c.outcome?.confidence), number(c.switchMargin), c.eligible ? '入池' : c.selectionBlockReason ? '无预测命中' : '—'];
        for (const value of cells) {
            const td = document.createElement('td');
            td.textContent = value;
            tr.append(td);
        }
        table.append(tr);
    }
    for (const v of t.threats) {
        const li = document.createElement('li');
        li.textContent = `${v.kind === 'committed' ? '已看到' : '可能普通攻击'} · ${v.abilityId} · +${number(v.startInTicks)}～${number(v.endInTicks)} tick · 伤害 ${number(v.estimatedDamage)} · 概率 ${number(v.likelihood)}`;
        threats.append(li);
    }
    const request = t.requestId, accepted = request === null ? undefined : events.find(e => e.type === 'CastAccepted' && e.sourceId === entry.entityId && e.payload.requestId === request);
    if (accepted?.type === 'CastAccepted') {
        const castId = accepted.payload.castId, related = events.filter(e => e.rootEventId === accepted.seq && e.tick >= accepted.tick), damage = related.filter(e => e.type === 'DamageResolved').filter(e=>e.sourceId===entry.entityId), defense = events.filter(e => e.sourceId === entry.entityId && (e.type==='DamagePrevented'&&e.payload.castId===castId||e.type==='ProjectileReflected'&&e.payload.defenseCastId===castId)), interrupt = related.find(e => e.type === 'CastInterrupted');
        outcome.textContent = `request ${request} → cast ${castId} 已接受（tick ${accepted.tick}） → ${damage.length ? `命中 ${damage.length} 次，伤害 ${damage.reduce((s, e) => s + e.payload.amount, 0).toFixed(1)}` : defense.length ? `防御 ${defense.length} 次` : '未记录伤害/防御'}${interrupt ? ` · 被打断（tick ${interrupt.tick}）` : ''}。无伤害可能来自失误、位移或增益，请结合候选预测与事件核对。`;
    }
    else
        outcome.textContent = request === null ? '本次仅保持移动，无触发请求。' : `request ${request} · ${t.input.jumpPressed ? 'Jump' : 'Cast'} · ${events.find(e => e.type === 'ActionRejected' && e.sourceId === entry.entityId && e.payload.requestId === request) ? '请求被拒绝' : '等待或查看后续事件'}`;
}
export function drawBelief(ctx: CanvasRenderingContext2D, frame: RenderFrame, entry: TraceEntry | null): void {
    const enemy = entry?.trace.belief.opponent;
    if (!enemy)
        return;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = '#d9d079';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(enemy.position.x, 960 - enemy.position.y, enemy.radius + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d9d079';
    ctx.font = '16px sans-serif';
    ctx.fillText('估计位置', enemy.position.x - 32, 960 - enemy.position.y - enemy.radius - 12);
    const real = frame.entities.find(e => e.id === enemy.id);
    if (real) {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = '#b2cfdf';
        ctx.beginPath();
        ctx.moveTo(real.position.x, 960 - real.position.y);
        ctx.lineTo(enemy.position.x, 960 - enemy.position.y);
        ctx.stroke();
    }
    ctx.restore();
}
