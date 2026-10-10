import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientCommandSchema, ContentSchema, ServerMessageSchema, filterStateForViewer, seededRng } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { createApp, seatCookieName } from './http/app.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { evaluateKnowledge } from './engine/knowledge.js';
import { deliverDiscoveries } from './engine/deliver.js';

let store: Store;
let campaign: ReturnType<Store['createCampaign']>;
let other: ReturnType<Store['createCampaign']>;
let hub: Hub;
let app: ReturnType<typeof createApp>;
let sequence = 0;

beforeEach(() => {
  store = new Store(createTestDb());
  campaign = store.createCampaign('Private title', 'DM');
  other = store.createCampaign('Other', 'Other DM');
  hub = new Hub();
  app = createApp(store, hub);
});

afterEach(() => store.db.close());

describe('campaign metadata isolation (#164)', () => {
  it('requires a campaign-scoped seat or valid invite before returning names and characters', async () => {
    const url = `/api/campaigns/${campaign.runtime.id}`;
    for (const headers of [
      {}, { Cookie: `${seatCookieName(other.runtime.id)}=${other.dmSeat.token}` },
      { Cookie: `${seatCookieName(campaign.runtime.id)}=${other.dmSeat.token}` },
    ] as Record<string, string>[]) {
      const res = await app.request(url, { headers });
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('Private title');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
    expect((await app.request(`${url}?key=${other.runtime.playerSecret}`)).status).toBe(403);
    for (const key of [campaign.runtime.playerSecret, campaign.runtime.dmSecret]) {
      const res = await app.request(`${url}?key=${key}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ name: 'Private title' });
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
    const player = campaign.runtime.createSeat('player', 'Player');
    expect((await app.request(url, { headers: { Cookie: `${seatCookieName(campaign.runtime.id)}=${player.token}` } })).status).toBe(200);
    campaign.runtime.deleteSeat(player.id);
    expect((await app.request(url, { headers: { Cookie: `${seatCookieName(campaign.runtime.id)}=${player.token}` } })).status).toBe(403);
  });

  it('rate limits the invite-key oracle with the same budget as joining', async () => {
    app = createApp(store, hub, { rateLimits: { join: { limit: 2, windowMs: 60_000 } } });
    const url = `/api/campaigns/${campaign.runtime.id}`;
    expect((await app.request(`${url}?key=wrong`)).status).toBe(403);
    expect((await app.request(`${url}?key=wrong`)).status).toBe(403);
    expect((await app.request(`${url}?key=wrong`)).status).toBe(429);
    expect((await app.request(`${url}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: campaign.runtime.playerSecret, name: 'Player' }) })).status).toBe(429);
    // A full party sharing a NAT must still enter/reload their table after
    // anonymous attempts have exhausted that IP's invitation budget.
    const player = campaign.runtime.createSeat('player', 'Seated player');
    for (let i = 0; i < 12; i++) {
      for (const seat of [player, campaign.dmSeat]) {
        expect((await app.request(url, {
          headers: { Cookie: `${seatCookieName(campaign.runtime.id)}=${seat.token}` },
        })).status).toBe(200);
      }
    }
    expect((await app.request(`${url}?key=wrong`)).status).toBe(429);
  });

  it.each([false, true])('filters raw passive geometry from snapshots and events (distance toggle %s)', (disclosed) => {
    const runtime = campaign.runtime;
    const mapId = runtime.campaign.activeMapId!;
    const dispatch = (command: Record<string, unknown>) => dispatchCommand(
      ClientCommandSchema.parse({ ...command, id: `privacy-${sequence++}` }),
      { runtime, seat: campaign.dmSeat, hub, rng: seededRng(1) },
    );
    dispatch({ kind: 'character.create', character: { name: 'Scout', color: '#00aa00', glyph: 'S', skills: {} } });
    const characterId = [...runtime.characters.keys()][0]!;
    const player = runtime.createSeat('player', 'Player');
    runtime.claimCharacter(player.id, characterId);
    dispatch({ kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'pc', characterId });
    runtime.upsertContent(ContentSchema.parse({ id: 'secret', mapId, q: 2, r: 0, title: 'Secret lair', type: 'lair',
      clues: [{ id: 'clue', contentId: 'secret', text: 'Smoke', indicatesDistance: disclosed, revealsLocation: false,
        gate: { kind: 'skill', skill: 'perception', dc: 1, maxDistance: 3, mode: 'passive' } }],
    }));
    const sent = vi.spyOn(hub, 'sendTo');
    deliverDiscoveries(runtime, hub, evaluateKnowledge(runtime, mapId));
    const full = runtime.buildFullState(mapId);
    const snapshot = filterStateForViewer(full, { seatId: player.id, role: 'player', characterId });
    expect(full.discoveries[0]?.how).toMatchObject({ kind: 'passive', distance: 2 });
    expect(snapshot.discoveries[0]?.how).not.toHaveProperty('distance');
    expect(snapshot.discoveries[0]?.distance).toBe(disclosed ? 2 : null);
    expect(snapshot.mapState?.contents).toEqual([]);
    expect(ServerMessageSchema.safeParse({ type: 'snapshot', seatId: player.id, role: 'player', state: snapshot }).success).toBe(true);
    const playerEvent = sent.mock.calls.find(([, , opts]) => opts.seatIds?.includes(player.id))![1];
    expect(playerEvent).toMatchObject({ kind: 'discovery.new', contentTitle: '', discovery: { distance: disclosed ? 2 : null } });
    expect(JSON.stringify(playerEvent)).not.toContain('Secret lair');
    if (playerEvent.type === 'event' && playerEvent.kind === 'discovery.new') {
      expect(playerEvent.discovery.how).not.toHaveProperty('distance');
    }
    expect(ServerMessageSchema.safeParse(playerEvent).success).toBe(true);
    const dmEvent = sent.mock.calls.find(([, , opts]) => opts.dm)![1];
    expect(dmEvent).toMatchObject({ contentTitle: 'Secret lair', discovery: { how: { distance: 2 } } });
  });
});
