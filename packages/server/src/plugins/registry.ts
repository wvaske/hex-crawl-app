import type { ServerPlugin } from './api.js';
// Written by scripts/plugins.mjs (gitignored): one import per plugins/*/server/index.ts.
import { GENERATED_SERVER_PLUGINS } from './registry.generated.js';

let installed: readonly ServerPlugin[] = GENERATED_SERVER_PLUGINS;

/** Every server plugin compiled into this build. */
export function installedPlugins(): readonly ServerPlugin[] {
  return installed;
}

/** Test hook: swap the installed set (pass nothing to restore the build's). */
export function setInstalledPlugins(plugins?: readonly ServerPlugin[]): void {
  installed = plugins ?? GENERATED_SERVER_PLUGINS;
}
