import { VideoRenderer, type VideoPayload } from '../render/renderer.js';
import { RenderJobSchema } from '../contracts/production.js';
const canvas=document.querySelector<HTMLCanvasElement>('#video')!;
const font=new FontFace('ExportSans','url(/fonts/NotoSansSC-Regular.otf)');await font.load();document.fonts.add(font);await document.fonts.ready;
let renderer:VideoRenderer;
const exporter={load(payload:VideoPayload){RenderJobSchema.parse(payload.job);canvas.width=payload.job.width;canvas.height=payload.job.height;renderer=new VideoRenderer(canvas.getContext('2d')!,payload);},renderFrame(n:number){renderer.renderFrame(n);},ready:true};
Object.assign(globalThis,{__videoExporter:exporter});
