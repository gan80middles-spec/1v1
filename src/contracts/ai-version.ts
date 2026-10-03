import type { ContentBundle, DeepReadonly } from './content.js';
import type { AIProfile } from './content-schema.js';
import { AI_VERSION, PHASE3A_AI_VERSION, PHASE3B_AI_VERSION, CALIBRATED_AI_VERSION, WINDOW_AI_VERSION } from './ai.js';

/** The profile/content snapshot, rather than the physics build, identifies the controller. */
export function utilityVersion(content: Pick<ContentBundle, 'source' | 'pluginVersions'>, profiles: readonly DeepReadonly<AIProfile>[] = content.source.profiles) {
    return profiles.some(p => p.predictionModel === 'window-v1') ? WINDOW_AI_VERSION :
        profiles.some(p => p.predictionModel === 'causal-v1') ? CALIBRATED_AI_VERSION :
        content.source.pacingProfiles.some(p => p.id === 'gentle-v1') ? PHASE3B_AI_VERSION :
        content.pluginVersions['speed-impact'] === 1 ? PHASE3A_AI_VERSION : AI_VERSION;
}
