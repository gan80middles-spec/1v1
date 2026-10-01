import { SpeedImpactParamsSchema } from '../contracts/content-schema.js';
import { compileFighterContent, FIGHTER_PLUGINS } from './fighter.js';
import type { ContentBundle } from '../contracts/content.js';
export const PHASE3A_PLUGINS={...FIGHTER_PLUGINS,'speed-impact':{version:1,validateParams:(input:Readonly<Record<string,number|string|boolean>>):string|null=>{const r=SpeedImpactParamsSchema.safeParse(input);return r.success?null:r.error.message;}},'reflect-projectile':{version:1,validateParams:():string|null=>null}};
export function compilePhase3AContent(input:unknown):ContentBundle {return compileFighterContent(input,PHASE3A_PLUGINS);}
export const isPhase3AContent=(content:ContentBundle):boolean=>content.pluginVersions['speed-impact']===1&&content.pluginVersions['reflect-projectile']===1;
