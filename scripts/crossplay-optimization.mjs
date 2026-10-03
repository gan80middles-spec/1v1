import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {pacingMetrics} from '../dist/node/analysis/pacing-metrics.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {argumentsFor,loadManifest,caseConfig} from './optimization-common.mjs';
const args=argumentsFor(['--control','--candidate','--manifest','--output']);for(const key of ['--control','--candidate','--manifest','--output'])assert(args[key]);
const original=JSON.parse(await readFile(args['--control'],'utf8')),candidate=JSON.parse(await readFile(args['--candidate'],'utf8'));
assert.equal(hashCanonical({...original,profiles:[]}),hashCanonical({...candidate,profiles:[]}), 'Crossplay changes battle content');
candidate.profiles.push(...original.profiles.map(p=>({...p,id:`fixed-v4-${p.id}`})));
const content=compilePhase3BContent(candidate),manifest=await loadManifest(args['--manifest']),rows=[];
const cases=manifest.cases.filter(c=>c.split==='train'&&c.sampleIndex>=4&&c.sampleIndex<6);
for(const item of cases)for(const candidateId of ['P','Q']){
  const cfg=caseConfig(content,item),oldIndex=cfg.participants.findIndex(p=>p.participantId!==candidateId);
  cfg.participants[oldIndex].profileId='fixed-v4-'+cfg.participants[oldIndex].profileId;
  const runner=new UtilityRunner(content,cfg,{recordFrames:true,trace:true}),replay=runner.run();assert.notEqual(replay.result.reason,'invalid');
  for(const {entityId,trace}of runner.traces)assert.equal(trace.aiVersion,cfg.participants[entityId-1].participantId===candidateId?'utility-v5':'utility-v4');
  rows.push({...item,candidateId,winner:replay.result.winnerParticipantId,inputHash:hashCanonical(replay.inputs),pacing:pacingMetrics(replay,runner.frames)});
}
await mkdir(args['--output'],{recursive:true});const report={passed:true,contentHash:content.bundleHash,manifestHash:manifest.datasetHash,
  matches:rows.length,candidateWins:rows.filter(r=>r.winner===r.candidateId).length,controlWins:rows.filter(r=>r.winner&&r.winner!==r.candidateId).length,
  draws:rows.filter(r=>!r.winner).length,note:'Seen training crossplay; swapped sides and candidate identities; not independent holdout evidence.',rows};
await writeFile(`${args['--output']}/crossplay.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,rows:undefined}));
