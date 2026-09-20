import type { Hono } from 'hono';
import { formatCalendarClock, resolvePluginConfig, type Rng } from '@hexcrawl/shared';
import type { CampaignRuntime, CampaignSettingsPatch, SeatRecord } from '../state/runtime.js';
import type { Hub } from '../ws/hub.js';
import { WikiError, editWikiPage, readWikiText, wikiBotStatus, wikiPageUrl } from '../engine/wikiBot.js';
import { PluginError, type PluginContext, type PluginStorage, type PluginWiki, type ServerPlugin } from './api.js';

/**
 * Mounts server plugins (plugins/AGENTS.md) on the HTTP app and builds the
 * context their actions run with. The list of plugins is whatever
 * `registry.generated.ts` imported at build time; tests pass their own.
 */

/** Largest JSON body an action accepts. Letters are long; images are not welcome. */
const MAX_ACTION_BODY_BYTES = 256 * 1024;

function wikiFailure(err: unknown): never {
  if (err instanceof WikiError) {
    throw new PluginError(err.message, err.code === 'unconfigured' || err.code === 'badtitle' ? 400 : 502);
  }
  throw err;
}

export function pluginStorage(runtime: CampaignRuntime, pluginId: string): PluginStorage {
  return {
    get: <T>(key: string) => runtime.getPluginData(pluginId, key) as T | undefined,
    set: (key, value) => runtime.setPluginData(pluginId, key, value),
    delete: (key) => runtime.setPluginData(pluginId, key, undefined),
    list: (prefix) => runtime.listPluginData(pluginId, prefix),
    entries: <T>(prefix?: string) =>
      runtime
        .listPluginData(pluginId, prefix)
        .map((key) => [key, runtime.getPluginData(pluginId, key) as T] as [string, T]),
  };
}

function pluginWiki(runtime: CampaignRuntime): PluginWiki {
  return {
    status: () => wikiBotStatus(runtime),
    read: (title) => readWikiText(runtime, title).catch(wikiFailure),
    write: (title, text, opts) => editWikiPage(runtime, title, text, 'replace', opts).catch(wikiFailure),
    append: (title, text, opts) => editWikiPage(runtime, title, text, 'append', opts).catch(wikiFailure),
    url: (title) => wikiPageUrl(runtime.campaign.settings.wikiBaseUrl, title),
  };
}

export function buildPluginContext(
  plugin: ServerPlugin,
  runtime: CampaignRuntime,
  seat: SeatRecord,
  hub: Hub,
  rng: Rng,
): PluginContext {
  const pluginId = plugin.manifest.id;
  const isDm = seat.role === 'dm';
  return {
    campaign: runtime.campaign,
    seat: { id: seat.id, role: seat.role, name: seat.name, characterId: seat.characterId },
    isDm,
    character: seat.characterId ? (runtime.characters.get(seat.characterId) ?? null) : null,
    characters: [...runtime.characters.values()],
    config: resolvePluginConfig(plugin.manifest, runtime.campaign.settings.plugins[pluginId]?.config),
    storage: pluginStorage(runtime, pluginId),
    wiki: pluginWiki(runtime),
    rng,
    rollDice: (count, sides) => {
      const n = Math.min(100, Math.max(0, Math.floor(count)));
      const s = Math.max(1, Math.floor(sides));
      return Array.from({ length: n }, () => 1 + Math.floor(rng() * s));
    },
    gameDate: () =>
      formatCalendarClock(runtime.campaign.time.minutes, runtime.campaign.settings.calendar),
    log: (text, opts = {}) => {
      const visibility = opts.visibility ?? 'all';
      const entry = runtime.appendLog(opts.kind ?? 'plugin', text.slice(0, 2000), visibility, {
        ...opts.data,
        plugin: pluginId,
        pluginName: plugin.manifest.name,
        ...(opts.toast ? { toast: true } : {}),
      });
      hub.sendTo(
        runtime,
        { type: 'event', kind: 'log.appended', entry },
        visibility === 'all' ? { all: true } : visibility === 'dm' ? { dm: true } : { dm: true, seatIds: [visibility] },
      );
      hub.scheduleSync(runtime);
      return entry;
    },
    notify: (topic = '', audience) => {
      hub.sendTo(
        runtime,
        { type: 'event', kind: 'plugin.changed', pluginId, topic },
        audience ?? { all: true },
      );
    },
    requireCharacterAccess: (characterId) => {
      const character = runtime.characters.get(characterId);
      if (!character) throw new PluginError('Character not found', 404);
      if (!isDm && seat.characterId !== characterId) {
        throw new PluginError('That is not your character', 403);
      }
      return character;
    },
    runtime,
    hub,
  };
}

