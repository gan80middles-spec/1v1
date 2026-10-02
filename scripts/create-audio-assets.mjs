import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {soundSamples,pcmWav,SOUND_SPECS,AUDIO_ASSETS_VERSION} from '../dist/node/render/audio.js';
const directory='public/audio';await mkdir(directory,{recursive:true});const assets=[];
for(const kind of Object.keys(SOUND_SPECS)){const mono=soundSamples(kind),stereo=Float32Array.from({length:mono.length*2},(_,i)=>mono[Math.floor(i/2)]),bytes=pcmWav(stereo),path=`${directory}/${kind}.wav`;if(process.argv.includes('--check')){if(!Buffer.from(bytes).equals(await readFile(path)))throw new Error('Audio waveform drift '+path);}else await writeFile(path,bytes);assets.push({kind,path,sha256:createHash('sha256').update(bytes).digest('hex'),samples:mono.length});}
const data={schemaVersion:1,version:AUDIO_ASSETS_VERSION,source:'Self-created analytical sine sweeps, envelopes and fixed gains; src/render/audio.ts',license:'CC0-1.0 (original project generated recordings)',sampleRate:48000,channels:2,specs:SOUND_SPECS,assets};
const output=JSON.stringify(data,null,2)+'\n';if(process.argv.includes('--check')){if(await readFile('content/audio-assets.json','utf8')!==output)throw new Error('Audio asset manifest drift');}else await writeFile('content/audio-assets.json',output);
console.log('Five original audio assets and waveform hashes verified.');
