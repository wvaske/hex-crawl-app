import type { PluginManifest } from '@hexcrawl/shared';
import type { ClientPlugin } from './api.js';
// Written by scripts/plugins.mjs (gitignored): one import per plugins/*/client/index.tsx.
import { GENERATED_CLIENT_PLUGINS } from './registry.generated.js';

/** Every client plugin compiled into this build. Enabled-ness is per campaign. */
export const CLIENT_PLUGINS: readonly ClientPlugin[] = GENERATED_CLIENT_PLUGINS;

export function findClientPlugin(pluginId: string): ClientPlugin | undefined {
  return CLIENT_PLUGINS.find((p) => p.manifest.id === pluginId);
}

export function pluginManifests(): PluginManifest[] {
  return CLIENT_PLUGINS.map((p) => p.manifest);
}
