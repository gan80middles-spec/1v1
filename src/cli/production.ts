import { resolve } from 'node:path';
import { readJSON } from '../jobs/files.js';
import { openBatch, simulateBatch, rankBatch, type JobContext } from '../jobs/batch.js';
import { renderSelection, verifySelection } from '../jobs/export.js';
import { openStoredBatch } from '../jobs/stored-batch.js';
const args=process.argv.slice(2),command=args.shift()??'help';
const option=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
async function main(){
  if(command==='export-replay'){const path=option('--batch');if(!path)throw new Error('--batch required');const template=option('--template'),preset=option('--preset');if(template&&!['arena-dark','arena-light'].includes(template))throw new Error('Invalid template');if(preset&&!['vertical-1080','vertical-720'].includes(preset))throw new Error('Invalid preset');const {context,release}=await openStoredBatch(path);try{await renderSelection(context,{...(option('--match')?{onlyIds:[option('--match')!]}:{}),...(template?{templateId:template as 'arena-dark'|'arena-light'}:{}),...(preset?{preset:preset as 'vertical-1080'|'vertical-720'}:{})});if(context.batch.tasks.some(t=>t.state==='failed'))process.exitCode=2;}finally{await release();}return;}
  if(command==='help'){console.log('production <batch|rank|render|verify|produce> --config production.example.json [--resume] [--fault worker-crash|simulation|rebuilding-track|rendering|encoding|verifying]');return;}
  if(!['batch','rank','render','verify','produce'].includes(command))throw new Error('Unknown production command');
  const path=option('--config');if(!path)throw new Error('--config is required');
  const fault=option('--fault')??null;if(fault&&!['worker-crash','simulation','rebuilding-track','rendering','encoding','verifying'].includes(fault))throw new Error('Invalid fault');
  const {context,release}=await openBatch(await readJSON(resolve(path)),{resume:args.includes('--resume'),fault:fault as JobContext['fault']});
  try{if(command==='batch'||command==='produce')await simulateBatch(context);
    if(!context.cancelled()&&(command==='rank'||command==='produce'))await rankBatch(context);
    if(!context.cancelled()&&(command==='render'||command==='produce'))await renderSelection(context);
    if(command==='verify')await verifySelection(context);
    console.log(JSON.stringify({batch:context.directory,status:context.batch.status,selected:context.batch.selection,complete:context.batch.tasks.filter(t=>t.state==='complete').length,failures:context.batch.failures.length}));
    if(context.cancelled()||context.batch.status==='failed'||context.batch.selection.some(id=>context.batch.tasks.find(t=>t.matchId===id)?.state==='failed'))process.exitCode=2;
  }finally{await release();}
}
await main().catch(error=>{console.error(error);process.exitCode=1;});
