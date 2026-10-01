import type { ContentBundle } from '../contracts/content.js';
import type { RenderFrame, BattleEvent } from '../contracts/fighter.js';
export const ABILITY_LABELS: Readonly<Record<string, string>> = { 'standard-jab': '直拳', 'standard-bolt': '火球', 'standard-push': '推击', 'standard-volley': '三连射', 'rubber-slap': '弹掌', 'rubber-dash': '弹性突进', 'rubber-cushion': '护垫', 'rubber-overdrive': '超弹模式','iron-smash':'重砸','iron-charge':'铁球冲撞','iron-brace':'稳固架势','iron-giant':'巨人','mirror-jab':'镜击','mirror-shard':'镜片','mirror-screen':'反射屏障','mirror-dome':'镜面领域' };
export function drawArena(ctx: CanvasRenderingContext2D, frame: RenderFrame, events: readonly BattleEvent[], content: {source:Pick<ContentBundle['source'],'characters'|'arenas'>&{statuses?:ContentBundle['source']['statuses']}}, overlay = false): void {
    const arena = content.source.arenas[0]!, width = ctx.canvas.width, height = ctx.canvas.height;
    ctx.save();
    ctx.fillStyle = '#0b1421';
    ctx.fillRect(0, 0, width, height);
    ctx.scale(width / arena.width, height / arena.height);
    ctx.strokeStyle = '#172839';
    ctx.lineWidth = 1;
    for (let x = 120; x < arena.width; x += 120) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, arena.height);
        ctx.stroke();
    }
    for (let y = 120; y < arena.height; y += 120) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(arena.width, y);
        ctx.stroke();
    }
    ctx.strokeStyle = '#3c5267';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, arena.width - 6, arena.height - 6);
    ctx.fillStyle = '#152638';
    ctx.fillRect(6, arena.height - 12, arena.width - 12, 6);
    for (const e of frame.entities) {
        const char = content.source.characters.find(c => c.id === e.characterId)!, x = e.position.x, y = arena.height - e.position.y, r = e.radius;
        const recentlyHit = events.some(ev => ev.type === 'DamageResolved' && ev.targetId === e.id && frame.tick - ev.tick <= 8);
        ctx.save();
        if (e.actionPhase === 'dead')
            ctx.globalAlpha = .35;
        if (e.actionPhase === 'hitstun') {
            ctx.strokeStyle = '#ff727c66';
            ctx.lineWidth = r;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - e.velocity.x * .04, y + e.velocity.y * .04);
            ctx.stroke();
        }
        if (e.visibleStatusIds.includes('overdrive')) {
            ctx.shadowColor = '#63f8d4';
            ctx.shadowBlur = 25;
        }
        const reflectExtra=content.source.statuses?.filter(s=>e.visibleStatusIds.includes(s.id)&&s.reflect).reduce((r,s)=>Math.max(r,s.reflect!.extraRadius),0)??0;
        if(reflectExtra){ctx.beginPath();ctx.arc(x,y,r+reflectExtra,0,Math.PI*2);ctx.fillStyle='#a18fff14';ctx.fill();ctx.strokeStyle=events.some(ev=>ev.type==='ProjectileReflected'&&ev.sourceId===e.id&&frame.tick-ev.tick<=8)?'#f5edff':'#b7aaff';ctx.lineWidth=e.visibleStatusIds.includes('dome')?5:3;ctx.stroke();}
        ctx.beginPath();
        if (char.visual.shape !== 'circle') {
            const sides=char.visual.shape==='hexagon'?6:char.visual.shape==='square'?4:3,rotation=char.visual.shape==='square'?Math.PI/4:char.visual.shape==='triangle'?-Math.PI/2:0;
            for (let i = 0; i < sides; i++) {
                const a = rotation+i * Math.PI *2/sides, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath();
        }
        else
            ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = recentlyHit ? '#fff6de' : char.visual.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = e.id === 1 ? char.visual.outlineColor : '#ffffff';
        ctx.lineWidth = e.id === 1 ? 3 : 5;
        ctx.stroke();
        if (e.actionPhase === 'startup' || e.visibleStatusIds.includes('cushion')) {
            ctx.strokeStyle = e.actionPhase === 'startup' ? '#ffcf65' : '#c9ffee';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, r + 8, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = '#08121a';
        ctx.beginPath();
        ctx.moveTo(x + e.facing * (r - 9), y);
        ctx.lineTo(x + e.facing * (r - 18), y - 5);
        ctx.lineTo(x + e.facing * (r - 18), y + 5);
        ctx.closePath();
        ctx.fill();
        ctx.font = 'bold 20px system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(e.id === 1 ? 'A' : 'B', x, y + 7);
        ctx.fillStyle = '#243648';
        ctx.fillRect(x - 35, y - r - 21, 70, 5);
        ctx.fillStyle = char.visual.color;
        ctx.fillRect(x - 35, y - r - 21, 70 * e.hp / e.maxHp, 5);
        ctx.strokeStyle = '#a8f0ce';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * e.energy / 100);
        ctx.stroke();
        if (e.abilityId) {
            ctx.font = '18px system-ui';
            ctx.fillStyle = e.actionPhase === 'startup' ? '#ffcf65' : '#d5e6f4';
            ctx.fillText(ABILITY_LABELS[e.abilityId] ?? e.abilityId, x, Math.max(26, y - r - 30));
        }
        if (overlay) {
            ctx.strokeStyle = '#78e3ff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + e.velocity.x * .08, y - e.velocity.y * .08);
            ctx.stroke();
        }
        ctx.restore();
    }
    for (const p of frame.projectiles) {
        ctx.beginPath();
        ctx.arc(p.position.x, arena.height - p.position.y, p.radius, 0, Math.PI * 2);
        const e = frame.entities.find(e => e.id === p.ownerId)!;
        ctx.fillStyle = content.source.characters.find(c => c.id === e.characterId)!.visual.color;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.shadowBlur = 0;
    }
    for (const h of frame.hitboxes) {
        ctx.beginPath();
        ctx.arc(h.position.x, arena.height - h.position.y, h.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#fff3a02e';
        ctx.fill();
        if (overlay) {
            ctx.strokeStyle = '#ffcd6d';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
    for (const ev of events)
        if (ev.type === 'DamageResolved' && ev.position && frame.tick - ev.tick <= 14 && frame.tick > ev.tick) {
            ctx.font = 'bold 24px system-ui';
            ctx.fillStyle = '#ffdf95';
            ctx.textAlign = 'center';
            ctx.fillText(`−${Number(ev.payload.amount.toFixed(1))}`, ev.position.x, arena.height - ev.position.y - 52 - (frame.tick - ev.tick) * 2);
        }
    ctx.restore();
}
