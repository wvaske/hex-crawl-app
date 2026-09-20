import { z } from 'zod';

/**
 * Plugins (see plugins/AGENTS.md). A plugin is a folder under `plugins/` that
 * is compiled into the build; this file is the part of the contract both
 * halves (server actions, client panels) and the core app agree on.
 *
 * Installed is an instance-level fact (the folder exists at build time);
 * ENABLED is per campaign and lives in `campaign.settings.plugins`.
 */

/** Plugin ids are folder names: lowercase, digits and dashes. */
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** One DM-editable setting, rendered generically in Setup → Plugins. */
export interface PluginConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select';
  default: string | number | boolean;
  /** One line under the control. */
  help?: string;
  placeholder?: string;
  /** `select` only. */
  options?: { value: string; label: string }[];
  /** `number` only. */
  min?: number;
  max?: number;
}

/** Rail/tab-bar entry for a panel the plugin contributes. */
export interface PluginPanelMeta {
  /** Unique within the plugin. */
  id: string;
  /** One emoji, shown on the rail. */
  icon: string;
  /** Short rail label (≈8 characters). */
  label: string;
  /** Panel title bar. */
  title: string;
  /** Rail tooltip: what the panel is for. */
  hint: string;
  /** Who gets the panel. Default: both. */
  roles?: ('dm' | 'player')[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Per-campaign settings the DM edits in Setup → Plugins. */
  config?: PluginConfigField[];
  panels?: PluginPanelMeta[];
  /** True when the plugin writes to the wiki — Setup warns until a bot login is stored. */
  usesWiki?: boolean;
}

export function definePluginManifest<const M extends PluginManifest>(manifest: M): M {
  if (!PLUGIN_ID_RE.test(manifest.id)) {
    throw new Error(`Plugin id "${manifest.id}" must match ${PLUGIN_ID_RE}`);
  }
  return manifest;
}

/** Per-campaign plugin state inside `campaign.settings.plugins[pluginId]`. */
export const PluginSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Validated against the manifest's fields server-side; DM-only in snapshots. */
  config: z.record(z.string(), z.unknown()).default({}),
});
export type PluginSettings = z.infer<typeof PluginSettingsSchema>;

/** `ui.openPanel` id of a plugin panel. */
export function pluginPanelId(pluginId: string, panelId: string): `plugin:${string}` {
  return `plugin:${pluginId}/${panelId}`;
}

/**
 * Resolve stored config against a manifest: unknown keys dropped, wrong types
 * and missing keys replaced by the field default, numbers clamped. Pure, so
 * the server uses it to sanitize a DM's patch and to hand plugins a config
 * they can trust, and the client uses it to fill the Setup form.
 */
export function resolvePluginConfig(
  manifest: Pick<PluginManifest, 'config'>,
  stored: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const field of manifest.config ?? []) {
    const raw = stored?.[field.key];
    let value: string | number | boolean = field.default;
    if (field.type === 'boolean') {
      if (typeof raw === 'boolean') value = raw;
    } else if (field.type === 'number') {
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        value = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, raw));
      }
    } else if (field.type === 'select') {
      if (typeof raw === 'string' && field.options?.some((o) => o.value === raw)) value = raw;
    } else if (typeof raw === 'string') {
      value = raw.slice(0, field.type === 'textarea' ? 10_000 : 500);
    }
    out[field.key] = value;
  }
  return out;
}
