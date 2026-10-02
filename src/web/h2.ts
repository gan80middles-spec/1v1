/// <reference types="vite/client" />
import type { RenderFrame, BattleEvent } from '../contracts/fighter.js';
import type { ContentBundle } from '../contracts/content.js';
import { drawArena } from '../render/canvas.js';
import './style.css';
interface Clip {
    label: string;
    frames: RenderFrame[];
    events: BattleEvent[];
    characters: ContentBundle['source']['characters'];
    arenas: ContentBundle['source']['arenas'];
    statuses?: ContentBundle['source']['statuses'];
}
const el = <T extends HTMLElement>(id: string): T => document.querySelector<T>(id)!;
const canvas = el<HTMLCanvasElement>('#arena'), ctx = canvas.getContext('2d')!, select = el<HTMLSelectElement>('#clip'), seek = el<HTMLInputElement>('#seek'), form = el<HTMLFormElement>('#rating');
let clip: Clip | null = null, entries: {
    label: string;
    url: string;
}[] = [], cursor = 0, playing = false, last = 0, accumulator = 0, base = '';
let paired=false;
let reviewKey='h2-style-review-v1',ratings:Record<string,Record<string,string>>={};
const indexUrl = new URLSearchParams(location.search).get('index') ?? (import.meta.env.DEV ? '/artifacts/phase-2/h2/index.json' : '/review-data/index.json');
function show(): void { if (!clip)
    return; drawArena(ctx, clip.frames[cursor]!, clip.events.filter(e => e.tick < cursor && e.tick >= cursor - 20), { source: { characters: clip.characters, arenas: clip.arenas, ...(clip.statuses?{statuses:clip.statuses}:{}) } }); seek.value = String(cursor); el('#clock').textContent = `${(cursor / 60).toFixed(1)} / ${((clip.frames.length - 1) / 60).toFixed(1)} 秒`; el('#label').textContent = clip.label; el('#play').textContent = playing ? '暂停' : '开始'; document.documentElement.dataset['ready'] = 'true'; }
async function load(): Promise<void> { try {
    playing = false;
    const item = entries[Number(select.value)]!;
    const response = await fetch(new URL(item.url, base));
    if (!response.ok)
        throw new Error('观看文件缺失，请先生成对应阶段的观看包');
    clip = await response.json() as Clip;
    cursor = 0;
    accumulator = 0;
    seek.max = String(clip.frames.length - 1);
    for (const field of ['readability', 'pursuit', 'idle', 'style', 'notes'])
        (form.elements.namedItem(field) as HTMLInputElement).value = ratings[item.label]?.[field] ?? '';
    if(paired)(form.elements.namedItem('preference') as HTMLInputElement).value=ratings[item.label.slice(0,-2)]?.['preference']??'';
    show();
    el('#message').textContent = '';
}
catch (e) {
    el('#message').textContent = e instanceof Error ? e.message : String(e);
} }
form.addEventListener('input', () => { if (!clip)
    return; ratings[clip.label] = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)])); if(paired)ratings[clip.label.slice(0,-2)]={preference:String(new FormData(form).get('preference')??'')}; localStorage.setItem(reviewKey, JSON.stringify(ratings)); });
select.addEventListener('change', () => { void load(); });
el('#next').addEventListener('click', () => { select.value = String((Number(select.value) + 1) % entries.length); void load(); });
el('#play').addEventListener('click', () => { if (clip && cursor === clip.frames.length - 1)
    cursor = 0; playing = !playing; show(); });
seek.addEventListener('input', () => { playing = false; cursor = Number(seek.value); show(); });
el('#save').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, status: 'pending-human-decision', review: reviewKey, ratings }, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = `${reviewKey}-observations.json`; a.click(); URL.revokeObjectURL(url); });
function animate(now: number): void { const dt = Math.min(.15, (now - last) / 1000); last = now; if (playing && clip) {
    accumulator += dt * 60 * Number(el<HTMLSelectElement>('#speed').value);
    while (accumulator >= 1) {
        cursor++;
        accumulator--;
        if (cursor >= clip.frames.length - 1) {
            cursor = clip.frames.length - 1;
            playing = false;
            break;
        }
    }
    show();
} requestAnimationFrame(animate); }
requestAnimationFrame(animate);
try {
    const response = await fetch(indexUrl);
    if (!response.ok)
        throw new Error('请先生成对应阶段的观感观看包');
    const data = await response.json() as {
        paired?:boolean;
        reviewKind?:string;
        title?:string;
        reviewId?:string;
        entries: {
            label: string;
            url: string;
        }[];
    };
    entries = data.entries;paired=data.paired??false;el('#pair-preference').hidden=!paired;
    reviewKey=data.reviewId??'h2-style-review-v1';
    ratings=JSON.parse(localStorage.getItem(reviewKey)??'{}') as typeof ratings;
    el('h1').textContent=data.title??'两角色观感盲评';
    el('header p').textContent=data.reviewKind==='score-preference'?`观看 ${entries.length/2} 对隐藏分数组别的比赛。每对 X/Y 为两场不同比赛，请比较观看偏好、双方参与和可读性。`:paired?`观看 ${entries.length/2} 对隐藏模式的比赛。每对 X/Y 使用相同 seed 和角色，请比较节奏、双方参与和可读性。`:`观看 ${entries.length} 场隐藏人格的比赛。重点观察 A 方；双方能力相同，感知水平固定。`;
    base = new URL(indexUrl, location.href).href;
    for (let i = 0; i < entries.length; i++) {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = entries[i]!.label;
        select.append(option);
    }
    await load();
}
catch (e) {
    el('#message').textContent = e instanceof Error ? e.message : String(e);
}
