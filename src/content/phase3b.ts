import { compilePhase3AContent } from './phase3a.js';
import type { ContentBundle } from '../contracts/content.js';
export const PACING_PROFILE_ID = 'gentle-v1';
export function compilePhase3BContent(input: unknown): ContentBundle {
    const content = compilePhase3AContent(input);
    if (!content.source.pacingProfiles.some(p => p.id === PACING_PROFILE_ID))
        throw new Error('Phase 3B requires a versioned pacing profile');
    return content;
}
export const isPhase3BContent = (content: ContentBundle): boolean => content.source.pacingProfiles.some(p => p.id === PACING_PROFILE_ID);
