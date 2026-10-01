import { readFile, writeFile } from 'node:fs/promises';
const source = JSON.parse(await readFile(new URL('../content/fighter-phase2.json', import.meta.url), 'utf8'));
const base = source.characters.find(c => c.id === 'standard');
const character = (id, name, ruleText, body, hp, profile, shape, color) => ({
  ...structuredClone(base), id, name, ruleText, body: { ...base.body, ...body }, stats: { maxHp: hp },
  slots: { basic: `${id}-${id === 'iron' ? 'smash' : 'jab'}`, skill1: `${id}-${id === 'iron' ? 'charge' : 'shard'}`, skill2: `${id}-${id === 'iron' ? 'brace' : 'screen'}`, ultimate: `${id}-${id === 'iron' ? 'giant' : 'dome'}` },
  passiveIds: id === 'iron' ? ['speed-impact'] : [], aiProfileId: profile, visual: { shape, color, outlineColor: '#eaf2ff' },
});
source.characters.push(character('iron', '铁球', '冲撞越快越痛，伤害倍率最多 1.75；巨人增加体型与质量', { radius:36,mass:1.6,restitution:.4,moveSpeed:270,jumpSpeed:560 }, 110, 'pressure', 'square', '#91a4be'));
source.characters.push(character('mirror', '镜子', '及时展开屏障可反射飞行物；不抵挡近战，同一弹最多反射两次', { radius:30,mass:.9 }, 95, 'counter', 'triangle', '#a18fff'));
const hit = (damage,x,y,hitGroup,hitstunTicks=10) => ({ damage,launchDeltaV:{x,y},hitGroup,hitstunTicks });
const melee = (damage,x,y,group,duration,stun=10) => ({kind:'hitbox',radius:34,offset:{x:48,y:0},durationTicks:duration,hit:hit(damage,x,y,group,stun)});
const statusFx = statusId => ({kind:'status',statusId,target:'self'});
const ability = (id,tags,s,a,r,cd,movementScale,predictorId,purpose,range,effects) => ({id,version:1,tags,allowedWhen:'both',startupTicks:s,activeTicks:a,recoveryTicks:r,cooldownTicks:cd,energyCost: /giant|dome/.test(id)?100:0,movementScale,conditions:[],timeline:[{offsetTick:s,effects}],ai:{predictorId,preferredCenterDistance:range,purpose}});
source.abilities.push(
  ability('iron-smash',['melee'],13,5,22,40,.25,'melee','damage',[76,104],[melee(11,650,330,'smash',5,14)]),
  ability('iron-charge',['melee','mobility'],18,14,24,210,.25,'dash-hit','damage',[150,260],[{kind:'impulse',deltaV:{x:850,y:0},target:'self',velocityMode:'set-x'},melee(9,800,280,'charge',14)]),
  ability('iron-brace',['defense'],5,1,18,180,.6,'guard','defense',[76,104],[statusFx('brace')]),
  ability('iron-giant',['buff'],16,1,22,300,0,'self-buff','setup',[76,104],[statusFx('giant')]),
  ability('mirror-jab',['melee'],8,4,14,26,.25,'melee','damage',[76,104],[melee(7,480,280,'mirror-jab',4)]),
  ability('mirror-shard',['projectile'],10,1,16,105,.5,'projectile','damage',[220,420],[{kind:'projectile',radius:12,speed:820,lifetimeTicks:90,reflectable:true,hit:hit(9,400,240,'shard')}]),
  ability('mirror-screen',['defense'],6,1,16,150,.6,'reflect','defense',[220,420],[statusFx('screen')]),
  ability('mirror-dome',['defense'],12,1,20,300,.6,'reflect','defense',[220,420],[statusFx('dome')]),
);
const neutral = {damageTakenMultiplier:1,knockbackTakenMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1,massMultiplier:1,bodyScale:1,meleeHitboxScale:1,restitutionOverride:null,wallGrowthCoefficientOverride:null};
const status = (id,durationTicks,modifiers={},reflect=null) => ({id,version:1,durationTicks,stacking:'refresh',maxStacks:1,modifiers:{...neutral,...modifiers},reflect});
source.statuses.push(status('brace',42,{damageTakenMultiplier:.7,knockbackTakenMultiplier:.4,moveSpeedMultiplier:.6}),status('giant',240,{bodyScale:1.35,massMultiplier:1.4,meleeHitboxScale:1.25,moveSpeedMultiplier:.8}),status('screen',18,{}, {extraRadius:14}),status('dome',180,{}, {extraRadius:24}));
source.passives.push({id:'speed-impact',trigger:'damageDealt',internalCooldownTicks:0,conditions:[],effects:[{kind:'plugin',pluginId:'speed-impact',params:{thresholdSpeed:400,speedScale:800,maxBonus:.75}}]});
await writeFile(new URL('../content/fighter-phase3a.json',import.meta.url),`${JSON.stringify(source,null,2)}\n`);
console.log('Created Phase 3A: four characters, sixteen abilities, six statuses.');
