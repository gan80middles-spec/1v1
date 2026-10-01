import { readFile,writeFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('../content/fixtures/phase0.json',import.meta.url),'utf8'));
const standard=structuredClone(fixture.characters[0]);
standard.name='标准';standard.ruleText='近身打击与远程火球交替进攻';standard.slots.ultimate='standard-volley';
const rubber={...structuredClone(standard),id:'rubber',name:'橡胶',ruleText:'高速撞墙后短暂加速，最多三层',body:{...standard.body,mass:0.8,restitution:0.9,moveSpeed:340,jumpSpeed:640},slots:{basic:'rubber-slap',skill1:'rubber-dash',skill2:'rubber-cushion',ultimate:'rubber-overdrive'},passiveIds:['rubber-wall-growth'],aiProfileId:'pressure',visual:{shape:'circle',color:'#f7a74e',outlineColor:'#ffe6c5'}};
const abilities=structuredClone(fixture.abilities);
abilities[3].id='standard-volley';abilities[3].scheduledPolicy='before-first-emission';
const hit=(damage,x,y,hitGroup,hitstunTicks=10)=>({damage,launchDeltaV:{x,y},hitGroup,hitstunTicks});
const ability=(id,tags,s,a,r,cd,movementScale,predictorId,purpose,range,timeline)=>({id,version:1,tags,allowedWhen:'both',startupTicks:s,activeTicks:a,recoveryTicks:r,cooldownTicks:cd,energyCost:id==='rubber-overdrive'?100:0,movementScale,conditions:[],timeline,ai:{predictorId,preferredCenterDistance:range,purpose}});
abilities.push(
  ability('rubber-slap',['melee'],7,5,14,26,.25,'melee','damage',[76,104],[{offsetTick:7,effects:[{kind:'hitbox',radius:34,offset:{x:48,y:0},durationTicks:5,hit:hit(7,540,340,'slap')}]}]),
  ability('rubber-dash',['melee','mobility'],8,10,18,150,.25,'dash-hit','damage',[150,260],[{offsetTick:8,effects:[{kind:'impulse',deltaV:{x:900,y:0},target:'self',velocityMode:'set-x'},{kind:'hitbox',radius:34,offset:{x:48,y:0},durationTicks:10,hit:hit(10,700,280,'dash')}]}]),
  ability('rubber-cushion',['defense'],5,1,16,180,.6,'guard','defense',[76,104],[{offsetTick:5,effects:[{kind:'status',statusId:'cushion',target:'self'}]}]),
  ability('rubber-overdrive',['buff'],12,1,18,300,0,'self-buff','setup',[76,104],[{offsetTick:12,effects:[{kind:'status',statusId:'overdrive',target:'self'}]}]),
);
const neutralModifiers={damageTakenMultiplier:1,knockbackTakenMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1,massMultiplier:1,bodyScale:1,meleeHitboxScale:1,restitutionOverride:null,wallGrowthCoefficientOverride:null};
const status=(id,durationTicks,modifiers)=>({id,version:1,durationTicks,stacking:'refresh',maxStacks:1,modifiers:{...neutralModifiers,...modifiers},reflect:null});
const pressure={...fixture.profiles[0],id:'pressure',aggression:.85,riskPreference:.75,spacing:.3,resourcePatience:.3,reactionDelayTicks:11,positionNoisePx:8,velocityNoisePxPerSecond:24,distancePreference:'melee'};
const output={...fixture,schemaVersion:2,purpose:'production',characters:[standard,rubber],abilities,statuses:[status('cushion',36,{damageTakenMultiplier:.6,knockbackTakenMultiplier:1.25}),status('overdrive',240,{jumpSpeedMultiplier:1.15,wallGrowthCoefficientOverride:.1})],passives:[{id:'rubber-wall-growth',trigger:'wallBounce',internalCooldownTicks:6,conditions:[],effects:[{kind:'plugin',pluginId:'rubber-wall-growth',params:{minIncomingSpeed:250,internalCooldownTicks:6,maxStacks:3,durationTicks:120,growthCoefficient:.04}}]}],profiles:[fixture.profiles[0],pressure]};
await writeFile(new URL('../content/fighter-phase1.json',import.meta.url),`${JSON.stringify(output,null,2)}\n`);
console.log('Created explicit Phase 1 production content (8 abilities, 2 characters).');
