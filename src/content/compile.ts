import { PREDICTOR_IDS, SLOTS } from '../contracts/versions.js';
import { deepFreeze } from '../math/canonical.js';
import { hashCanonical } from '../math/hash.js';
import { ContentSourceSchema } from './schema.js';
import type { Condition, Effect } from './schema.js';
import type { ContentBundle, ContentCategory } from '../contracts/content.js';
export type { ContentBundle } from '../contracts/content.js';

type Category = ContentCategory;
export interface PluginRegistration {
  readonly version: number;
  readonly validateParams: (params: Readonly<Record<string,number|string|boolean>>) => string | null;
}
export interface CompileOptions {
  readonly predictors?: ReadonlySet<string>;
  readonly plugins?: Readonly<Record<string,PluginRegistration>>;
}

export class ContentValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Content validation failed:\n${issues.map((issue) => `  ${issue}`).join('\n')}`);
    this.name = 'ContentValidationError';
  }
}

export function compileContent(input: unknown, options: CompileOptions = {}): ContentBundle {
  const parsed = ContentSourceSchema.safeParse(input);
  if (!parsed.success) throw new ContentValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`));
  const source = parsed.data;
  const issues: string[] = [];
  const predictors = options.predictors ?? new Set(PREDICTOR_IDS);
  const plugins = options.plugins ?? {};
  const categories: readonly Category[] = ['characters','abilities','statuses','passives','profiles','pacingProfiles','arenas'];
  const indexes = {} as Record<Category, Set<string>>;
  for (const category of categories) {
    const ids = new Set<string>();
    source[category].forEach((definition, index) => {
      if (ids.has(definition.id)) issues.push(`${category}.${index}.id: duplicate ID ${definition.id}`);
      ids.add(definition.id);
    });
    indexes[category] = ids;
  }
  const reference = (category: Category, target: string, path: string): void => {
    if (!indexes[category].has(target)) issues.push(`${path}: unknown ${category} reference ${target}`);
  };
  const conditions = (items: readonly Condition[], path: string): void => {
    items.forEach((condition,i) => { if (condition.kind === 'hasStatus') reference('statuses',condition.statusId,`${path}.${i}.statusId`); });
  };
  const effects = (items: readonly Effect[], path: string): void => {
    items.forEach((effect,i) => {
      if (effect.kind === 'status') reference('statuses',effect.statusId,`${path}.${i}.statusId`);
      if (effect.kind === 'plugin') {
        const registration = plugins[effect.pluginId];
        if (!registration) issues.push(`${path}.${i}.pluginId: unregistered plugin ${effect.pluginId}`);
        else {
          const error = registration.validateParams(effect.params);
          if (error) issues.push(`${path}.${i}.params: ${error}`);
        }
      }
    });
  };
  source.characters.forEach((character,i) => {
    reference('profiles',character.aiProfileId,`characters.${i}.aiProfileId`);
    character.passiveIds.forEach((passive,j) => reference('passives',passive,`characters.${i}.passiveIds.${j}`));
    if (new Set(character.passiveIds).size !== character.passiveIds.length) issues.push(`characters.${i}.passiveIds: duplicate passive reference`);
    for (const slot of SLOTS) {
      reference('abilities',character.slots[slot],`characters.${i}.slots.${slot}`);
      const ability = source.abilities.find((item) => item.id === character.slots[slot]);
      if (ability && ability.energyCost !== (slot === 'ultimate' ? 100 : 0)) issues.push(`characters.${i}.slots.${slot}: ${slot} requires energyCost=${slot === 'ultimate' ? 100 : 0}`);
    }
    source.arenas.forEach((arena,j) => {
      if (character.body.radius * 2 > Math.min(arena.width,arena.height)) issues.push(`characters.${i}.body.radius: does not fit arenas.${j}`);
    });
  });
  source.abilities.forEach((ability,i) => {
    const path = `abilities.${i}`;
    const lifetime = ability.startupTicks + ability.activeTicks + ability.recoveryTicks;
    if (lifetime > 3600 || ability.cooldownTicks < lifetime) issues.push(`${path}.cooldownTicks: must cover S+A+R within 3600 ticks`);
    if (ability.ai.preferredCenterDistance[0] > ability.ai.preferredCenterDistance[1]) issues.push(`${path}.ai.preferredCenterDistance: inverted distance band`);
    if (!predictors.has(ability.ai.predictorId)) issues.push(`${path}.ai.predictorId: unregistered predictor ${ability.ai.predictorId}`);
    conditions(ability.conditions,`${path}.conditions`);
    let previousOffset = -1;
    ability.timeline.forEach((entry,j) => {
      const timelinePath = `${path}.timeline.${j}`;
      if (entry.offsetTick >= lifetime) issues.push(`${timelinePath}.offsetTick: outside cast half-open lifetime [0,${lifetime})`);
      if (entry.offsetTick < previousOffset) issues.push(`${timelinePath}.offsetTick: timeline must be ordered`);
      previousOffset = entry.offsetTick;
      effects(entry.effects,`${timelinePath}.effects`);
      entry.effects.forEach((effect,k) => {
        if (effect.kind === 'hitbox' && (entry.offsetTick < ability.startupTicks || entry.offsetTick + effect.durationTicks > ability.startupTicks + ability.activeTicks)) {
          issues.push(`${timelinePath}.effects.${k}.durationTicks: hitbox must remain within active interval`);
        }
      });
    });
  });
  source.passives.forEach((passive,i) => {
    conditions(passive.conditions,`passives.${i}.conditions`);
    effects(passive.effects,`passives.${i}.effects`);
  });
  source.statuses.forEach((status,i) => {
    if (status.stacking !== 'stack' && status.maxStacks !== 1) issues.push(`statuses.${i}.maxStacks: refresh/replace requires maxStacks=1`);
  });
  source.pacingProfiles.forEach((profile,i) => {
    if (profile.rampTicks * 2 > profile.cueDurationTicks) issues.push(`pacingProfiles.${i}.rampTicks: two ramps exceed cue duration`);
  });
  source.arenas.forEach((arena,i) => arena.spawnPositions.forEach((position,j) => {
    if (position.x < 0 || position.x > arena.width || position.y < 0 || position.y > arena.height) issues.push(`arenas.${i}.spawnPositions.${j}: outside arena`);
  }));
  if (issues.length) throw new ContentValidationError(issues);

  // 规范化定义顺序；同一 timeline 内的效果顺序仍保留业务语义。
  for (const category of categories) source[category].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const stableIds = {} as Record<Category,Record<string,number>>;
  for (const category of categories) stableIds[category] = Object.fromEntries(source[category].map((item,i) => [item.id,i+1]));
  const pluginVersions = Object.fromEntries(Object.entries(plugins).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([name,registration]) => [name,registration.version]));
  const bundleHash = hashCanonical({ source,stableIds,pluginVersions });
  return deepFreeze({ source,stableIds,pluginVersions,bundleHash });
}
