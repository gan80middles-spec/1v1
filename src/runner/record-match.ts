import type { ContentBundle } from '../contracts/content.js';
import type { FighterConfig, InputReplay } from '../contracts/fighter.js';
import type { FullCheckpoint } from '../contracts/ai.js';
import type { PresentationFrame, ReplayManifest } from '../contracts/production.js';
import { UtilityRunner } from './utility.js';
import { presentationFrame } from './presentation-recording.js';
import { fighterWorldHash } from '../sim/fighter-state.js';
import { canonicalSerialize } from '../math/canonical.js';
import { replayInputs } from './input-replay.js';
import { FighterSimulation } from '../sim/fighter.js';

export function recordMatch(content:ContentBundle,config:FighterConfig,runnerOptions:ReplayManifest['runner'],collectCheckpoints=false,cancelled=()=>false) {
  const s=runnerOptions.settings,settings={noise:s.noise,randomChoice:s.randomChoice,memory:s.memory,...(s.prediction===undefined?{}:{prediction:s.prediction}),...(s.hysteresis===undefined?{}:{hysteresis:s.hysteresis})};
  const runner=new UtilityRunner(content,config,{kinds:runnerOptions.kinds,settings,trace:false,recordFrames:false}),frames:PresentationFrame[]=[presentationFrame(runner.sim.snapshot(),content)],hashes=[{tick:0,worldHash:fighterWorldHash(runner.sim.snapshot()),runnerHash:runner.runnerHash()}],checkpoints:FullCheckpoint[]=[];
  if(collectCheckpoints)checkpoints.push(runner.snapshot());
  while(!runner.sim.snapshot().result){if(cancelled())throw new Error('CANCELLED');runner.step();const world=runner.sim.snapshot();frames.push(presentationFrame(world,content));if(world.tick%60===0||world.result)hashes.push({tick:world.tick,worldHash:fighterWorldHash(world),runnerHash:runner.runnerHash()});if(collectCheckpoints&&(world.tick%120===0||world.result))checkpoints.push(runner.snapshot());}
  return {replay:runner.replay(),frames,hashes,checkpoints,rulesHash:runner.sim.snapshot().rulesHash};
}
export function rebuildPresentation(content:ContentBundle,replay:InputReplay,hashes:ReturnType<typeof recordMatch>['hashes'],options:ReplayManifest['runner'],fullCheckpoints:boolean,cancelled=()=>false) {
  // First pass uses input replay only. It never reconstructs controller state from inputs.
  replayInputs(replay,false);
  const simulation=new FighterSimulation(content,replay.config,undefined,replay.engineBuild),frames=[presentationFrame(simulation.snapshot(),content)],saved=new Map(hashes.map(h=>[h.tick,h.worldHash]));
  if(saved.get(0)!==fighterWorldHash(simulation.snapshot()))throw new Error('Rebuild initial worldHash drift');
  for(const input of replay.inputs){if(cancelled())throw new Error('CANCELLED');const out=simulation.step(input.intents);frames.push(presentationFrame(out.state,content));if(saved.has(out.state.tick)&&saved.get(out.state.tick)!==fighterWorldHash(out.state))throw new Error(`Rebuild worldHash drift at ${out.state.tick}`);}
  if(fighterWorldHash(simulation.snapshot())!==replay.finalWorldHash)throw new Error('Rebuild final drift');
  let checkpoints:FullCheckpoint[]=[];
  if(fullCheckpoints){const regenerated=recordMatch(content,replay.config,options,true,cancelled);
    if(canonicalSerialize(regenerated.replay.inputs)!==canonicalSerialize(replay.inputs)||canonicalSerialize(regenerated.replay.events)!==canonicalSerialize(replay.events)||canonicalSerialize(regenerated.replay.directorRecords??[])!==canonicalSerialize(replay.directorRecords??[]))throw new Error('Controller/director input regeneration drift');
    if(canonicalSerialize(regenerated.hashes)!==canonicalSerialize(hashes))throw new Error('Controller runnerHash regeneration drift');checkpoints=regenerated.checkpoints;}
  return {frames,checkpoints};
}