/**
 * Sanitize the `plugins` part of a `campaign.update` patch: unknown plugin ids
 * are dropped, and `config` is resolved against the manifest (unknown keys
 * out, wrong types back to defaults) so what lands in the settings blob is
 * always something the plugin can trust.
 */
export function sanitizePluginSettingsPatch(
  plugins: readonly ServerPlugin[],
  patch: NonNullable<CampaignSettingsPatch['plugins']>,
): NonNullable<CampaignSettingsPatch['plugins']> {
  const out: NonNullable<CampaignSettingsPatch['plugins']> = {};
  for (const [id, p] of Object.entries(patch)) {
    const plugin = plugins.find((pl) => pl.manifest.id === id);
    if (!plugin) continue;
    out[id] = {
      ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
      ...(p.config ? { config: resolvePluginConfig(plugin.manifest, p.config) } : {}),
    };
  }
  return out;
}

export interface PluginHostDeps {
  getRuntime(campaignId: string): CampaignRuntime | null | undefined;
  getSeat(c: { req: { raw: Request } }, runtime: CampaignRuntime): SeatRecord | null;
  hub: Hub;
  rng: Rng;
}

export function mountPlugins(app: Hono, plugins: readonly ServerPlugin[], deps: PluginHostDeps): void {
  const byId = new Map<string, ServerPlugin>();
  for (const plugin of plugins) {
    if (byId.has(plugin.manifest.id)) throw new Error(`Duplicate plugin id "${plugin.manifest.id}"`);
    byId.set(plugin.manifest.id, plugin);
  }

  /** What is installed on this instance — the DM's Setup list reads manifests client-side, this is for tooling. */
  app.get('/api/plugins', (c) =>
    c.json({
      plugins: plugins.map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        actions: Object.keys(p.actions),
      })),
    }),
  );

  app.post('/api/campaigns/:id/plugins/:pluginId/:action', async (c) => {
    const runtime = deps.getRuntime(c.req.param('id') ?? '');
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const seat = deps.getSeat(c, runtime);
    if (!seat) return c.json({ error: 'No seat' }, 401);
    const plugin = byId.get(c.req.param('pluginId') ?? '');
    const actionName = c.req.param('action') ?? '';
    const action = plugin && Object.hasOwn(plugin.actions, actionName) ? plugin.actions[actionName] : undefined;
    if (!plugin || !action) return c.json({ error: 'Unknown plugin action' }, 404);
    if (!runtime.campaign.settings.plugins[plugin.manifest.id]?.enabled) {
      return c.json({ error: `${plugin.manifest.name} is not enabled for this campaign` }, 403);
    }
    if (action.dmOnly && seat.role !== 'dm') return c.json({ error: 'DM only' }, 403);

    const raw = await c.req.text();
    if (raw.length > MAX_ACTION_BODY_BYTES) return c.json({ error: 'Request too large' }, 413);
    let input: unknown;
    if (action.input) {
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return c.json({ error: 'Malformed JSON' }, 400);
      }
      const parsed = action.input.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
        return c.json({ error: `Invalid input — ${where}${issue?.message ?? 'rejected'}` }, 400);
      }
      input = parsed.data;
    }

    try {
      const result = await action.handler(buildPluginContext(plugin, runtime, seat, deps.hub, deps.rng), input);
      return c.json({ result: result ?? null });
    } catch (err) {
      if (err instanceof PluginError) return c.json({ error: err.message }, err.status);
      console.error(`[plugin ${plugin.manifest.id}] ${actionName} failed:`, err);
      return c.json({ error: `${plugin.manifest.name}: ${err instanceof Error ? err.message : 'action failed'}` }, 500);
    }
  });
}
