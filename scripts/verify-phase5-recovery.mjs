import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
await mkdir('artifacts/phase-5',{recursive:true});
for(const name of ['verify-phase4','verify-phase4-checkpoints','verify-phase4-recovery','verify-phase4-cleanup']){
  const path=resolve('scripts',name+'.mjs'),original=await readFile(path,'utf8');
  const source=original.replaceAll('artifacts/phase-4','artifacts/phase-5').replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,quote,relative)=>'from '+quote+new URL(relative,pathToFileURL(path)).href+quote);
  const saved=resolve('.cache',name+'-phase5.mjs');await mkdir(resolve('.cache'),{recursive:true});await writeFile(saved,source);
  console.log('Phase5 re-run of '+name+' (new artifact namespace; original scripts preserved)');
  await new Promise((accept,reject)=>{const child=spawn(process.execPath,[saved],{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('close',code=>code===0?accept():reject(new Error(name+' failed '+code)));});
}
