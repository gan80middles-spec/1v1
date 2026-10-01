import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {gzipSync} from 'node:zlib';
import {cpus,platform,release,totalmem} from 'node:os';
import {compilePhase3AContent} from '../dist/node/content/phase3a.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {deriveParticipantSeed} from '../dist/node/math/random.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {aggregateEvaluation,evaluationMetrics,METRICS_VERSION} from '../dist/node/analysis/evaluation.js';
import {BASELINE_VERSION} from '../dist/node/ai/baseline-rules.js';
import {PHASE3A_RULES_HASH} from '../dist/node/sim/fighter-state.js';
if(process.version!=='v24.21.0')throw Error('Use scripts/use-node.ps1 for the locked authoritative Node');
const {values}=parseArgs({options:{manifest:{type:'string',default:'fixtures/seeds/ai-baseline-v1.json'},output:{type:'string',default:'artifacts/phase-3a/evaluation'},ablations:{type:'boolean',default:false},limit:{type:'string'}},strict:true});
const manifest=JSON.parse(await readFile(resolve(values.manifest),'utf8')),{datasetHash,...body}=manifest;
assert.equal(hashCanonical(body),datasetHash,'Frozen manifest integrity');assert.equal(manifest.datasetId,'ai-baseline-v1');assert.equal(manifest.cases.length,800);assert.equal(manifest.pacingMode,'off');
let cases=manifest.cases;if(values.limit!==undefined){assert(/^\d+$/.test(values.limit)&&Number(values.limit)>0&&Number(values.limit)<=800);cases=cases.slice(0,Number(values.limit));}
const dir=resolve(values.output),source=JSON.parse(await readFile('content/fighter-phase3a.json','utf8')),content=compilePhase3AContent(source);
await mkdir(resolve(dir,'records'),{recursive:true});
const save=async(path,value)=>{const tmp=`${path}.${process.pid}.tmp`;await writeFile(tmp,canonicalSerialize(value)+'\n');await rename(tmp,path);};
const stamp={engineBuild:'phase3a-v1',aiVersion:'utility-v2',baselineVersion:BASELINE_VERSION,metricsVersion:METRICS_VERSION,pacingMode:'off',contentHash:content.bundleHash,rulesHash:PHASE3A_RULES_HASH,manifestHash:datasetHash,machine:{node:process.version,v8:process.versions.v8,os:platform(),release:release(),cpu:cpus()[0]?.model,logicalCores:cpus().length,memoryBytes:totalmem()}};
const aggregate=rows=>({overall:aggregateEvaluation(rows),groups:['iron','mirror','rubber','standard'].flatMap(a=>['rush','ranged'].flatMap(baseline=>['train','holdout'].map(split=>({character:a,baseline,split,...aggregateEvaluation(rows.filter(r=>r.a===a&&r.baseline===baseline&&r.split===split))}))))});
const coverage={utility:new Set(),baseline:new Set()},timings=[];
async function execute(item,bundle=content,settings={noise:true,randomChoice:true,memory:true},experiment='control',noDelay=false){
  const config=fighterConfig(bundle,item.seed,item.a,item.b),u=item.side===0?0:1;
  config.participants[u].participantId='utility';config.participants[1-u].participantId='baseline';
  if(noDelay)config.participants[u].profileId=`ablation-${config.participants[u].profileId}`;
  assert.equal(deriveParticipantSeed(item.seed,'utility'),item.participantAiSeeds.utility);assert.equal(deriveParticipantSeed(item.seed,'baseline'),item.participantAiSeeds.baseline);
  const kinds=u===0?['utility',item.baseline]:[item.baseline,'utility'],runner=new UtilityRunner(bundle,config,{kinds,settings,trace:false,recordFrames:true});
  const durations=[],controller=runner.controllers[u],update=controller.update.bind(controller);
  controller.update=o=>{const before=controller.decisionsMade,start=performance.now(),input=update(o),ms=performance.now()-start;if(controller.decisionsMade!==before)durations.push(ms);return input;};
  const start=performance.now(),replay=runner.run(),elapsedMs=performance.now()-start;
  if(replay.result.reason==='invalid'){
    await save(resolve(dir,`${experiment}-${item.caseId}.failure.json`),{item,experiment,content:bundle.source,checkpoint:runner.snapshot(true),diagnostics:runner.sim.snapshot().diagnostics});
    const diagnosticRunner=new UtilityRunner(bundle,config,{kinds,settings,trace:true});diagnosticRunner.run();await save(resolve(dir,`${experiment}-${item.caseId}.trace.json`),diagnosticRunner.traces);
  }
  const recordFile=`records/${experiment}-${item.caseId}.json.gz`;
  await writeFile(resolve(dir,recordFile),gzipSync(canonicalSerialize(replay)+'\n',{level:6}));
  const row={...item,experiment,winner:replay.result.winnerParticipantId,reason:replay.result.reason,finalWorldHash:replay.finalWorldHash,finalRunnerHash:runner.runnerHash(),inputHash:hashCanonical(replay.inputs),metrics:evaluationMetrics(replay,runner.frames,u+1),baselineMetrics:evaluationMetrics(replay,runner.frames,2-u),recordFile,elapsedMs,predictionTiming:{samples:durations.length,totalMs:durations.reduce((s,x)=>s+x,0),meanMs:durations.length?durations.reduce((s,x)=>s+x,0)/durations.length:null,p95Ms:durations.sort((a,b)=>a-b)[Math.ceil(durations.length*.95)-1]??null}};
  if(experiment==='control'){timings.push(...durations);for(const e of replay.events)if(e.type==='CastAccepted')coverage[e.sourceId===u+1?'utility':'baseline'].add(e.payload.abilityId);}
  return row;
}
const results=[];await save(resolve(dir,'baseline.json'),{...stamp,status:'running',n:0,expected:cases.length});
for(const item of cases){results.push(await execute(item));if(results.length%25===0||results.length===cases.length){await save(resolve(dir,'baseline.partial.json'),{...stamp,status:'running',n:results.length,expected:cases.length,results});console.log(`Baseline ${results.length}/${cases.length} (invalid ${results.filter(r=>r.reason==='invalid').length})`);}}
timings.sort((a,b)=>a-b);
const baseline={...stamp,status:results.some(r=>r.reason==='invalid')?'failed':'passed',scope:cases.length===800?'full-frozen-800':'diagnostic-prefix',n:results.length,train:results.filter(r=>r.split==='train').length,holdout:results.filter(r=>r.split==='holdout').length,subsetHash:hashCanonical(cases),...aggregate(results),coverage:Object.fromEntries(Object.entries(coverage).map(([key,value])=>[key,[...value].sort()])),predictionTiming:{includes:'Utility update per actual decision: memory, belief, prediction, scoring, selection; trace off; host measurement excluded from state',samples:timings.length,meanMs:timings.length?timings.reduce((s,x)=>s+x,0)/timings.length:null,p95Ms:timings[Math.ceil(timings.length*.95)-1]??null},results};
await save(resolve(dir,'baseline.json'),baseline);
if(values.ablations){
  assert.equal(cases.length,800,'Ablation study requires the complete control set');
  const subset=manifest.cases.filter(c=>c.sampleIndex<3||c.sampleIndex>=25&&c.sampleIndex<28);assert.equal(subset.length,96);
  const studies=[{id:'no-prediction',settings:{prediction:false}},{id:'no-hysteresis',settings:{hysteresis:false}},{id:'no-delay',settings:{}},{id:'no-memory',settings:{memory:false}}],studyResults=[];
  for(const study of studies){
    const raw=structuredClone(source);if(study.id==='no-delay')raw.profiles.push(...source.profiles.map(p=>({...p,id:`ablation-${p.id}`,reactionDelayTicks:0})));
    const bundle=compilePhase3AContent(raw),rows=[];
    for(const item of subset){rows.push(await execute(item,bundle,{noise:true,randomChoice:true,memory:true,...study.settings},study.id,study.id==='no-delay'));if(rows.length%24===0)console.log(`${study.id} ${rows.length}/96`);}
    studyResults.push({id:study.id,contentHash:bundle.bundleHash,settings:{noise:true,randomChoice:true,memory:true,...study.settings},informationBudgetChanged:study.id==='no-delay',utilityReactionDelayOverride:study.id==='no-delay'?0:null,baselineReactionDelayUnchanged:true,...aggregate(rows),results:rows});
    await save(resolve(dir,'ablations.partial.json'),{...stamp,subsetHash:hashCanonical(subset),cases:96,completed:studyResults});
  }
  const control=results.filter(r=>subset.some(c=>c.caseId===r.caseId));
  await save(resolve(dir,'ablations.json'),{...stamp,status:studyResults.some(s=>s.overall.invalid)?'failed':'passed',scope:'fixed same 96 configurations per variant; control reused from full baseline',casesPerVariant:96,trainPerVariant:48,holdoutPerVariant:48,additionalExecutions:384,subsetHash:hashCanonical(subset),control:{...aggregate(control),results:control},studies:studyResults,researchNote:'No-delay changes only Utility information maturity; it is a research condition, not a fair competitive baseline. No parameter was chosen using holdout data.'});
}
if(baseline.overall.invalid)process.exitCode=2;
console.log(JSON.stringify({status:baseline.status,n:baseline.n,overall:baseline.overall,report:resolve(dir,'baseline.json')},null,2));
