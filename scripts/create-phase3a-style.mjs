import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compilePhase3AContent} from '../dist/node/content/phase3a.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {deriveSeed} from '../dist/node/math/random.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {evaluationMetrics} from '../dist/node/analysis/evaluation.js';
const source=JSON.parse(await readFile('content/fighter-phase3a.json','utf8')),manifest=JSON.parse(await readFile('fixtures/seeds/correctness-v1.json','utf8'));
for(const p of source.profiles){p.reactionDelayTicks=9;p.decisionIntervalTicks=6;p.positionNoisePx=6;p.velocityNoisePxPerSecond=18;p.nearBestBand=.8;}
const content=compilePhase3AContent(source),subset=manifest.cases.filter(c=>c.a===c.b&&c.sampleIndex<5);assert.equal(subset.length,20);
const entries=subset.flatMap(item=>['pressure','counter'].map(profile=>({...item,profile}))).sort((a,b)=>deriveSeed(777,'style-order',a.caseId,a.profile)-deriveSeed(777,'style-order',b.caseId,b.profile)),dir=resolve('artifacts/phase-3a/style');await mkdir(dir,{recursive:true});
const save=(name,data)=>writeFile(resolve(dir,name),canonicalSerialize(data)+'\n'),key=[],metrics=[];
for(let i=0;i<entries.length;i++){
  const item=entries[i],label=`review-${String(i+1).padStart(2,'0')}`,cfg=fighterConfig(content,item.seed,item.a,item.b);cfg.matchId=label;cfg.participants[0].profileId=item.profile;cfg.participants[1].profileId='balanced';
  const runner=new UtilityRunner(content,cfg,{kinds:['utility','rush'],trace:false}),replay=runner.run();assert.notEqual(replay.result.reason,'invalid');
  await save(`${label}.json`,{schemaVersion:1,label,frames:runner.frames,events:replay.events,characters:content.source.characters,abilities:content.source.abilities,statuses:content.source.statuses,arenas:content.source.arenas});
  key.push({label,caseId:item.caseId,seed:item.seed,character:item.a,profile:item.profile,finalWorldHash:replay.finalWorldHash,inputHash:hashCanonical(replay.inputs),eventSequenceHash:hashCanonical(replay.events)});metrics.push({label,...item,metrics:evaluationMetrics(replay,runner.frames,1)});
}
const runsHash=hashCanonical(key),reviewId=`phase3a-style-v1-${content.bundleHash.slice(0,8)}-${hashCanonical(subset).slice(0,8)}-${runsHash.slice(0,8)}`;
await save('index.json',{schemaVersion:1,reviewId,title:'四角色打法观感盲评',status:'pending-human-review',entries:key.map(k=>({label:k.label,url:`./${k.label}.json`}))});
await save('private-key.json',{contentHash:content.bundleHash,parentManifestHash:manifest.datasetHash,subsetHash:hashCanonical(subset),reactionDelayTicks:9,decisionIntervalTicks:6,positionNoisePx:6,velocityNoisePxPerSecond:18,nearBestBand:.8,key,metrics});
const groups=['pressure','counter'].flatMap(profile=>['iron','mirror','rubber','standard'].map(character=>{const rows=metrics.filter(r=>r.profile===profile&&r.a===character),mean=k=>rows.reduce((s,r)=>s+(r.metrics[k]??0),0)/rows.length;return {profile,character,n:rows.length,meanCenterDistance:mean('meanCenterDistance'),activeApproachFraction:mean('activeApproachFraction'),skillEffectiveRate:mean('skillEffectiveRate'),maxFullEnergyWaitSeconds:mean('maxFullEnergyWaitSeconds')};}));
await writeFile(resolve('artifacts/phase-3a/style.json'),JSON.stringify({passed:true,reviewId,runsHash,status:'pending-human-review',matches:40,pressure:20,counter:20,perCharacterPerProfile:5,contentHash:content.bundleHash,parentManifestHash:manifest.datasetHash,subsetHash:hashCanonical(subset),sameInformationBudget:{reactionDelayTicks:9,decisionIntervalTicks:6,positionNoisePx:6,velocityNoisePxPerSecond:18,nearBestBand:.8},groups},null,2)+'\n');
console.log('Created 40 anonymous four-character style clips; human review remains pending.');
