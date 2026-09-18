import type { z } from 'zod';
import type { Campaign, Character, LogEntry, PluginManifest, Rng } from '@hexcrawl/shared';
import type { CampaignRuntime, SeatRecord } from '../state/runtime.js';
import type { Hub } from '../ws/hub.js';
import type { WikiEditOptions, WikiEditResult, WikiBotStatus } from '../engine/wikiBot.js';

/**
 * The server half of the plugin contract — import it as
 * `@hexcrawl/server/plugin-api`. Authoring guide: plugins/AGENTS.md.
 *
 * A server plugin is a set of named ACTIONS. The host mounts each one at
 * `POST /api/campaigns/:id/plugins/<pluginId>/<action>`, and before the handler
 * runs it has already: found the campaign, required a seat, checked the plugin
 * is enabled for this campaign, enforced `dmOnly`, and parsed the JSON body
 * with the action's `input` schema. The handler gets a {@link PluginContext}
 * and returns a JSON-serializable value.
 */

/** Thrown by a handler to answer with a clean error message (default 400). */
export class PluginError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 502 = 400,
  ) {
    super(message);
  }
}

/**
 * Per-campaign, per-plugin key/value storage (JSON values). Held in memory and
 * written through to the database, so reads are synchronous and cheap. Keys
 * are yours to structure — `char:<characterId>`, `letter:<id>` — and `list`
 * takes a prefix.
 */
export interface PluginStorage {
  get<T = unknown>(key: string): T | undefined;
  /** `undefined` deletes. */
  set(key: string, value: unknown): void;
  delete(key: string): void;
  /** Sorted keys under a prefix. */
  list(prefix?: string): string[];
  /** Every `[key, value]` under a prefix, sorted by key. */
  entries<T = unknown>(prefix?: string): [string, T][];
}

/**
 * The campaign's wiki, via the DM's stored bot login. Every method throws a
 * {@link PluginError} with a readable message when the wiki is not configured
 * or rejects the edit — let it propagate unless the wiki write is optional, in
 * which case check `status().canWrite` first or catch and carry on.
 */
export interface PluginWiki {
  status(): WikiBotStatus;
  /** Raw wikitext, or null when the page does not exist. */
  read(title: string): Promise<string | null>;
  /** Replace the whole page (creating it if missing). */
  write(title: string, wikitext: string, opts?: WikiEditOptions): Promise<WikiEditResult>;
  /** Add to the end of a page (creating it if missing). Writes are serialized per campaign. */
  append(title: string, wikitext: string, opts?: WikiEditOptions): Promise<WikiEditResult>;
  /** Human-facing URL of a page title. */
  url(title: string): string;
}

export interface PluginLogOptions {
  /**
   * Log `kind`. Defaults to `plugin`. Use `check` only if the entry should
   * obey the campaign's roll-visibility setting like a skill roll.
   */
  kind?: string;
  /** `all` (default), `dm`, or one seat id. */
  visibility?: 'all' | 'dm' | (string & {});
  /** Free-form; `plugin: <id>` is always added. */
  data?: Record<string, unknown>;
  /** Also pop a toast for everyone who can see the entry. Default false. */
  toast?: boolean;
}

export interface PluginContext<Config = Record<string, string | number | boolean>> {
  campaign: Campaign;
  seat: Pick<SeatRecord, 'id' | 'role' | 'name' | 'characterId'>;
  isDm: boolean;
  /** The character this seat has claimed, if any. */
  character: Character | null;
  characters: Character[];
  /** This campaign's plugin settings, resolved against the manifest's defaults. */
  config: Config;
  storage: PluginStorage;
  wiki: PluginWiki;
  /** The server's seeded RNG: `rng()` → [0, 1). */
  rng: Rng;
  /** Roll `count` dice of `sides`; returns each die. */
  rollDice(count: number, sides: number): number[];
  /** The in-game date and time as the party sees it ("3 Mirtul 1491, 14:20" or "Day 12, 14:20"). */
  gameDate(): string;
  /** Write to the game log (History → Log) and sync every client. */
  log(text: string, opts?: PluginLogOptions): LogEntry;
  /**
   * Tell connected clients this plugin's data changed, so panels using
   * `usePluginQuery` refetch. Default audience: everyone in the campaign.
   */
  notify(topic?: string, audience?: { seatIds?: string[]; dm?: boolean }): void;
  /**
   * Throw unless the viewer is the DM or has claimed `characterId` — the
   * ownership rule every per-character action wants.
   */
  requireCharacterAccess(characterId: string): Character;
  /** Escape hatches into the core. Prefer the curated surface above. */
  runtime: CampaignRuntime;
  hub: Hub;
}

export interface PluginAction {
  /** Zod schema for the JSON body. Omit for actions without input. */
  input?: z.ZodType;
  /** Reject non-DM seats with 403 before the handler runs. */
  dmOnly?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler(ctx: PluginContext<any>, input: any): unknown | Promise<unknown>;
}

export interface ServerPlugin {
  manifest: PluginManifest;
  actions: Record<string, PluginAction>;
}

type DefaultConfig = Record<string, string | number | boolean>;

/**
 * The typed way to write actions. Bind your config shape once, then each
 * action's `input` type is inferred from its zod schema:
 *
 *   const action = actionsFor<{ poolSize: number }>();
 *   roll: action({ input: z.object({ characterId: z.string() }), handler: (ctx, input) => … })
 */
export function actionsFor<Config = DefaultConfig>() {
  function action<S extends z.ZodType>(def: {
    input: S;
    dmOnly?: boolean;
    handler(ctx: PluginContext<Config>, input: z.output<S>): unknown | Promise<unknown>;
  }): PluginAction;
  function action(def: {
    dmOnly?: boolean;
    handler(ctx: PluginContext<Config>): unknown | Promise<unknown>;
  }): PluginAction;
  function action(def: PluginAction): PluginAction {
    return def;
  }
  return action;
}

/**
 * Make player-typed text inert inside wikitext: no templates, links, markup or
 * HTML survive. Use it for every free-text field you splice into a page —
 * `{{Infobox|name=${wikiEscape(name)}}}`. Newlines are kept.
 */
export function wikiEscape(text: string): string {
  return `<nowiki>${text.replace(/<(\/?)nowiki/gi, '&lt;$1nowiki')}</nowiki>`;
}

/** A string safe to use inside a wiki page TITLE (illegal characters dropped, length capped). */
export function wikiTitlePart(text: string, maxLength = 80): string {
  return text
    .replace(/[#<>[\]{}|\n\r\t_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export function defineServerPlugin(plugin: ServerPlugin): ServerPlugin {
  for (const name of Object.keys(plugin.actions)) {
    if (!/^[a-zA-Z][a-zA-Z0-9-]{0,39}$/.test(name)) {
      throw new Error(`Plugin ${plugin.manifest.id}: action name "${name}" must be alphanumeric/dashes`);
    }
  }
  return plugin;
}

export type { WikiEditOptions, WikiEditResult, WikiBotStatus };
