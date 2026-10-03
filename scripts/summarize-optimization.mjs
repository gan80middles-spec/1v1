import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {argumentsFor,summarize,quantile} from './optimization-common.mjs';
import {Xoshiro128ss} from '../dist/node/math/random.js';
const args=argumentsFor(['--control','--candidate','--output','--freeze']);
for(const key of ['--control','--candidate','--output'])assert(args[key]);
const control=JSON.parse(await readFile(`${args['--control']}/report.json`,'utf8')),candidate=JSON.parse(await readFile(`${args['--candidate']}/report.json`,'utf8'));
assert(control.passed&&candidate.passed);assert.equal(control.manifestHash,candidate.manifestHash);
const oldRows=new Map(control.rows.map(r=>[r.caseId,r]));assert.equal(oldRows.size,candidate.rows.length);
const clusters=new Map();for(const r of candidate.rows){assert(oldRows.has(r.caseId));const key=r.pairId??`${r.matchupId}:${r.seed}`;const group=clusters.get(key)??[];group.push(r.caseId);clusters.set(key,group);}
const strata=new Map();for(const [key,ids]of clusters){const matchup=candidate.rows.find(r=>r.caseId===ids[0]).matchupId;const values=strata.get(matchup)??[];values.push([key,ids]);strata.set(matchup,values);}
const newRows=new Map(candidate.rows.map(r=>[r.caseId,r])),rng=new Xoshiro128ss(20261003);
function differences(a,b){return{missReduction:a.basicMissRate-b.basicMissRate,interactionChange:b.interactionFraction-a.interactionFraction,
  hitMinuteRatio:b.effectiveBasicsPerMinute/a.effectiveBasicsPerMinute,oneSidedChange:b.oneSidedFraction-a.oneSidedFraction,coldChange:b.coldP90Seconds-a.coldP90Seconds};}
const bootstrap=[];for(let repeat=0;repeat<2000;repeat++){
  const ids=[];for(const groups of strata.values())for(let j=0;j<groups.length;j++)ids.push(...groups[rng.nextUint32()%groups.length][1]);
  bootstrap.push(differences(summarize(ids.map(id=>oldRows.get(id))),summarize(ids.map(id=>newRows.get(id)))));
}
const diff=differences(control.summary,candidate.summary),intervals=Object.fromEntries(Object.keys(diff).map(k=>[k,[quantile(bootstrap.map(r=>r[k]),.025),quantile(bootstrap.map(r=>r[k]),.975)]]));
const byMatchup={};for(const matchup of strata.keys()){const a=control.rows.filter(r=>r.matchupId===matchup),b=candidate.rows.filter(r=>r.matchupId===matchup);byMatchup[matchup]={control:summarize(a),candidate:summarize(b)};}
let adopted=null;if(args['--freeze']){
  const freeze=JSON.parse(await readFile(args['--freeze'],'utf8')),c=freeze.criteria;
  assert.equal(control.sourceHash,freeze.sourceHash);assert.equal(candidate.sourceHash,freeze.sourceHash);
  adopted=diff.missReduction>=c.missReduction&&intervals.missReduction[0]>0&&diff.interactionChange>=-c.interactionLoss&&intervals.interactionChange[0]>-c.materialInteractionLoss&&
    diff.hitMinuteRatio>=c.hitMinuteRatio&&intervals.hitMinuteRatio[0]>c.materialHitMinuteRatio&&diff.oneSidedChange<=c.oneSidedIncrease&&intervals.oneSidedChange[1]<c.materialOneSidedIncrease&&
    diff.coldChange<=c.coldIncreaseSeconds&&intervals.coldChange[1]<c.materialColdIncreaseSeconds&&candidate.summary.rejectedRequests===0;
}
const report={control:control.summary,candidate:candidate.summary,diff,intervals,byMatchup,pairedClusters:clusters.size,
  bootstrapReplicates:2000,bootstrap:'paired, stratified by matchup, seed/side pairs clustered',adopted};
await mkdir(args['--output'],{recursive:true});await writeFile(`${args['--output']}/comparison.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,byMatchup:undefined}));
