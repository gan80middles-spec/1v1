import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {aggregateEvaluation} from '../dist/node/analysis/evaluation.js';
import {Xoshiro128ss} from '../dist/node/math/random.js';
const load=async p=>JSON.parse(await readFile(p,'utf8')),report=name=>load(`artifacts/calibration/${name}/report.json`);
const legacy=await report('release-legacy-baseline'),train=await report('release-train-baseline'),holdout=await report('release-holdout-baseline');
const archive=await load('artifacts/phase-5/release/baseline.json'),frozen=await load('artifacts/calibration/freeze.json');
for(const [p,hash]of Object.entries(frozen.hashes))assert.equal(createHash('sha256').update(await readFile(p)).digest('hex'),hash,`Frozen algorithm changed: ${p}`);
for(const row of legacy.rows){const old=archive.results.find(r=>r.caseId===row.caseId);for(const key of ['inputHash','finalWorldHash','finalRunnerHash'])assert.equal(row[key],old[key],`${row.caseId} legacy ${key}`);}
const upgraded=[...train.rows,...holdout.rows];assert.equal(new Set(upgraded.map(r=>r.caseId)).size,800);
const q=(v,p)=>v.length?[...v].sort((a,b)=>a-b)[Math.ceil(v.length*p)-1]:null;
const sum=(rows,get)=>rows.reduce((s,r)=>s+get(r),0);
function pacing(rows){const cold=rows.flatMap(r=>r.pacing.coldIntervalsTicks),casts=sum(rows,r=>r.pacing.basicCasts),misses=sum(rows,r=>r.pacing.basicMisses);return{matches:rows.length,basicCasts:casts,basicMisses:misses,basicMissRate:misses/casts,coldIntervals:cold.length,coldP90Seconds:q(cold,.9)/60,longestColdP90Seconds:q(rows.map(r=>r.pacing.longestColdTicks),.9)/60,interactionFraction:sum(rows,r=>r.pacing.interactionFraction*r.pacing.ticks)/sum(rows,r=>r.pacing.ticks),oneSidedFraction:rows.filter(r=>r.pacing.oneSided).length/rows.length,meanDurationSeconds:sum(rows,r=>r.pacing.durationSeconds)/rows.length,ultimateCasts:sum(rows,r=>r.pacing.ultimateCasts),effectiveUltimates:sum(rows,r=>r.pacing.effectiveUltimates),repeatedMisses:sum(rows,r=>r.pacing.repeatedConfirmedAttackMisses)};}
// Resample paired seed clusters, keeping the two side swaps together for baseline tests.
function bootstrap(before,after,key,stat){const groups=new Map();for(const a of after){const b=before.find(b=>b.caseId===a.caseId);assert(b);const k=key(a);if(!groups.has(k))groups.set(k,[]);groups.get(k).push([b,a]);}const clusters=[...groups.values()],rng=new Xoshiro128ss(20261003),samples=[];for(let i=0;i<2000;i++){const pairs=[];for(let n=0;n<clusters.length;n++)pairs.push(...clusters[rng.nextUint32()%clusters.length]);samples.push(stat(pairs.map(p=>p[0]),pairs.map(p=>p[1])));}return{replicates:2000,clusters:clusters.length,ci95:[q(samples,.025),q(samples,.975)]};}
const baseline={};for(const split of ['train','holdout','all']){const old=legacy.rows.filter(r=>split==='all'||r.split===split),next=upgraded.filter(r=>split==='all'||r.split===split);baseline[split]={v3:aggregateEvaluation(old),v4:aggregateEvaluation(next)};}
baseline.holdout.missDifference=bootstrap(legacy.rows.filter(r=>r.split==='holdout'),holdout.rows,r=>`${r.a}:${r.b}:${r.baseline}:${r.sampleIndex}`,(a,b)=>aggregateEvaluation(b).basicMissRate-aggregateEvaluation(a).basicMissRate);
baseline.byCharacter=Object.fromEntries(['iron','mirror','rubber','standard'].map(character=>[character,{v3:aggregateEvaluation(legacy.rows.filter(r=>(r.side===0?r.a:r.b)===character)),v4:aggregateEvaluation(upgraded.filter(r=>(r.side===0?r.a:r.b)===character))}]));
const offTrain=await report('release-train-pacing-off'),offHold=await report('release-holdout-pacing-off'),expTrain=await report('relative-train-pacing'),expHold=await report('release-holdout-pacing-relative');
const oldPacing=await load('artifacts/phase-3b/evaluation.json'),self={};
for(const split of ['train','holdout','all']){const off=(split==='train'?offTrain.rows:split==='holdout'?offHold.rows:[...offTrain.rows,...offHold.rows]),experiment=(split==='train'?expTrain.rows:split==='holdout'?expHold.rows:[...expTrain.rows,...expHold.rows]);const before=pacing(off),after=pacing(experiment);self[split]={v3Off:split==='all'?oldPacing.off:oldPacing[split].off,v4Off:before,experimentalPace:after,coldP90Reduction:1-after.coldP90Seconds/before.coldP90Seconds};}
self.holdout.coldP90ReductionUncertainty=bootstrap(offHold.rows,expHold.rows,r=>r.caseId,(a,b)=>1-pacing(b).coldP90Seconds/pacing(a).coldP90Seconds);
const summary={passed:true,legacy800HashesPreserved:true,contentHash:holdout.contentHash,frozen,baseline,self,adoption:{ai:'utility-v4 opt-in calibrated preset',pacing:'off',experimentalDirector:'not promoted: misses 20% target and worsens holdout one-sidedness'},evidence:{correctness:await load('artifacts/calibration/verification/correctness.json'),integration:await load('artifacts/calibration/verification/integration.json')}};
await writeFile('artifacts/calibration/summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({...summary,evidence:{correctness:{...summary.evidence.correctness,rows:undefined},integration:{...summary.evidence.integration,production:undefined}},frozen:undefined},null,2));
