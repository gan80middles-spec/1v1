import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {openBatch,rankBatch} from '../dist/node/jobs/batch.js';
import {loadReplayPackage,saveReplayPackage} from '../dist/node/jobs/replay-store.js';
import {rebuildPresentation} from '../dist/node/runner/record-match.js';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {analyzeMatch} from '../dist/node/analysis/interesting.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {fileHash,safeRead,atomicJSON} from '../dist/node/jobs/files.js';
const config=JSON.parse(await readFile('production.example.json','utf8')),opened=await openBatch(config,{resume:true}),changed=[],originalSelection=[...opened.context.batch.selection];
try{for(const task of opened.context.batch.tasks){const directory=resolve(opened.context.directory,'matches',task.matchId),pkg=await loadReplayPackage(directory),content=compilePhase3BContent(pkg.content),frames=pkg.frames.length?pkg.frames:rebuildPresentation(content,pkg.replay,pkg.hashes,pkg.manifest.runner,false).frames,analysis=analyzeMatch(pkg.replay,frames);if(hashCanonical(analysis)===hashCanonical(pkg.analysis))continue;assert(!originalSelection.includes(task.matchId),'Selected render dependencies would need regeneration');changed.push({matchId:task.matchId,before:pkg.analysis.score,after:analysis.score});await saveReplayPackage(directory,{replay:pkg.replay,content,runner:pkg.manifest.runner,hashes:pkg.hashes,analysis,toolchainId:pkg.manifest.toolchainId,rulesHash:pkg.manifest.rulesHash});task.manifestHash=fileHash(await safeRead(directory,'manifest.json'));await opened.context.save();}await rankBatch(opened.context);assert.deepEqual(opened.context.batch.selection,originalSelection);opened.context.batch.status='complete';await opened.context.save();await atomicJSON('artifacts/phase-4/analysis-recheck.json',{passed:true,matches:30,allSelectedAnalysesUnchanged:true,selectionUnchanged:true,changed});console.log('All 30 frozen analyses rechecked against final scoring implementation:',changed.length,'changed, selected dependencies unchanged.');}finally{await opened.release();}
