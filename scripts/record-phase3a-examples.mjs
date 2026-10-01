import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {compilePhase3AContent} from '../dist/node/content/phase3a.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
const source=JSON.parse(await readFile('content/fighter-phase3a.json','utf8')),content=compilePhase3AContent(source),baseline=JSON.parse(await readFile('artifacts/phase-3a/evaluation/baseline.json','utf8')),correctness=JSON.parse(await readFile('artifacts/phase-3a/correctness.json','utf8')),dir=resolve('artifacts/phase-3a/examples');await mkdir(dir,{recursive:true});
const selections=baseline.results.filter(r=>r.winner==='baseline').map(r=>({row:r,source:'baseline',label:`loss-${r.caseId}`}));
for(const [label,predicate] of [
  ['mirror-reflect',r=>r.events.some(e=>e.type==='ProjectileReflected')],
  ['iron-giant',r=>r.events.some(e=>e.type==='CastAccepted'&&e.payload.abilityId==='iron-giant')],
  ['rubber-wall',r=>r.events.some(e=>e.type==='PassiveTriggered')],
]){
  let selected=null;
  for(const row of correctness.results){const replay=JSON.parse(gunzipSync(await readFile(resolve('artifacts/phase-3a/correctness',row.recordFile))).toString('utf8'));if(predicate(replay)){selected={row,source:'correctness',label};break;}}
  if(!selected)for(const row of baseline.results){const replay=JSON.parse(gunzipSync(await readFile(resolve('artifacts/phase-3a/evaluation',row.recordFile))).toString('utf8'));if(predicate(replay)){selected={row,source:'baseline',label};break;}}
  assert(selected,`Missing actual ${label} mechanism sample`);selections.push(selected);
}
const examples=[];
for(const item of selections){const {row}=item,cfg=fighterConfig(content,row.seed,row.a,row.b);let kinds=['utility','utility'];if(item.source==='baseline'){const u=row.side===0?0:1;cfg.participants[u].participantId='utility';cfg.participants[1-u].participantId='baseline';kinds=u===0?['utility',row.baseline]:[row.baseline,'utility'];}
  const runner=new UtilityRunner(content,cfg,{kinds,trace:true}),replay=runner.run();assert.equal(replay.finalWorldHash,row.finalWorldHash);assert.equal(hashCanonical(replay.inputs),row.inputHash);
  await writeFile(resolve(dir,`${item.label}.json`),canonicalSerialize(replay)+'\n');await writeFile(resolve(dir,`${item.label}.trace.json`),canonicalSerialize({engineBuild:replay.engineBuild,config:cfg,contentHash:content.bundleHash,traces:runner.traces})+'\n');
  const utilityId=cfg.participants.findIndex(p=>p.participantId==='utility')+1;
  const relevant=replay.events.find(e=>item.label==='mirror-reflect'?e.type==='ProjectileReflected':item.label==='iron-giant'?e.type==='CastAccepted'&&e.payload.abilityId==='iron-giant':item.label==='rubber-wall'?e.type==='PassiveTriggered':e.type==='EntityDied'&&e.sourceId===utilityId);
  examples.push({label:item.label,caseId:row.caseId,seed:row.seed,eventTick:relevant?.tick??null,event:relevant??null,actorRole:item.source==='baseline'&&relevant?.sourceId!==utilityId?'baseline':'utility',finalWorldHash:replay.finalWorldHash,replay:`artifacts/phase-3a/examples/${item.label}.json`,trace:`artifacts/phase-3a/examples/${item.label}.trace.json`});
}
await writeFile(resolve('artifacts/phase-3a/examples.json'),JSON.stringify({passed:true,contentHash:content.bundleHash,lossCases:baseline.results.filter(r=>r.winner==='baseline').length,examples},null,2)+'\n');console.log(`Saved ${examples.length} actual mechanism/loss cases with original seed, full input replay and trace.`);
