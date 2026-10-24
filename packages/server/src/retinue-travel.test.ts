import { beforeEach, describe, expect, it } from 'vitest';
import { filterStateForViewer, seededRng, travelWindowMinutes } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Retinue markers: NPC tokens that belong to a faction cell, wear its crest,
 * and travel along a planned route on the campaign clock — the party's moves
 * are the tick that carries them.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `r${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}
function dm(cmd: Omit<ClientCommand, 'id'>): void {
  asSeat(dmSeat, cmd);
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Retinues', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
  // 6-mile hexes, no fog surprises; the NPC walks the straight line.
  const mapId = runtime.campaign.activeMapId!;
  dm({ kind: 'map.update', mapId, patch: { fogMode: 'manual', sightRadius: 0, milesPerHex: 6, routeExplored: false } } as never);
  dm({
    kind: 'campaign.update',
    settings: {
      npcTravelHoursPerDay: 24,
      retinues: [
        { id: 'anvil', name: 'The Anvil', holder: 'Xanphina', faction: 'Order of the Gauntlet', color: '#b3b3b3', icon: 'objects/anvil', glyph: '⚒', mph: 6, wikiPage: 'The Anvil' },
      ],
    },
  } as never);
});

function party(): { mapId: string; tokenId: string } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: { name: 'Scout', color: '#00aa00', glyph: '', speed: 30, skills: {}, extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' } },
  } as never);
  const charId = [...runtime.characters.keys()][0]!;
  dm({ kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'pc', characterId: charId, label: '', color: '#00aa00', glyph: '', playerVisible: true } as never);
  const tokenId = [...runtime.requireMap(mapId).tokens.values()].find((t) => t.kind === 'pc')!.id;
  return { mapId, tokenId };
}

function rider(): { mapId: string; tokenId: string } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'token.create',
    mapId,
    q: 10,
    r: 0,
    tokenKind: 'npc',
    characterId: null,
    label: 'Dorn Ackley',
    color: '#b3b3b3',
    glyph: '',
    playerVisible: true,
    retinueId: 'anvil',
    visibleThroughFog: true,
    note: 'Hold Boareskyr Bridge',
  } as never);
  const tokenId = [...runtime.requireMap(mapId).tokens.values()].find((t) => t.kind === 'npc')!.id;
  return { mapId, tokenId };
}

describe('travel window', () => {
  it('counts only the hours after sunrise, per day', () => {
    const s = { sunriseHour: 6, npcTravelHoursPerDay: 8 };
    // 6:00 → 14:00 on day 1 is the whole window.
    expect(travelWindowMinutes(6 * 60, 14 * 60, s)).toBe(480);
    // A night camp from 20:00 to 6:00 banks nothing.
    expect(travelWindowMinutes(20 * 60, 30 * 60, s)).toBe(0);
    // 12:00 day 1 → 12:00 day 2: two hours left today, six tomorrow.
    expect(travelWindowMinutes(12 * 60, 36 * 60, s)).toBe(8 * 60);
    expect(travelWindowMinutes(0, 1440 * 3, { ...s, npcTravelHoursPerDay: 24 })).toBe(1440 * 3);
    expect(travelWindowMinutes(100, 50, s)).toBe(0);
  });
});

describe('retinue tokens', () => {
  it('inherit the crest from their retinue and are stored with the new fields', () => {
    const { mapId, tokenId } = rider();
    const t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect(t.retinueId).toBe('anvil');
    expect(t.icon).toBe('objects/anvil');
    expect(t.glyph).toBe('⚒');
    expect(t.visibleThroughFog).toBe(true);
    expect(t.note).toBe('Hold Boareskyr Bridge');
    expect(t.route).toEqual([]);
    // Reload from the database: every field round-trips.
    const reloaded = store.getCampaign(runtime.id)!;
    const again = reloaded.requireMap(mapId).tokens.get(tokenId)!;
    expect(again.icon).toBe('objects/anvil');
    expect(again.visibleThroughFog).toBe(true);
  });

  it('players see a retinue member through fog but never its orders or route', () => {
    party();
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    const player = runtime.createSeat('player', 'Alice');
    const full = runtime.buildFullState(mapId);
    const view = filterStateForViewer(full, { role: 'player', seatId: player.id, characterId: null });
    const seen = view.mapState!.tokens.find((t) => t.id === tokenId)!;
    expect(seen).toBeDefined(); // hex 10,0 is hidden fog, yet the rider shows
    expect(seen.note).toBe('');
    expect(seen.route).toEqual([]);
    expect(seen.travelCredit).toBe(0);
    // An ordinary NPC on hidden ground stays hidden.
    dm({ kind: 'token.create', mapId, q: 11, r: 0, tokenKind: 'npc', characterId: null, label: 'Ogre', color: '#ff0000', glyph: '', playerVisible: true } as never);
    const view2 = filterStateForViewer(runtime.buildFullState(mapId), { role: 'player', seatId: player.id, characterId: null });
    expect(view2.mapState!.tokens.some((t) => t.label === 'Ogre')).toBe(false);
  });
});

describe('routed travel on the player tick', () => {
  it('plans a route and walks it as the party moves', () => {
    const { tokenId: pc } = party();
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    let rt = runtime.requireMap(mapId);
    expect(rt.tokens.get(tokenId)!.route).toEqual([
      { q: 11, r: 0 },
      { q: 12, r: 0 },
      { q: 13, r: 0 },
    ]);
    // Party on foot (3 mph, 6-mile hexes): one hex = 2 hours. The rider
    // (6 mph) covers two hexes in that time.
    dm({ kind: 'token.move', tokenId: pc, q: 1, r: 0, teleport: false } as never);
    rt = runtime.requireMap(mapId);
    const t = rt.tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([12, 0]);
    expect(t.route).toEqual([{ q: 13, r: 0 }]);
    expect(t.travelCredit).toBe(0);
    // Second step: arrives, route cleared, arrival logged for the DM.
    dm({ kind: 'token.move', tokenId: pc, q: 2, r: 0, teleport: false } as never);
    const done = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([done.q, done.r]).toEqual([13, 0]);
    expect(done.route).toEqual([]);
    const arrival = runtime.log.find((e) => e.kind === 'travel' && e.text.includes('arrives'));
    expect(arrival).toBeDefined();
    expect(arrival!.visibility).toBe('dm');
  });

  it('banks partial progress and stands still outside the travel window', () => {
    const { tokenId: pc } = party();
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.update', tokenId, patch: { mph: 1.5 } } as never); // 4 hours per hex
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 12, r: 0 }] } as never);
    dm({ kind: 'token.move', tokenId: pc, q: 1, r: 0, teleport: false } as never); // +2h
    let t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([10, 0]);
    expect(t.travelCredit).toBe(120);
    dm({ kind: 'token.move', tokenId: pc, q: 2, r: 0, teleport: false } as never); // +2h → one hex
    t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([11, 0]);
    expect(t.travelCredit).toBe(0);
    // Night: an 8-hour window from sunrise 6:00; the clock is at 12:00 day 1
    // so only 2 of the next 10 hours count — half a hex, banked.
    dm({ kind: 'campaign.update', settings: { npcTravelHoursPerDay: 8 } } as never);
    dm({ kind: 'time.advance', minutes: 600 } as never);
    t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([11, 0]);
    expect(t.travelCredit).toBe(120);
  });

  it('undoing the party move puts the traveller back too', () => {
    const { tokenId: pc } = party();
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    dm({ kind: 'token.move', tokenId: pc, q: 1, r: 0, teleport: false } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.q).toBe(12);
    dm({ kind: 'undo' } as never);
    const t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([10, 0]);
    expect(t.route).toHaveLength(3);
    expect(runtime.log.some((e) => e.text.includes('travels on'))).toBe(false);
  });

  it('time.advance moves travellers and is undoable with the clock', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 12, r: 0 }] } as never);
    const before = runtime.campaign.time.minutes;
    dm({ kind: 'time.advance', minutes: 180 } as never); // 3h at 6 mph = 3 hexes' worth; route is 2
    let t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([12, 0]);
    expect(t.route).toEqual([]);
    dm({ kind: 'undo' } as never);
    t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([10, 0]);
    expect(t.route).toHaveLength(2);
    expect(runtime.campaign.time.minutes).toBe(before);
  });

  it('dragging a routed token abandons its journey; empty waypoints cancel it', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    dm({ kind: 'token.move', tokenId, q: 5, r: 5, teleport: true } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.route).toEqual([]);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 7, r: 5 }] } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.route).toHaveLength(2);
    dm({ kind: 'token.route', tokenId, waypoints: [] } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.route).toEqual([]);
  });

  it('players cannot route tokens', () => {
    const { tokenId } = rider();
    const player = runtime.createSeat('player', 'Alice');
    expect(() => asSeat(player, { kind: 'token.route', tokenId, waypoints: [{ q: 1, r: 1 }] } as never)).toThrow();
  });
});

describe('integration API tokens', () => {
  it('upserts a retinue member by label, placing it on named content and routing by titles', async () => {
    const { createApp } = await import('./http/app.js');
    const app = createApp(store, hub);
    const mapId = runtime.campaign.activeMapId!;
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runtime.dmSecret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    await post(`/api/integration/campaigns/${runtime.id}/content`, { mapId, title: 'Nuts Deep', q: 0, r: 0, type: 'settlement' });
    await post(`/api/integration/campaigns/${runtime.id}/content`, { mapId, title: 'Boareskyr Bridge', q: 4, r: 0, type: 'settlement' });
    const res = await post(`/api/integration/campaigns/${runtime.id}/tokens`, {
      mapId,
      label: 'Yavena Storr',
      at: 'Nuts Deep',
      retinueId: 'anvil',
      note: 'Hold Boareskyr Bridge',
      routeTo: ['Boareskyr Bridge'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokenId: string; routeHexes: number; updated: boolean };
    expect(body.updated).toBe(false);
    expect(body.routeHexes).toBe(4);
    const t = runtime.requireMap(mapId).tokens.get(body.tokenId)!;
    expect(t.color).toBe('#b3b3b3'); // the retinue's
    expect(t.icon).toBe('objects/anvil');
    expect(t.visibleThroughFog).toBe(true);
    // Second call with the same label updates in place and keeps the route.
    const again = await post(`/api/integration/campaigns/${runtime.id}/tokens`, { mapId, label: 'yavena storr', note: 'Hold the bridge' });
    expect(((await again.json()) as { updated: boolean }).updated).toBe(true);
    expect(runtime.requireMap(mapId).tokens.size).toBe(1);
    expect(runtime.requireMap(mapId).tokens.get(body.tokenId)!.route).toHaveLength(4);
    const unknown = await post(`/api/integration/campaigns/${runtime.id}/tokens`, { mapId, label: 'Peth', at: 'Elturel' });
    expect(unknown.status).toBe(404);
    const noAuth = await app.request(`/api/integration/campaigns/${runtime.id}/maps/${mapId}/tokens`);
    expect(noAuth.status).toBe(401);
  });
});
