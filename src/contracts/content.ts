import type { ContentSource } from './content-schema.js';

export type ContentCategory = 'characters' | 'abilities' | 'statuses' | 'passives' | 'profiles' | 'pacingProfiles' | 'arenas';
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export interface ContentBundle {
  readonly source: DeepReadonly<ContentSource>;
  readonly bundleHash: string;
  readonly stableIds: Readonly<Record<ContentCategory, Readonly<Record<string,number>>>>;
  readonly pluginVersions: Readonly<Record<string,number>>;
}
