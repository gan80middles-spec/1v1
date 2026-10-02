import { RenderJobSchema, RENDERER_VERSION, type RenderJob, type ReplayManifest, type TimelineSegment } from '../contracts/production.js';
import { hashCanonical } from '../math/hash.js';
export function createRenderJob(manifest:ReplayManifest,manifestHash:string,options:{preset:'vertical-1080'|'vertical-720';templateId:'arena-dark'|'arena-light';fontHash:string;audioAssetsHash:string;keepFrames:boolean;toolchainId?:string}):RenderJob {
  const timeline:TimelineSegment[]=[];let cursor=0;
  const add=(kind:TimelineSegment['kind'],length:number,from:number,to:number)=>{timeline.push({kind,startFrame:cursor,endFrameExclusive:cursor+length,sourceStartTick:from,sourceEndTick:to});cursor+=length;};
  add('intro',60,0,0);add('battle',manifest.durationTicks+1,0,manifest.durationTicks);
  if(manifest.result.reason==='ko'||manifest.result.reason==='double-ko')add('hold',6,manifest.durationTicks,manifest.durationTicks);
  add('outro',90,manifest.durationTicks,manifest.durationTicks);
  const base={schemaVersion:1 as const,replayId:manifest.replayId,replayManifestHash:manifestHash,rendererVersion:RENDERER_VERSION,templateId:options.templateId,fps:60 as const,width:options.preset==='vertical-1080'?1080 as const:720 as const,height:options.preset==='vertical-1080'?1920 as const:1280 as const,timeline,totalFrames:cursor,toolchainId:options.toolchainId??manifest.toolchainId,visualSeed:manifest.seed,fontHash:options.fontHash,audioAssetsHash:options.audioAssetsHash,preset:options.preset,keepFrames:options.keepFrames};
  return RenderJobSchema.parse({...base,id:'export-'+hashCanonical(base).slice(0,20)});
}
export function videoFrameSource(job:RenderJob,n:number):{sourceTick:number;kind:TimelineSegment['kind']} {
  if(!Number.isInteger(n)||n<0||n>=job.totalFrames)throw new Error('Video frame out of bounds');
  const segment=job.timeline.find(s=>n>=s.startFrame&&n<s.endFrameExclusive)!;
  const sourceTick=segment.kind!=='battle'?segment.sourceStartTick:job.rendererVersion==='canvas-video-v1'?segment.sourceStartTick+(n-segment.startFrame)/(segment.endFrameExclusive-segment.startFrame-1)*(segment.sourceEndTick-segment.sourceStartTick):segment.sourceStartTick+(n-segment.startFrame)*(segment.sourceEndTick-segment.sourceStartTick)/(segment.endFrameExclusive-segment.startFrame-1);
  return {kind:segment.kind,sourceTick};
}
export function sourceBoundaryVideoFrame(job:RenderJob,sourceTick:number):number {
  const segment=job.timeline.find(s=>s.kind==='battle'&&sourceTick>=s.sourceStartTick&&sourceTick<=s.sourceEndTick);if(!segment)throw new Error('Event boundary outside battle');
  // Multiply the integer offsets first. Dividing before multiplying can round an exact
  // tick slightly upward, making ceil delay a sound by a complete video frame.
  return segment.startFrame+Math.ceil(job.rendererVersion==='canvas-video-v1'?(sourceTick-segment.sourceStartTick)/(segment.sourceEndTick-segment.sourceStartTick)*(segment.endFrameExclusive-segment.startFrame-1):(sourceTick-segment.sourceStartTick)*(segment.endFrameExclusive-segment.startFrame-1)/(segment.sourceEndTick-segment.sourceStartTick));
}
