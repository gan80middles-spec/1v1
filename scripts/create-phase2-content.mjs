import {readFile,writeFile} from 'node:fs/promises';
const source=JSON.parse(await readFile('content/fighter-phase1.json','utf8'));
const base=source.profiles.find(p=>p.id==='balanced');
source.profiles.push({...base,id:'counter',aggression:.4,riskPreference:.3,spacing:.85,resourcePatience:.65,reactionDelayTicks:8,decisionIntervalTicks:6,positionNoisePx:5,velocityNoisePxPerSecond:16,distancePreference:'mixed'},
 {...base,id:'evasive',aggression:.35,riskPreference:.25,spacing:.95,resourcePatience:.55,reactionDelayTicks:10,decisionIntervalTicks:6,positionNoisePx:7,velocityNoisePxPerSecond:20,distancePreference:'ranged'});
await writeFile('content/fighter-phase2.json',JSON.stringify(source,null,2)+'\n');
