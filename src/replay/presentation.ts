import { PresentationFrameSchema, type PresentationFrame, type ReplayManifest } from '../contracts/production.js';
import type { BattleEvent } from '../contracts/fighter.js';
import type { ContentBundle } from '../contracts/content.js';
import { hashCanonical } from '../math/hash.js';
import { lerpPosition } from '../math/geometry.js';

export function embeddedContentHash(source:ContentBundle['source'],pluginVersions:Readonly<Record<string,number>>):string {
  const categories=['characters','abilities','statuses','passives','profiles','pacingProfiles','arenas'] as const;
  const stableIds=Object.fromEntries(categories.map(category=>{const definitions=source[category];if(new Set(definitions.map(d=>d.id)).size!==definitions.length||definitions.some((d,i)=>i>0&&d.id<definitions[i-1]!.id))throw new Error('Content must retain frozen canonical ID order');return [category,Object.fromEntries(definitions.map((d,i)=>[d.id,i+1]))];}));
  return hashCanonical({source,stableIds,pluginVersions});
}

export function validatePresentation(manifest:ReplayManifest, content:ContentBundle['source'], input:unknown[], events:readonly BattleEvent[]):PresentationFrame[] {
  if(embeddedContentHash(content,manifest.pluginVersions)!==manifest.contentHash)throw new Error('Presentation content hash mismatch');
  if(input.length!==manifest.durationTicks+1)throw new Error('Presentation must contain S[0] through S[T]');
  const frames=input.map((f,i)=>{const frame=PresentationFrameSchema.parse(f);if(frame.tick!==i)throw new Error('Presentation tick discontinuity');
    if(new Set(frame.entities.map(e=>e.id)).size!==2||frame.entities.some((e,j)=>e.id!==j+1||e.characterId!==manifest.config.participants[j]!.characterId||e.hp>e.maxHp))throw new Error('Presentation entity identity mismatch');
    for(const list of [frame.projectiles,frame.hitboxes,frame.visualEffects])if(new Set(list.map(e=>e.id)).size!==list.length)throw new Error('Duplicate presentation object ID');
    if(frame.projectiles.some(p=>!frame.entities.some(e=>e.id===p.ownerId)||!content.abilities.some(a=>a.id===p.abilityId))||frame.hitboxes.some(h=>!frame.entities.some(e=>e.id===h.ownerId))||frame.visualEffects.some(f=>!frame.entities.some(e=>e.id===f.ownerId)||!content.statuses.some(s=>s.id===f.statusId)||f.endsTick<=frame.tick||f.startedTick>frame.tick))throw new Error('Invalid presentation object ownership/lifetime');
    if(i<manifest.durationTicks&&frame.result!==null)throw new Error('Premature presentation result');
    return frame;});
  if(hashCanonical(frames.at(-1)!.result)!==hashCanonical(manifest.result))throw new Error('Presentation final result mismatch');
  if(events.some((event,i)=>event.tick>=manifest.durationTicks||i>0&&(event.seq<=events[i-1]!.seq||event.tick<events[i-1]!.tick)))throw new Error('Event ordering/tick mismatch');
  return frames;
}
export interface PresentationSample {simTimeTicks:number;frameBefore:PresentationFrame;frameAfter:PresentationFrame;alpha:number;frame:PresentationFrame;activeVisualEvents:readonly BattleEvent[];}
export function samplePresentation(frames:readonly PresentationFrame[],events:readonly BattleEvent[],time:number):PresentationSample {
  if(!Number.isFinite(time)||!frames.length)throw new Error('Invalid presentation sample');
  const t=Math.max(0,Math.min(frames.length-1,time)),before=frames[Math.floor(t)]!,after=frames[Math.min(frames.length-1,Math.floor(t)+1)]!,alpha=t-before.tick;
  const discontinuous=new Set(after.discontinuityEntityIds);
  const entities=before.entities.map(entity=>{const next=after.entities.find(e=>e.id===entity.id);return !next||discontinuous.has(entity.id)||next.actionPhase==='dead'&&entity.actionPhase!=='dead'?entity:{...entity,position:lerpPosition(entity.position,next.position,alpha),velocity:lerpPosition(entity.velocity,next.velocity,alpha)};});
  const projectiles=before.projectiles.map(projectile=>{const next=after.projectiles.find(p=>p.id===projectile.id&&p.ownerId===projectile.ownerId);return next?{...projectile,position:lerpPosition(projectile.position,next.position,alpha),velocity:lerpPosition(projectile.velocity,next.velocity,alpha)}:projectile;});
  return {simTimeTicks:t,frameBefore:before,frameAfter:after,alpha,frame:{...before,tick:t,entities,projectiles},activeVisualEvents:events.filter(e=>e.tick+1<=t&&t-(e.tick+1)<=30)};
}
