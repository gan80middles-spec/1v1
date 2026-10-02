import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {eligiblePool,choose} from '../dist/node/ai/selection.js';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {evaluationMetrics,aggregateEvaluation} from '../dist/node/analysis/evaluation.js';
import {pacingMetrics} from '../dist/node/analysis/pacing-metrics.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const split=arg('--split','train'),suite=arg('--suite','baseline'),label=arg('--label','causal-pilot'),limit=Number(arg('--limit','0')),model=arg('--model','causal-v1'),mode=arg('--pacing','off');
assert(['train','holdout','all'].includes(split));assert(['baseline','self','pacing'].includes(suite));assert(['legacy','causal-v1'].includes(model));assert(['off','observe','pace'].includes(mode));assert(/^[a-z0-9-]+$/.test(label));
const source=JSON.parse(await readFile('content/fighter-phase3b.json','utf8'));
if(model!=='legacy')for(const profile of source.profiles){profile.predictionModel=model;profile.version++;}
if(args.includes('--early-cue'))Object.assign(source.pacingProfiles[0],{version:2,noInteractionThresholdTicks:120,rampTicks:15});
if(args.includes('--relative-engage'))Object.assign(source.pacingProfiles[0],{version:3,engageModel:'gap-relative-v1'});
const content=compilePhase3BContent(source),manifest=JSON.parse(await readFile(`fixtures/seeds/${suite==='baseline'?'ai-baseline-v1':suite==='pacing'?'pacing-pairs-v1':'correctness-v1'}.json`,'utf8'));
const {datasetHash,...body}=manifest;assert.equal(hashCanonical(body),datasetHash);
let cases=manifest.cases.filter(c=>split==='all'||c.split===split);
// A pilot takes the same number of earliest training samples in every matchup/controller/side stratum.
if(limit)cases=cases.filter(c=>c.sampleIndex<limit);assert(cases.length);
const directory=resolve('artifacts/calibration',label);assert(!existsSync(resolve(directory,'report.json')),'Label already exists; use a fresh label');await mkdir(resolve(directory,'records'),{recursive:true});await writeFile(resolve(directory,'content.json'),JSON.stringify(source,null,2)+'\n');
const sources={};for(const path of ['src/ai/prediction.ts','src/ai/exchange.ts','src/ai/belief.ts','src/ai/motion.ts','src/ai/score.ts','src/ai/utility.ts','src/ai/director-score.ts','src/director/pacing.ts','src/ai/selection.ts','src/ai/options.ts','src/runner/utility.ts','src/contracts/ai-version.ts','src/contracts/ai.ts','src/contracts/ai-schema.ts','src/contracts/content-schema.ts','scripts/evaluate-calibration.mjs'])sources[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const rows=[],started=performance.now();
for(const item of cases){
 const cfg=fighterConfig(content,item.seed,item.a,item.b);cfg.pacing={mode,profileId:mode==='off'?null:'gentle-v1'};
 let kinds=['utility','utility'];if(suite==='baseline'){cfg.participants[item.side].participantId='utility';cfg.participants[1-item.side].participantId='baseline';kinds=item.side===0?['utility',item.baseline]:[item.baseline,'utility'];}
 const runner=new UtilityRunner(content,cfg,{kinds,recordFrames:true,trace:args.includes('--trace')||suite==='pacing'}),replay=runner.run();assert.notEqual(replay.result.reason,'invalid',item.caseId);
 const metrics=evaluationMetrics(replay,runner.frames,(item.side??0)+1),pacing=pacingMetrics(replay,runner.frames),casts=replay.events.filter(e=>e.type==='CastAccepted'&&e.payload.slot==='basic'&&(suite!=='baseline'||e.sourceId===item.side+1)),damage=new Set(replay.events.filter(e=>e.type==='DamageResolved'&&e.payload.amount>0).map(e=>e.sourceId+':'+e.payload.castId));
 const miss={casts:casts.length,misses:0,beforeActive:0,laterInterrupted:0,noInterrupt:0};
 for(const cast of casts){if(damage.has(cast.sourceId+':'+cast.payload.castId))continue;miss.misses++;const interrupted=replay.events.find(e=>e.type==='CastInterrupted'&&e.payload.castId===cast.payload.castId),ability=source.abilities.find(a=>a.id===cast.payload.abilityId);miss[interrupted?interrupted.tick<cast.tick+ability.startupTicks?'beforeActive':'laterInterrupted':'noInterrupt']++;}
 const recordFile=`records/${item.caseId}.json.gz`;await writeFile(resolve(directory,recordFile),gzipSync(canonicalSerialize(replay)+'\n'));
 const funnel={cues:(replay.directorRecords??[]).filter(r=>r.type==='issued').length,cueDecisions:0,adjustedDecisions:0,selectionChanged:0,changedThenInteractionWithin120:0};
 for(const {trace} of runner.traces){if(!trace.directorCue)continue;funnel.cueDecisions++;if(trace.candidates.some(c=>c.score?.director?.applied))funnel.adjustedDecisions++;const without=structuredClone(trace.candidates);for(const c of without)if(c.score)c.score.Uraw=c.score.Ubase??c.score.Uraw;const current=without.find(c=>c.option.key===trace.continuationKey)?.score?.Uraw??null;const pool=eligiblePool(without,current,trace.commitmentHeld,trace.emergency,content.source.profiles.find(p=>p.id===trace.profileId).nearBestBand);const selected=choose(pool,trace.choiceDraw,true,content.source.profiles.find(p=>p.id===trace.profileId).nearBestBand)?.option.key??trace.continuationKey;if(selected!==trace.selectedKey){funnel.selectionChanged++;if(replay.events.some(e=>e.tick>=trace.nowTick&&e.tick<trace.nowTick+120&&(e.type==='DamageResolved'&&e.payload.amount>=1||e.type==='ProjectileReflected')))funnel.changedThenInteractionWithin120++;}}
 const row={funnel,...item,winner:replay.result.winnerParticipantId,reason:replay.result.reason,metrics,pacing,miss,recordFile,inputHash:hashCanonical(replay.inputs),finalWorldHash:replay.finalWorldHash,finalRunnerHash:runner.runnerHash()};rows.push(row);
 if(args.includes('--trace'))await writeFile(resolve(directory,item.caseId+'.trace.json.gz'),gzipSync(canonicalSerialize(runner.traces)));
 if(rows.length%20===0)console.log(`${label}: ${rows.length}/${cases.length}`);
}
const q=(a,p)=>a.length?[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1]:null,sum=key=>rows.reduce((s,r)=>s+r.pacing[key],0),cold=rows.flatMap(r=>r.pacing.coldIntervalsTicks);
const summary={funnel:rows.reduce((s,r)=>{for(const [k,v]of Object.entries(r.funnel))s[k]=(s[k]??0)+v;return s;},{}),matches:rows.length,basicCasts:sum('basicCasts'),basicMissRate:sum('basicMisses')/sum('basicCasts'),coldP90Seconds:q(cold,.9)/60,longestColdP90Seconds:q(rows.map(r=>r.pacing.longestColdTicks),.9)/60,coldIntervals:cold.length,interactionFraction:rows.reduce((s,r)=>s+r.pacing.interactionFraction*r.pacing.ticks,0)/sum('ticks'),oneSidedFraction:rows.filter(r=>r.pacing.oneSided).length/rows.length,meanDurationSeconds:sum('durationSeconds')/rows.length,ultimateCasts:sum('ultimateCasts'),effectiveUltimates:sum('effectiveUltimates'),repeatedConfirmedAttackMisses:sum('repeatedConfirmedAttackMisses')};
const report={passed:true,label,model,split,suite,mode,manifestHash:datasetHash,contentHash:content.bundleHash,pacingProfile:source.pacingProfiles[0],sourceHashes:sources,sourceHash:hashCanonical(sources),aiVersion:model==='legacy'?'utility-v3':'utility-v4',elapsedSeconds:(performance.now()-started)/1000,overall:suite==='baseline'?aggregateEvaluation(rows):null,summary,miss:rows.reduce((s,r)=>{for(const key of Object.keys(s))s[key]+=r.miss[key];return s;},{casts:0,misses:0,beforeActive:0,laterInterrupted:0,noInterrupt:0}),rows};
await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({label,overall:report.overall,summary,miss:report.miss}));
