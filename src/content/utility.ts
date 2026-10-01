import { compileFighterContent } from './fighter.js';
import type { ContentBundle } from '../contracts/content.js';
export function compileUtilityContent(input: unknown): ContentBundle {
    const content = compileFighterContent(input);
    if (content.source.abilities.some(a => a.ai.predictorId === 'reflect'))
        throw new Error('Reflect predictor belongs to Phase 3');
    return content;
}
