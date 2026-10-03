import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {argumentsFor,fingerprint,loadManifest} from './optimization-common.mjs';
const args=argumentsFor(['--control','--candidate','--manifest','--training','--output']);for(const key of ['--control','--candidate','--manifest','--training','--output'])assert(args[key]);
const source=await fingerprint(),training=JSON.parse(await readFile(`${args['--training']}/source-hashes.json`,'utf8'));
for(const [path,hash]of Object.entries(training.hashes))if(/^(src|dist\/node)\/(ai|runner|sim|math|content|contracts)\//.test(path))assert.equal(source.hashes[path],hash,`Training kernel changed: ${path}`);
const manifest=await loadManifest(args['--manifest']),contents=[];
for(const name of ['control','candidate']){const content=compilePhase3BContent(JSON.parse(await readFile(args[`--${name}`],'utf8')));contents.push({name,path:args[`--${name}`],hash:content.bundleHash,version:name==='control'?'utility-v4':'utility-v5'});}
const freeze={frozenAt:new Date().toISOString(),sourceHash:source.hash,manifestHash:manifest.datasetHash,contents,
  decision:'Evaluate the completed delay-gap own-contact/knockback model once on the new holdout. No further tuning. Adopt opt-in only if paired behavioral gates, correctness, fixed-work performance and legacy regressions pass. Director stays off; human review stays pending.',
  criteria:{missReduction:.03,interactionLoss:.01,materialInteractionLoss:.02,hitMinuteRatio:.97,materialHitMinuteRatio:.90,
    oneSidedIncrease:.02,materialOneSidedIncrease:.05,coldIncreaseSeconds:.5,materialColdIncreaseSeconds:1,
    maxWallGrowth:.10,legacyBaselineMissCeiling:.45},
  interpretation:'Point bounds screen small deterioration; paired 95% intervals must also exclude the stated material-loss bounds. A >0 lower miss-reduction interval establishes directional improvement; at least 3pp point improvement is required. No rejected requests/invalid matches. Human naturalness is not certified by these statistics.'};
await writeFile(args['--output'],JSON.stringify(freeze,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(freeze));
