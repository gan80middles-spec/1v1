import source from '../../content/fighter-phase1.json';
import utilitySource from '../../content/fighter-phase2.json';
import { compileFighterContent } from '../content/fighter.js';
import { FighterRunner, fighterConfig } from '../runner/fighter.js';
import { replayInputs } from '../runner/input-replay.js';
import { renderFrame } from '../replay/frame.js';
import { drawArena, ABILITY_LABELS } from '../render/canvas.js';
import { canonicalSerialize } from '../math/canonical.js';
import { SLOTS } from '../contracts/versions.js';
import type { ControllerKind, InputReplay, RenderFrame } from '../contracts/fighter.js';
import type { RunnerControllerKind } from '../contracts/ai.js';
import { UtilityRunner } from '../runner/utility.js';
import { compileUtilityContent } from '../content/utility.js';
import { displayTrace, drawBelief, type TraceEntry } from './ai-debug.js';
import './style.css';
const el = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const canvas = el<HTMLCanvasElement>('#arena'), ctx = canvas.getContext('2d')!;
if (!ctx)
    throw new Error('Canvas unavailable');
let runner!: FighterRunner | UtilityRunner;
let traces: TraceEntry[] = [], decisionCursor = -1;
let content = compileFighterContent(source), playing = false, replaying = false, replay: InputReplay | null = null, frames: RenderFrame[] = [], cursor = 0, accumulator = 0, lastTime = 0;
const message = el('#message'), output = el('#output'), play = el<HTMLButtonElement>('#play'), seek = el<HTMLInputElement>('#seek');
const phaseLabels = { free: '自由行动', startup: '准备出招', active: '攻击中', recovery: '收招', hitstun: '受击硬直', dead: '已倒下' };
const escapeHtml = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function show(): void {
    const frame = replaying ? frames[cursor]! : renderFrame(runner.sim.snapshot()), events = replaying ? replay!.events : runner.events;
    drawArena(ctx, frame, events.filter(e => e.tick < frame.tick && e.tick >= frame.tick - 20), content, el<HTMLInputElement>('#overlay').checked);
    if (runner instanceof UtilityRunner && !replaying)
        traces = runner.traces;
    const ownTraces = traces.filter(t => t.entityId === Number(el<HTMLSelectElement>('#debug-entity').value)), entry = decisionCursor < 0 ? ownTraces.findLast(t => t.trace.nowTick <= frame.tick) ?? null : ownTraces[Math.min(decisionCursor, ownTraces.length - 1)] ?? null;
    el<HTMLInputElement>('#decision').max = String(Math.max(0, ownTraces.length - 1));
    el<HTMLInputElement>('#decision').value = String(decisionCursor < 0 ? Math.max(0, ownTraces.indexOf(entry!)) : decisionCursor);
    displayTrace(entry, events, el('#ai-summary'), el('#ai-candidates'), el('#ai-threats'), el('#ai-outcome'));
    if (el<HTMLInputElement>('#belief-overlay').checked)
        drawBelief(ctx, frame, entry);
    el('#clock').textContent = `${(frame.tick / 60).toFixed(2)} / ${((replay?.config.maxTicks ?? runner.config.maxTicks) / 60).toFixed(2)} 秒`;
    el('#mode').textContent = replaying ? '回放 · 输入校验通过' : playing ? '正在交锋' : frame.result ? '比赛结束' : '已暂停';
    play.textContent = playing ? '暂停' : frame.tick === 0 ? '开始' : '继续';
    el('#scoreboard').innerHTML = frame.entities.map(e => { const c = content.source.characters.find(c => c.id === e.characterId)!, skills = SLOTS.map(s => { const cd = Math.max(0, e.cooldownReadyTick[s] - frame.tick); return `<span>${ABILITY_LABELS[c.slots[s]] ?? c.slots[s]} <b>${cd > 0 ? `${(cd / 60).toFixed(1)}s` : s === 'ultimate' && e.energy < 100 ? '充能' : '就绪'}</b></span>`; }).join(''); return `<div class="fighter-card"><div class="fighter-title" style="color:${c.visual.color}">${e.id === 1 ? 'A' : 'B'} · ${escapeHtml(c.name)}<small>${e.id === 1 ? '左侧出生' : '右侧出生'}</small></div><div class="meter"><span style="width:${e.hp / e.maxHp * 100}%;background:${c.visual.color}"></span></div><div class="meter energy"><span style="width:${e.energy}%;background:#8bdcbe"></span></div><div class="metrics"><span>HP ${e.hp.toFixed(1)}/${e.maxHp}</span><span>能量 ${e.energy.toFixed(1)}</span></div><div class="skills">${skills}</div><div class="state-label">${phaseLabels[e.actionPhase]}${e.wallStacks ? ` · 墙弹 ${e.wallStacks} 层` : ''}${e.visibleStatusIds.includes('cushion') ? ' · 护垫减伤' : ''}${e.visibleStatusIds.includes('overdrive') ? ' · 超弹模式' : ''}</div></div>`; }).join('');
    const result = frame.result;
    el('#result').textContent = result ? result.reason === 'invalid' ? '比赛异常 · 查看诊断记录' : result.winnerParticipantId ? `${result.winnerParticipantId} 方获胜 · ${result.reason === 'ko' ? '击倒' : '时间结束'}` : `平局 · ${result.reason === 'double-ko' ? '同时击倒' : '时间结束'}` : frame.tick === 0 ? '等待开赛' : '比赛进行中';
    const visible = events.filter(e => e.tick < frame.tick && ['CastAccepted', 'DamageResolved', 'PassiveTriggered', 'EntityDied'].includes(e.type)).slice(-7).reverse();
    el('#event-log').replaceChildren(...visible.map(e => { const li = document.createElement('li'), who = e.sourceId === 1 ? 'A' : 'B'; li.textContent = `${(e.tick / 60).toFixed(1)}s · ${who} ${e.type === 'CastAccepted' ? `使出${ABILITY_LABELS[e.payload.abilityId] ?? e.payload.abilityId}` : e.type === 'DamageResolved' ? `命中，伤害 ${e.payload.amount.toFixed(1)}` : e.type === 'PassiveTriggered' ? `墙弹成长 ${e.payload.stacks} 层` : '倒下'}`; return li; }));
    seek.value = String(frame.tick);
    el<HTMLButtonElement>('#replay').disabled = !replay;
    el<HTMLButtonElement>('#export').disabled = !replay;
    output.textContent = JSON.stringify({ seed: replay?.config.seed ?? runner.config.seed, tick: frame.tick, mode: replaying ? 'replay' : 'live', contentHash: content.bundleHash, finalWorldHash: replay?.finalWorldHash ?? null, result: frame.result }, null, 2);
    output.dataset['tick'] = String(frame.tick);
    output.dataset['finalHash'] = replay?.finalWorldHash ?? '';
    document.documentElement.dataset['ready'] = 'true';
}
function completed(): void { playing = false; replay = runner.replay(); frames = runner.frames; seek.max = String(frames.length - 1); seek.disabled = false; show(); }
function tick(): void {
    if (replaying) {
        if (cursor < frames.length - 1)
            cursor++;
        else
            playing = false;
    }
    else if (!runner.sim.snapshot().result) {
        runner.step();
        if (runner.sim.snapshot().result)
            completed();
    }
    else
        playing = false;
}
function reset(): void {
    const text = el<HTMLInputElement>('#seed').value, seed = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(seed) || seed > 0xffffffff)
        throw new Error('Seed 必须是 0～4294967295 的整数');
    const kinds = [el<HTMLSelectElement>('#controller-a').value, el<HTMLSelectElement>('#controller-b').value] as [
        RunnerControllerKind,
        RunnerControllerKind
    ], utility = kinds.includes('utility');
    content = utility ? compileUtilityContent(utilitySource) : compileFighterContent(source);
    const config = fighterConfig(content, seed, el<HTMLSelectElement>('#a').value, el<HTMLSelectElement>('#b').value);
    if (utility) {
        config.participants[0].profileId = el<HTMLSelectElement>('#profile-a').value;
        config.participants[1].profileId = el<HTMLSelectElement>('#profile-b').value;
    }
    runner = utility ? new UtilityRunner(content, config, { kinds, trace: true, settings: { noise: el<HTMLInputElement>('#noise').checked, randomChoice: el<HTMLInputElement>('#random-choice').checked, memory: el<HTMLInputElement>('#memory').checked } }) : new FighterRunner(content, config, kinds as [
        ControllerKind,
        ControllerKind
    ]);
    traces = [];
    decisionCursor = -1;
    playing = false;
    replaying = false;
    replay = null;
    frames = [];
    cursor = 0;
    accumulator = 0;
    seek.disabled = true;
    seek.max = '0';
    message.textContent = '';
    show();
}
const guard = (fn: () => void): void => {
    try {
        fn();
        message.textContent = '';
    }
    catch (e) {
        playing = false;
        message.textContent = e instanceof Error ? e.message : String(e);
    }
};
el<HTMLFormElement>('#run-form').addEventListener('submit', e => { e.preventDefault(); guard(reset); });
play.addEventListener('click', () => guard(() => {
    if (!replaying && runner.sim.snapshot().result) {
        replaying = true;
        cursor = 0;
    }
    if (replaying && cursor === frames.length - 1)
        cursor = 0;
    playing = !playing;
    accumulator = 0;
    show();
}));
el('#step').addEventListener('click', () => guard(() => { playing = false; tick(); show(); }));
el('#finish').addEventListener('click', () => guard(() => {
    playing = false;
    if (replaying) {
        cursor = frames.length - 1;
        show();
    }
    else {
        runner.run();
        completed();
    }
}));
el('#overlay').addEventListener('change', show);
el('#replay').addEventListener('click', () => guard(() => { replaying = true; cursor = 0; playing = true; accumulator = 0; show(); }));
seek.addEventListener('input', () => guard(() => { playing = false; replaying = true; cursor = Number(seek.value); show(); }));
el('#export').addEventListener('click', () => guard(() => {
    if (!replay)
        return;
    const blob = new Blob([canonicalSerialize(replay) + '\n'], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = `${replay.config.matchId}.json`;
    a.click();
    URL.revokeObjectURL(url);
}));
el<HTMLInputElement>('#import').addEventListener('change', async (e) => {
    try {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file)
            return;
        if (file.size > 10000000)
            throw new Error('回放文件超过 10 MB');
        const loaded = replayInputs(JSON.parse(await file.text()) as unknown);
        playing = false;
        replaying = true;
        replay = loaded.replay;
        frames = loaded.frames;
        content = compileFighterContent(replay.content);
        traces = [];
        decisionCursor = -1;
        cursor = 0;
        seek.max = String(frames.length - 1);
        seek.disabled = false;
        message.textContent = '回放校验通过';
        show();
    }
    catch (e) {
        message.textContent = e instanceof Error ? e.message : String(e);
    }
});
function animate(now: number): void {
    const delta = Math.min(.15, (now - lastTime) / 1000);
    lastTime = now;
    if (playing) {
        accumulator += delta * 60 * Number(el<HTMLSelectElement>('#speed').value);
        let count = 0;
        while (accumulator >= 1 && playing && count++ < 36) {
            tick();
            accumulator--;
        }
        show();
    }
    requestAnimationFrame(animate);
}
const query = new URLSearchParams(location.search);
for (const id of ['a', 'b', 'seed', 'controller-a', 'controller-b', 'profile-a', 'profile-b']) {
    const value = query.get(id);
    if (value !== null)
        el<HTMLInputElement | HTMLSelectElement>(`#${id}`).value = value;
}
el('#debug-entity').addEventListener('change', () => { decisionCursor = -1; show(); });
el('#belief-overlay').addEventListener('change', show);
function reviewDecision(index: number): void { const own = traces.filter(t => t.entityId === Number(el<HTMLSelectElement>('#debug-entity').value)); decisionCursor = Math.max(0, Math.min(own.length - 1, index)); if (replay && own[decisionCursor]) {
    playing = false;
    replaying = true;
    cursor = Math.min(frames.length - 1, own[decisionCursor]!.trace.nowTick);
} show(); }
el('#decision').addEventListener('input', () => reviewDecision(Number(el<HTMLInputElement>('#decision').value)));
el('#decision-prev').addEventListener('click', () => reviewDecision(Number(el<HTMLInputElement>('#decision').value) - 1));
el('#decision-next').addEventListener('click', () => reviewDecision(Number(el<HTMLInputElement>('#decision').value) + 1));
el('#export-trace').addEventListener('click', () => guard(() => { const blob = new Blob([canonicalSerialize({ engineBuild: replay?.engineBuild ?? 'phase2-v1', config: replay?.config ?? runner.config, contentHash: content.bundleHash, traces }) + '\n'], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${runner.config.matchId}.trace.json`; a.click(); URL.revokeObjectURL(url); }));
el<HTMLInputElement>('#import-trace').addEventListener('change', async (e) => { try {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file)
        return;
    if (file.size > 30000000)
        throw new Error('trace 文件超过 30 MB');
    const data = JSON.parse(await file.text()) as {
        contentHash: string;
        config: {
            matchId: string;
        };
        traces: TraceEntry[];
    };
    if (data.contentHash !== content.bundleHash || data.config.matchId !== (replay?.config.matchId ?? runner.config.matchId) || !Array.isArray(data.traces))
        throw new Error('trace 与当前比赛不匹配');
    traces = data.traces;
    decisionCursor = -1;
    show();
    message.textContent = 'trace 已载入';
}
catch (e) {
    message.textContent = e instanceof Error ? e.message : String(e);
} });
reset();
if (query.get('watch') === '1') {
    runner.run();
    completed();
    replaying = true;
    cursor = 0;
    playing = true;
    show();
}
requestAnimationFrame(animate);
