import type { BattleEvent } from '../contracts/fighter.js';
import type { RenderJob } from '../contracts/production.js';
import { sourceBoundaryVideoFrame } from './timeline.js';
export const AUDIO_SAMPLE_RATE=48000;
export const AUDIO_ASSETS_VERSION='synth-sfx-v1';
export const SOUND_SPECS={hit:{duration:.10,frequency:170,gain:.12},wall:{duration:.08,frequency:110,gain:.045},reflect:{duration:.18,frequency:780,gain:.10},ultimate:{duration:.35,frequency:390,gain:.13},ko:{duration:.45,frequency:90,gain:.16}} as const;
export type SoundKind=keyof typeof SOUND_SPECS;
export interface AudioCue {eventSeq:number;kind:SoundKind;videoFrame:number;sampleOffset:number;pan:number;}
export function audioPlan(job:RenderJob,events:readonly BattleEvent[],arenaWidth:number):AudioCue[] {
  const seen=new Set<number>(),cues:AudioCue[]=[];
  for(const event of events){let kind:SoundKind|null=null;
    if(event.type==='DamageResolved'&&event.payload.amount>0)kind='hit';
    else if(event.type==='WallBounce'&&event.payload.incomingNormalSpeed>=250&&event.payload.wall!=='floor')kind='wall';
    else if(event.type==='ProjectileReflected'||event.type==='ProjectileDissipated')kind='reflect';
    else if(event.type==='CastAccepted'&&event.payload.slot==='ultimate')kind='ultimate';
    else if(event.type==='EntityDied')kind='ko';
    if(!kind)continue;if(seen.has(event.seq))throw new Error('Duplicate audio event');seen.add(event.seq);
    const videoFrame=sourceBoundaryVideoFrame(job,event.tick+1);cues.push({eventSeq:event.seq,kind,videoFrame,sampleOffset:videoFrame*800,pan:Math.max(-.65,Math.min(.65,(event.position?.x??arenaWidth/2)/arenaWidth*1.3-.65))});
  }
  return cues;
}
export function soundSamples(kind:SoundKind):Float32Array {
  const spec=SOUND_SPECS[kind],samples=new Float32Array(Math.round(spec.duration*AUDIO_SAMPLE_RATE));
  for(let i=0;i<samples.length;i++){const t=i/AUDIO_SAMPLE_RATE,envelope=Math.min(1,i/120)*Math.exp(-t/spec.duration*7),sweep=kind==='ko'?1-t/spec.duration*.65:kind==='reflect'?1+t/spec.duration:.95;
    samples[i]=(Math.sin(2*Math.PI*spec.frequency*t*sweep)+.25*Math.sin(2*Math.PI*spec.frequency*2.7*t))*envelope*.7;}
  return samples;
}
export function mixAudio(job:RenderJob,cues:readonly AudioCue[]):{samples:Float32Array;peak:number;frames:number;sampleRate:48000;channels:2} {
  const frames=job.totalFrames*800,samples=new Float32Array(frames*2),assets=Object.fromEntries(Object.keys(SOUND_SPECS).map(kind=>[kind,soundSamples(kind as SoundKind)])) as Record<SoundKind,Float32Array>;
  for(const cue of cues){const sound=assets[cue.kind],gain=SOUND_SPECS[cue.kind].gain,left=gain*(1-cue.pan)/2,right=gain*(1+cue.pan)/2;
    for(let i=0;i<sound.length&&cue.sampleOffset+i<frames;i++){const offset=(cue.sampleOffset+i)*2;samples[offset]!+=sound[i]!*left;samples[offset+1]!+=sound[i]!*right;}}
  let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));if(peak>1)throw new Error('AUDIO_CLIPPING');
  return {samples,peak,frames,sampleRate:48000,channels:2};
}
export function pcmWav(samples:Float32Array,channels=2):Uint8Array {
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer),ascii=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  ascii(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,AUDIO_SAMPLE_RATE,true);view.setUint32(28,AUDIO_SAMPLE_RATE*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){if(!Number.isFinite(samples[i])||Math.abs(samples[i]!)>1)throw new Error('Invalid WAV sample');view.setInt16(44+i*2,Math.round(samples[i]!*32767),true);}return new Uint8Array(buffer);
}
