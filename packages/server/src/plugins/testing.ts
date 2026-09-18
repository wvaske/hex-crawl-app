import { nanoid } from 'nanoid';
import { CharacterSchema, seededRng, type Character, type ServerMessage } from '@hexcrawl/shared';
import { createTestDb } from '../db/index.js';
import { Store } from '../state/store.js';
import { Hub } from '../ws/hub.js';
import { createApp, seatCookieName } from '../http/app.js';
import type { CampaignRuntime, SeatRecord } from '../state/runtime.js';
import type { ServerPlugin } from './api.js';
import { setInstalledPlugins } from './registry.js';

/**
 * Test bed for a server plugin — import it as `@hexcrawl/server/plugin-testing`
 * from `plugins/<id>/server/*.test.ts`. It stands up a real in-memory campaign
 * and drives the plugin through the same HTTP route the client uses, so auth,
 * the enabled check and input validation are all exercised.
 *
 *   const bed = createPluginTestBed(plugin, { config: { dieSides: 8 } });
 *   const ana = bed.addPlayer('Ana', 'Ser Ana');
 *   const res = await bed.call('roll', { characterId: ana.character.id }, ana.seat);
 *   expect(res.status).toBe(200);
 *
 * The wiki is NOT reachable from tests: stub global `fetch` (see
 * `plugins-host.test.ts` for a MediaWiki stub) or leave the wiki unconfigured
 * and assert the plugin degrades the way it should.
 */
export interface PluginTestBed {
  store: Store;
  runtime: CampaignRuntime;
  dmSeat: SeatRecord;
  /** Messages the hub tried to send (log toasts, `plugin.changed`). */
  sent: ServerMessage[];
  addPlayer(seatName: string, characterName?: string): { seat: SeatRecord; character: Character };
  call<T = unknown>(
    action: string,
    input?: unknown,
    seat?: SeatRecord | null,
  ): Promise<{ status: number; result: T; error: string | null }>;
  /** Any other route of the app, as a seat (DM by default). */
  request(path: string, init?: RequestInit, seat?: SeatRecord | null): Promise<Response>;
  /** Restore the build's plugin registry. Call in `afterEach`. */
  dispose(): void;
}

export function createPluginTestBed(
  plugin: ServerPlugin,
  opts: { enabled?: boolean; config?: Record<string, unknown>; wikiBaseUrl?: string; seed?: number } = {},
): PluginTestBed {
  setInstalledPlugins([plugin]);
  const store = new Store(createTestDb());
  const { runtime, dmSeat } = store.createCampaign('Plugin Test', 'DM');
  runtime.updateCampaign({
    settings: {
      wikiBaseUrl: opts.wikiBaseUrl ?? '',
      plugins: { [plugin.manifest.id]: { enabled: opts.enabled ?? true, config: opts.config ?? {} } },
    },
  });
  const hub = new Hub();
  const sent: ServerMessage[] = [];
  hub.sendTo = (_runtime, message) => void sent.push(message);
  const app = createApp(store, hub, { rng: seededRng(opts.seed ?? 1) });

  return {
    store,
    runtime,
    dmSeat,
    sent,
    addPlayer(seatName, characterName = seatName) {
      const seat = runtime.createSeat('player', seatName);
      const character = CharacterSchema.parse({
        id: nanoid(12),
        name: characterName,
        color: '#c9a227',
        glyph: '★',
        skills: {},
      });
      runtime.upsertCharacter(character);
      runtime.claimCharacter(seat.id, character.id);
      return { seat, character };
    },
    async call<T>(action: string, input?: unknown, seat: SeatRecord | null = dmSeat) {
      const res = await app.request(`/api/campaigns/${runtime.id}/plugins/${plugin.manifest.id}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(seat ? { Cookie: `${seatCookieName(runtime.id)}=${seat.token}` } : {}),
        },
        body: JSON.stringify(input ?? {}),
      });
      const body = (await res.json()) as { result?: T; error?: string };
      return { status: res.status, result: body.result as T, error: body.error ?? null };
    },
    request: async (path, init = {}, seat = dmSeat) =>
      app.request(path, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          ...(seat ? { Cookie: `${seatCookieName(runtime.id)}=${seat.token}` } : {}),
        },
      }),
    dispose: () => setInstalledPlugins(),
  };
}
