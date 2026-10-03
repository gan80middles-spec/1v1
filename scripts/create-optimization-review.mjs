import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {replayInputs} from '../dist/node/runner/input-replay.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {deriveSeed} from '../dist/node/math/random.js';
import {argumentsFor} from './optimization-common.mjs';
const args=argumentsFor(['--control','--candidate','--output']);for(const key of ['--control','--candidate','--output'])assert(args[key]);
const reports={};for(const version of ['control','candidate'])reports[version]=JSON.parse(await readFile(`${args[`--${version}`]}/report.json`,'utf8'));
assert.equal(reports.control.manifestHash,reports.candidate.manifestHash);
const subset=reports.control.rows.filter(r=>r.split==='train'&&r.sampleIndex===4&&r.participantIds?.[0]==='P');assert.equal(subset.length,10);
await mkdir(args['--output'],{recursive:true});const key=[],entries=[];
for(const [i,item]of subset.entries()){
  const order=deriveSeed(20261003,'r2-review-side',item.caseId)%2?['candidate','control']:['control','candidate'];
  for(const [j,version]of order.entries()){
    const label=`pair-${String(i+1).padStart(2,'0')}-${j?'Y':'X'}`,path=`${args[`--${version}`]}/records/${item.caseId}.json.gz`;
    const replay=JSON.parse(gunzipSync(await readFile(path)).toString('utf8')),loaded=replayInputs(replay);
    const row=reports[version].rows.find(r=>r.caseId===item.caseId);assert.equal(replay.finalWorldHash,row.worldHash);
    await writeFile(`${args['--output']}/${label}.json`,canonicalSerialize({schemaVersion:1,label,frames:loaded.frames,events:replay.events,
      characters:replay.content.characters,abilities:replay.content.abilities,statuses:replay.content.statuses,arenas:replay.content.arenas})+'\n',{flag:'wx'});
    entries.push({label,url:`./${label}.json`});key.push({label,version,caseId:item.caseId,worldHash:replay.finalWorldHash});
  }
}
const index={schemaVersion:1,reviewId:`optimization-r2-${hashCanonical(key).slice(0,12)}`,title:'第二轮 AI 新旧对照',paired:true,
  reviewKind:'ai-comparison',status:'pending-human-review',entries};
await writeFile(`${args['--output']}/index.json`,JSON.stringify(index,null,2)+'\n',{flag:'wx'});
await writeFile(`${args['--output']}/private-key.json`,JSON.stringify({manifestHash:reports.control.manifestHash,key},null,2)+'\n',{flag:'wx'});
console.log('Created 10 paired, stratified, predetermined training clips; human feedback pending.');
