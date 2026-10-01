import { RubberWallParamsSchema } from '../contracts/content-schema.js';
import { compileContent } from './compile.js';
import type { ContentBundle } from '../contracts/content.js';
export const FIGHTER_PLUGINS = {
    'rubber-wall-growth': { version: 1, validateParams: (params: Readonly<Record<string, number | string | boolean>>): string | null => {
            const result = RubberWallParamsSchema.safeParse(params);
            return result.success ? null : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        } },
};
export function compileFighterContent(input: unknown): ContentBundle {
    const bundle = compileContent(input, { plugins: FIGHTER_PLUGINS });
    if (bundle.source.purpose !== 'production' || bundle.source.schemaVersion !== 2)
        throw new Error('Fighter requires production content schemaVersion=2');
    for (const ability of bundle.source.abilities)
        for (const entry of ability.timeline)
            for (const effect of entry.effects) {
                if (effect.kind === 'plugin')
                    throw new Error('Phase 1 only supports rubber-wall-growth in passive wallBounce effects');
                if (effect.kind === 'status' && effect.target !== 'self')
                    throw new Error('Phase 1 status timeline target must be self');
                if (effect.kind === 'impulse' && effect.target !== 'self')
                    throw new Error('Phase 1 impulse timeline target must be self');
            }
    for (const passive of bundle.source.passives) {
        if (passive.id !== 'rubber-wall-growth' || passive.trigger !== 'wallBounce' || passive.effects.length !== 1 || passive.effects[0]?.kind !== 'plugin' || passive.effects[0].pluginId !== 'rubber-wall-growth')
            throw new Error('Unimplemented Phase 1 passive mechanism');
        if (passive.conditions.length !== 0 || passive.internalCooldownTicks !== passive.effects[0].params['internalCooldownTicks'])
            throw new Error('Phase 1 rubber passive requires unconditional trigger and matching cooldown');
    }
    if (bundle.source.statuses.some(s => s.reflect !== null))
        throw new Error('Projectile reflection belongs to Phase 3');
    return bundle;
}
