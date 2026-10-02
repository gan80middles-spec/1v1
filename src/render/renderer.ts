import type { ReplayPackage, RenderJob } from '../contracts/production.js';
import { samplePresentation } from '../replay/presentation.js';
import { videoFrameSource } from './timeline.js';
import { drawArena, ABILITY_LABELS } from './canvas.js';
export type VideoPayload=Pick<ReplayPackage,'manifest'|'content'|'frames'> & {events:ReplayPackage['replay']['events'];job:RenderJob};
const visualRandom=(seed:number,seq:number,index:number)=>{let v=(seed^Math.imul(seq,0x9e3779b1)^Math.imul(index+1,0x85ebca6b))>>>0;v^=v>>>16;v=Math.imul(v,0x7feb352d);v^=v>>>15;return (v>>>0)/0x100000000;};
export class VideoRenderer {
  private arena=new OffscreenCanvas(936,936);
  constructor(private ctx:CanvasRenderingContext2D,readonly payload:VideoPayload){}
  renderFrame(n:number):void {const source=videoFrameSource(this.payload.job,n);this.draw(source.sourceTick,source.kind);}
  draw(sourceTick:number,kind:'intro'|'battle'|'hold'|'outro'='battle'):void {
    const {ctx,payload:p}=this,{frame,activeVisualEvents:events}=samplePresentation(p.frames,p.events,sourceTick),light=p.job.templateId==='arena-light',bg=light?'#eef3f8':'#08111f',fg=light?'#10243d':'#f0f5ff',muted=light?'#526980':'#95abc4',panel=light?'#ffffff':'#15243b';
    ctx.save();ctx.scale(ctx.canvas.width/1080,ctx.canvas.height/1920);ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1920);
    const text=(value:string,x:number,y:number,size:number,color=fg,align:CanvasTextAlign='left')=>{ctx.fillStyle=color;ctx.font=`${size}px ExportSans`;ctx.textAlign=align;ctx.fillText(value,x,y);};
    const names=p.manifest.config.participants.map(e=>p.content.characters.find(c=>c.id===e.characterId)!.name);
    text('竞技场 / ONE v ONE',72,112,27,muted);text(`${names[0]}  ×  ${names[1]}`,72,186,46);text(kind==='intro'?'回合即将开始':kind==='outro'?'对局结果':kind==='hold'?'KO · 决胜瞬间':`第 ${(sourceTick/60).toFixed(1)} 秒`,1008,250,28,muted,'right');
    for(let i=0;i<2;i++){const e=frame.entities[i]!,character=p.content.characters.find(c=>c.id===e.characterId)!,x=72+i*496;
      text(`${i?'B':'A'}  ${character.name}`,x,295,26);text(`${Math.ceil(e.hp)} / ${e.maxHp}`,x+438,295,23,muted,'right');ctx.fillStyle=panel;ctx.fillRect(x,318,438,22);ctx.fillStyle=character.visual.color;ctx.fillRect(x,318,438*e.hp/e.maxHp,22);
    }
    const arenaCtx=this.arena.getContext('2d')!;drawArena(arenaCtx as unknown as CanvasRenderingContext2D,frame,events,{source:{...p.content,arenas:p.content.arenas.filter(a=>a.id===p.manifest.config.arenaId)}},false,'ExportSans');
    ctx.drawImage(this.arena,72,404);ctx.save();ctx.beginPath();ctx.rect(72,404,936,936);ctx.clip();
    const arena=p.content.arenas.find(a=>a.id===p.manifest.config.arenaId)!,factor=936/arena.width;
    for(const projectile of frame.projectiles){ctx.strokeStyle='#b5e5ff99';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(72+projectile.position.x*factor,404+936-projectile.position.y*factor);ctx.lineTo(72+(projectile.position.x-projectile.velocity.x*.025)*factor,404+936-(projectile.position.y-projectile.velocity.y*.025)*factor);ctx.stroke();}
    for(const event of events){const age=sourceTick-event.tick-1;if(age<0||age>30||!event.position)continue;
      const effect=event.type==='DamageResolved'&&event.payload.amount>=1||event.type==='WallBounce'&&event.payload.incomingNormalSpeed>=250||event.type==='ProjectileReflected'||event.type==='EntityDied'||event.type==='CastAccepted'&&event.payload.slot==='ultimate';if(!effect)continue;
      const x=72+event.position.x*factor,y=404+936-event.position.y*factor;ctx.globalAlpha=Math.max(0,1-age/30);ctx.strokeStyle=event.type==='ProjectileReflected'?'#cbbaff':event.type==='WallBounce'?'#ffaa67':'#fff0a8';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,12+age*3,0,Math.PI*2);ctx.stroke();
      for(let i=0;i<8;i++){const angle=visualRandom(p.job.visualSeed,event.seq,i)*Math.PI*2,distance=10+age*(1+visualRandom(p.job.visualSeed,event.seq,i+20)*2);ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(x+Math.cos(angle)*distance,y+Math.sin(angle)*distance,5,5);}
    }ctx.restore();
    for(let i=0;i<2;i++){const e=frame.entities[i]!,x=72+i*496;ctx.fillStyle=panel;ctx.fillRect(x,1386,438,160);text(`${i?'B':'A'} · 能量 ${Math.floor(e.energy)}`,x+24,1430,25);ctx.fillStyle='#28405a';ctx.fillRect(x+24,1452,390,10);ctx.fillStyle='#89dac5';ctx.fillRect(x+24,1452,390*e.energy/100,10);text(e.abilityId?(ABILITY_LABELS[e.abilityId]??e.abilityId):e.actionPhase==='dead'?'已倒下':'寻找机会',x+24,1511,27);}
    const latest=[...events].reverse().find(e=>e.type==='ProjectileReflected'||e.type==='WallBounce'&&e.payload.incomingNormalSpeed>=250||e.type==='DamageResolved'&&e.payload.amount>=1||e.type==='CastAccepted'&&e.payload.slot==='ultimate');
    const label=latest?.type==='ProjectileReflected'?'反射命中窗口':latest?.type==='WallBounce'?'撞墙反弹':latest?.type==='CastAccepted'?'终极技能释放':latest?.type==='DamageResolved'?`有效命中 −${latest.payload.amount.toFixed(1)}`:'双方蓄势';
    if(kind==='outro'||kind==='hold'){const result=p.manifest.result,index=p.manifest.config.participants.findIndex(c=>c.participantId===result.winnerParticipantId),winner=index<0?null:frame.entities[index],winnerName=winner?p.content.characters.find(c=>c.id===winner.characterId)!.name:null;text(winnerName?`${winnerName} · ${winner?.id===1?'A':'B'} 获胜`:'对局结束',540,1696,48,fg,'center');text(`实际战斗 ${(p.manifest.durationTicks/60).toFixed(2)} 秒 · ${result.reason.toUpperCase()}`,540,1768,28,muted,'center');}
    else{text(kind==='intro'?'能力与碰撞，决定这一回合':label,540,1696,36,fg,'center');text('完整回放 · 真实事件驱动',540,1768,26,muted,'center');}
    text(`Seed ${p.manifest.seed} · ${p.manifest.engineBuild}`,72,1844,21,muted);text('60 FPS',1008,1844,21,muted,'right');ctx.restore();
  }
}
