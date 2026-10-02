import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { statfs } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fileHash, readJSON, safeRead } from './files.js';
import type { RenderJob } from '../contracts/production.js';
import { soundSamples, pcmWav, type SoundKind } from '../render/audio.js';
export const chromiumPath=()=>resolve('.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe');
interface Toolchain {id:string;ffmpeg:{path:string;sha256:string};ffprobe:{path:string;sha256:string};font:{path:string;sha256:string};chromium:{version:string};}
export async function command(executable:string,args:string[],options:{cancelled?:()=>boolean;crashAfterMs?:number}={}):Promise<string>{return new Promise((accept,reject)=>{const child=spawn(executable,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',errors='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.length>8e6){child.kill();reject(new Error('PROCESS_OUTPUT_BUDGET'));}});child.stderr.on('data',chunk=>{errors=(errors+String(chunk)).slice(-100000);});const timer=setInterval(()=>{if(options.cancelled?.())child.kill();},100),fault=options.crashAfterMs===undefined?null:setTimeout(()=>child.kill(),options.crashAfterMs);child.on('error',reject);child.on('close',code=>{clearInterval(timer);if(fault)clearTimeout(fault);if(options.cancelled?.())reject(new Error('CANCELLED'));else if(code!==0)reject(new Error('MEDIA_PROCESS_FAILED '+code+' '+errors));else accept(output);});});}
export async function preflight(){const toolchain=await readJSON(resolve('content/export-toolchain.json')) as Toolchain;
  for(const item of [toolchain.ffmpeg,toolchain.ffprobe,toolchain.font])if(fileHash(await safeRead(resolve('.'),item.path))!==item.sha256)throw new Error('TOOLCHAIN_HASH_MISMATCH '+item.path);
  const audio=await readJSON(resolve('content/audio-assets.json')) as {assets:{kind:SoundKind;path:string;sha256:string}[]};for(const asset of audio.assets){const mono=soundSamples(asset.kind),bytes=pcmWav(Float32Array.from({length:mono.length*2},(_,i)=>mono[Math.floor(i/2)]!));if(fileHash(bytes)!==asset.sha256||fileHash(await safeRead(resolve('.'),asset.path))!==asset.sha256)throw new Error('AUDIO_ASSET_DRIFT '+asset.kind);}
  const codecs=await command(resolve(toolchain.ffmpeg.path),['-hide_banner','-encoders']);if(!codecs.includes('libx264')||!codecs.includes(' aac '))throw new Error('MISSING_ENCODER');
  const browser=await chromium.launch({headless:true,executablePath:chromiumPath()});try{if(browser.version()!==toolchain.chromium.version)throw new Error('CHROMIUM_VERSION_MISMATCH');}finally{await browser.close();}return toolchain;
}
export async function checkDisk(directory:string,job:RenderJob){const stats=await statfs(directory,{bigint:true}),available=stats.bavail*stats.bsize,required=BigInt(job.width*job.height*4*job.totalFrames+300_000_000);if(available<required)throw new Error('INSUFFICIENT_EXPORT_DISK_SPACE');return {available:available.toString(),required:required.toString()};}
export async function verifyMP4(path:string,job:RenderJob,tools:Toolchain,cancelled=()=>false){const data=JSON.parse(await command(resolve(tools.ffprobe.path),['-v','error','-count_frames','-show_streams','-show_format','-of','json',path],{cancelled})) as {streams:{codec_type:string;codec_name:string;width?:number;height?:number;r_frame_rate?:string;avg_frame_rate?:string;pix_fmt?:string;nb_read_frames?:string;sample_rate?:string;channels?:number;duration?:string}[];format:{duration:string}};
  const video=data.streams.find(s=>s.codec_type==='video'),audio=data.streams.find(s=>s.codec_type==='audio'),expected=job.totalFrames/60;
  if(!video||video.codec_name!=='h264'||video.width!==job.width||video.height!==job.height||video.r_frame_rate!=='60/1'||video.avg_frame_rate!=='60/1'||video.pix_fmt!=='yuv420p'||Number(video.nb_read_frames)!==job.totalFrames)throw new Error('VIDEO_STREAM_VERIFICATION_FAILED');
  if(!audio||audio.codec_name!=='aac'||audio.sample_rate!=='48000'||audio.channels!==2)throw new Error('AUDIO_STREAM_VERIFICATION_FAILED');
  if([Number(video.duration),Number(audio.duration),Number(data.format.duration)].some(duration=>!Number.isFinite(duration)||Math.abs(duration-expected)>1/60+1e-6))throw new Error('MEDIA_DURATION_MISMATCH');
  await command(resolve(tools.ffmpeg.path),['-nostdin','-v','error','-i',path,'-f','null','-'],{cancelled});return {passed:true,expectedDuration:expected,allowedDelta:1/60,fullDecodePassed:true,probe:data};
}
