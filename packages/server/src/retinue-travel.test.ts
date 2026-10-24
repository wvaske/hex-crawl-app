import { beforeEach, describe, expect, it } from 'vitest';
import { filterStateForViewer, hexKey, seededRng, travelWindowMinutes } from '@hexcrawl/shared';
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
        { id: 'anvil', name: 'The Anvil', holder: 'Xanphina', faction: 'Order of the Gauntlet', color: '#b3b3b3', icon: 'objects/anvil', glyph: '⚒', travelMode: 'horse', pace: null, wikiPage: 'The Anvil' },
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
    // A custom 1.5 mph mode: 4 hours per 6-mile hex.
    dm({ kind: 'campaign.update', settings: { customTravelModes: [{ id: 'mule', name: 'Mule', mph: 1.5, medium: 'land' }] } } as never);
    dm({ kind: 'token.update', tokenId, patch: { travelMode: 'mule' } } as never);
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

describe('journey routing', () => {
  it('goes around water on land, across it by ship, and over it by air', () => {
    const { mapId, tokenId } = rider();
    // A wall of water across the straight line from 10,0 to 13,0.
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 11, r: -1 }, { q: 11, r: 0 }, { q: 11, r: 1 }, { q: 12, r: -1 }, { q: 12, r: 0 }], terrain: 'water' } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    const land = runtime.requireMap(mapId).tokens.get(tokenId)!.route;
    expect(land.some((h) => h.q === 11 && h.r === 0)).toBe(false);
    expect(land[land.length - 1]).toEqual({ q: 13, r: 0 });
    expect(land.length).toBeGreaterThan(3);
    dm({ kind: 'token.update', tokenId, patch: { travelMode: 'flying' } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.route).toHaveLength(3);
    // A ship on open water from 11,-1 to 12,0 takes the water hexes only.
    dm({ kind: 'token.move', tokenId, q: 11, r: -1, teleport: true } as never);
    dm({ kind: 'token.update', tokenId, patch: { travelMode: 'ship' } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 12, r: 0 }] } as never);
    const sea = runtime.requireMap(mapId).tokens.get(tokenId)!.route;
    expect(sea).toEqual([{ q: 12, r: 0 }].length === 1 ? sea : sea);
    expect(sea.every((h) => ['11,-1', '11,0', '11,1', '12,-1', '12,0'].includes(`${h.q},${h.r}`))).toBe(true);
  });

  it('prefers a road when it is shorter than twice the straight walk', () => {
    const { mapId, tokenId } = rider();
    // Road from 10,0 up through 11,-1 .. 13,-1 and back down to 13,0: 5 steps vs 3 straight.
    dm({
      kind: 'trail.upsert',
      trail: { id: null, mapId, name: 'Trade Way', glyph: '🛣️', dmNotes: '', gate: { kind: 'auto' }, kind: 'road',
        cells: [{ q: 10, r: 0 }, { q: 11, r: -1 }, { q: 12, r: -1 }, { q: 13, r: -1 }, { q: 13, r: 0 }] },
    } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    const route = runtime.requireMap(mapId).tokens.get(tokenId)!.route;
    expect(route).toEqual([{ q: 11, r: -1 }, { q: 12, r: -1 }, { q: 13, r: -1 }, { q: 13, r: 0 }]);
    // Players receive the road, not the tracks, and only on known ground.
    const player = runtime.createSeat('player', 'Alice');
    dm({ kind: 'fog.set', mapId, cells: [{ q: 12, r: -1 }, { q: 13, r: -1 }], state: 'explored' } as never);
    const view = filterStateForViewer(runtime.buildFullState(mapId), { role: 'player', seatId: player.id, characterId: null });
    expect(view.mapState!.trails).toHaveLength(1);
    expect(view.mapState!.trails[0]!.cells).toEqual([{ q: 12, r: -1 }, { q: 13, r: -1 }]);
    expect(view.mapState!.trailSigns).toEqual([]);
  });
});

describe('movers: loops, encounter cadence, summaries', () => {
  it('looping a route that kept no waypoints turns it into an out-and-back patrol', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 12, r: 0 }] } as never);
    runtime.updateToken(mapId, tokenId, { waypoints: [] }); // as an older or API-planned route
    dm({ kind: 'token.update', tokenId, patch: { loop: true } } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.waypoints).toEqual([{ q: 10, r: 0 }, { q: 12, r: 0 }]);
    dm({ kind: 'time.advance', minutes: 180 } as never); // 2 out, then 1 back
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.q).toBe(11);
  });

  it('a looping route plans itself again at the end and keeps walking on the same tick', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 12, r: 0 }, { q: 10, r: 0 }], loop: true } as never);
    let t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect(t.loop).toBe(true);
    expect(t.waypoints).toHaveLength(2);
    expect(t.route).toHaveLength(4); // 10→12 (2) and back (2)
    // 6 mph on 6-mile hexes = 1 hex/hour; 5 hours walks the 4-hex circuit and one hex more.
    dm({ kind: 'time.advance', minutes: 300 } as never);
    t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([11, 0]);
    expect(t.route.length).toBeGreaterThan(0);
    expect(runtime.log.some((e) => e.text.includes('completes a circuit'))).toBe(true);
    dm({ kind: 'undo' } as never);
    t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([10, 0]);
    expect(t.route).toHaveLength(4);
  });

  it('rolls on the encounter table every N miles and logs it DM-only without halting', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'map.update', mapId, patch: { encounterCheck: { die: '1d20', threshold: 1, autoEvery: 0 } } } as never);
    dm({ kind: 'token.update', tokenId, patch: { encounterEveryMiles: 12 } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 14, r: 0 }] } as never);
    dm({ kind: 'time.advance', minutes: 240 } as never); // 4 hexes = 24 miles → 2 rolls
    const rolls = runtime.log.filter((e) => e.kind === 'encounter' && e.data.traveller === true);
    expect(rolls).toHaveLength(2);
    expect(rolls.every((e) => e.visibility === 'dm')).toBe(true);
    const t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect([t.q, t.r]).toEqual([14, 0]);
    expect(t.encounterMiles).toBe(0);
    dm({ kind: 'undo' } as never);
    expect(runtime.log.filter((e) => e.kind === 'encounter' && e.data.traveller === true)).toHaveLength(0);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.encounterMiles).toBe(0);
  });

  it('summarises every NPC across maps for the DM and nothing for players', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'map.create', name: 'Far North', orientation: 'flat', hexSize: 48 } as never);
    const north = [...runtime.maps.values()].find((m) => m.name === 'Far North')!;
    dm({ kind: 'token.create', mapId: north.id, q: 1, r: 1, tokenKind: 'npc', characterId: null, label: 'Sera Dunwick', color: '#4f6fd6', glyph: '', playerVisible: true, retinueId: 'anvil' } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 12, r: 0 }] } as never);
    const full = runtime.buildFullState(mapId);
    expect(full.movers.map((m) => m.label).sort()).toEqual(['Dorn Ackley', 'Sera Dunwick']);
    const dorn = full.movers.find((m) => m.label === 'Dorn Ackley')!;
    expect(dorn.routeLeft).toBe(2);
    expect(dorn.travelMode).toBe('horse');
    expect(dorn.mph).toBe(6);
    expect(dorn.etaMinutes).toBe(120);
    expect(full.movers.find((m) => m.label === 'Sera Dunwick')!.mapName).toBe('Far North');
    const player = runtime.createSeat('player', 'Alice');
    const view = filterStateForViewer(full, { role: 'player', seatId: player.id, characterId: null });
    expect(view.movers).toEqual([]);
    expect(view.mapState!.tokens.find((t) => t.id === tokenId)!.waypoints).toEqual([]);
  });
});

describe('tracks and presence', () => {
  function scoutAt(q: number, r: number, perception = 4, survival = 4): { charId: string; seat: SeatRecord } {
    const mapId = runtime.campaign.activeMapId!;
    dm({
      kind: 'character.create',
      character: { name: 'Tracker', color: '#00aa00', glyph: '', speed: 30, skills: { perception, survival }, extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' } },
    } as never);
    const charId = [...runtime.characters.keys()].pop()!;
    const seat = runtime.createSeat('player', 'Alice');
    asSeat(seat, { kind: 'seat.claimCharacter', characterId: charId } as never);
    seat.characterId = charId;
    dm({ kind: 'token.create', mapId, q, r, tokenKind: 'pc', characterId: charId, label: '', color: '#00aa00', glyph: '', playerVisible: true } as never);
    return { charId, seat };
  }

  it('lays timestamped tracks behind a mover and undo takes them back', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'token.update', tokenId, patch: { layTracks: true } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    const t0 = runtime.campaign.time.minutes;
    dm({ kind: 'time.advance', minutes: 120 } as never); // 6 mph, 6-mile hexes: 2 hexes
    const trail = runtime.findTrail(`tracks:${tokenId}`)!;
    expect(trail.kind).toBe('tracks');
    expect(trail.moverId).toBe(tokenId);
    expect(trail.fade).toEqual({ dcPerDay: 2, expireDays: 7 });
    expect(trail.cells.map((c) => [c.q, c.r])).toEqual([[10, 0], [11, 0], [12, 0]]);
    expect(trail.cells[0]!.at).toBe(t0);
    expect(trail.cells[2]!.at).toBe(t0 + 120);
    dm({ kind: 'time.advance', minutes: 60 } as never);
    expect(runtime.findTrail(`tracks:${tokenId}`)!.cells).toHaveLength(4);
    dm({ kind: 'undo' } as never);
    expect(runtime.findTrail(`tracks:${tokenId}`)!.cells).toHaveLength(3);
    dm({ kind: 'undo' } as never);
    expect(runtime.findTrail(`tracks:${tokenId}`)).toBeNull();
  });

  it('fresh tracks are found at the base DC; a day later the DC has climbed', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'campaign.update', settings: { npcTravelHoursPerDay: 24 } } as never);
    dm({
      kind: 'token.update',
      tokenId,
      patch: { layTracks: true, tracksGate: { kind: 'skill', skill: 'survival', dc: 13, maxDistance: 0, mode: 'passive' }, tracksDcPerDay: 5 },
    } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 12, r: 0 }] } as never);
    dm({ kind: 'time.advance', minutes: 120 } as never);
    // Passive survival 14 (10 + 4): beats 13 today.
    const { charId } = scoutAt(11, 0);
    expect([...runtime.trailDiscoveries.values()].filter((d) => d.characterId === charId)).toHaveLength(1);
    // A second tracker arriving two days later faces DC 23 and finds nothing.
    dm({ kind: 'time.advance', minutes: 2 * 1440 } as never);
    const late = scoutAt(11, 0);
    expect([...runtime.trailDiscoveries.values()].filter((d) => d.characterId === late.charId)).toHaveLength(0);
    // Players see when the sign was made.
    const view = filterStateForViewer(runtime.buildFullState(mapId), { role: 'player', seatId: 'x', characterId: charId });
    expect(view.mapState!.trailSigns).toHaveLength(1);
    expect(view.mapState!.trailSigns[0]!.at).not.toBeNull();
  });

  it('expired cells are pruned and the finds re-indexed; undo restores both', () => {
    const { mapId, tokenId } = rider();
    dm({ kind: 'campaign.update', settings: { npcTravelHoursPerDay: 24 } } as never);
    dm({ kind: 'token.update', tokenId, patch: { layTracks: true, tracksExpireDays: 1 } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    dm({ kind: 'time.advance', minutes: 180 } as never); // cells 10,11,12,13 at t0..t0+180
    const { charId } = scoutAt(13, 0); // finds cell index 3 (obvious gate)
    const before = [...runtime.trailDiscoveries.values()].find((d) => d.characterId === charId)!;
    expect(before.cellIndex).toBe(3);
    // Clock now t0+180. At t0+1530 the cells stamped t0 and t0+60 are more
    // than a day old; the ones at t0+120 and t0+180 are not.
    dm({ kind: 'time.advance', minutes: 1350 } as never);
    const trail = runtime.findTrail(`tracks:${tokenId}`)!;
    expect(trail.cells.map((c) => c.q)).toEqual([12, 13]);
    const after = [...runtime.trailDiscoveries.values()].find((d) => d.characterId === charId)!;
    expect(after.cellIndex).toBe(1);
    dm({ kind: 'undo' } as never);
    expect(runtime.findTrail(`tracks:${tokenId}`)!.cells).toHaveLength(4);
    expect([...runtime.trailDiscoveries.values()].find((d) => d.characterId === charId)!.cellIndex).toBe(3);
  });

  it('presence content follows the mover and opens its clue for a standing party', () => {
    const { mapId, tokenId } = rider();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 10, r: 0, type: 'other', title: 'Dust cloud', dmNotes: '', glyph: '', showLabel: false,
        scaleVisibility: 1, wikiPage: '', enabled: true, knownLocation: false, quest: '',
        clues: [{ text: 'A column of dust on the road', gate: { kind: 'skill', skill: 'perception', dc: 10, maxDistance: 2, mode: 'passive' }, indicatesDirection: true, indicatesDistance: false, revealsLocation: false, observeFrom: [] }],
      },
    } as never);
    const content = [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === 'Dust cloud')!;
    dm({ kind: 'token.update', tokenId, patch: { contentId: content.id } } as never);
    const { charId } = scoutAt(15, 0); // 5 hexes off: out of range
    expect([...runtime.discoveries.values()].filter((d) => d.characterId === charId)).toHaveLength(0);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    dm({ kind: 'time.advance', minutes: 180 } as never); // mover (and its dust) now at 13,0: 2 hexes away
    const moved = runtime.requireMap(mapId).contents.get(content.id)!;
    expect([moved.q, moved.r]).toEqual([13, 0]);
    const found = [...runtime.discoveries.values()].filter((d) => d.characterId === charId);
    expect(found).toHaveLength(1);
    dm({ kind: 'undo' } as never);
    expect(runtime.requireMap(mapId).contents.get(content.id)!.q).toBe(10);
    expect([...runtime.discoveries.values()].filter((d) => d.characterId === charId)).toHaveLength(0);
    const full = runtime.buildFullState(mapId);
    expect(full.movers.find((m) => m.tokenId === tokenId)!.presence).toBe('Dust cloud');
  });
});

describe('journals and reports', () => {
  function pc(q: number, r: number): string {
    const mapId = runtime.campaign.activeMapId!;
    dm({
      kind: 'character.create',
      character: { name: 'Xanphina', color: '#aa2200', glyph: '', speed: 30, skills: {}, extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' } },
    } as never);
    const charId = [...runtime.characters.keys()].pop()!;
    dm({ kind: 'token.create', mapId, q, r, tokenKind: 'pc', characterId: charId, label: '', color: '#aa2200', glyph: '', playerVisible: true } as never);
    return charId;
  }
  function shrine(q: number, r: number, dc: number): string {
    const mapId = runtime.campaign.activeMapId!;
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q, r, type: 'landmark', title: 'Wayside shrine', dmNotes: '', glyph: '', showLabel: false,
        scaleVisibility: 1, wikiPage: '', enabled: true, knownLocation: false, quest: '',
        clues: [{ text: 'Fresh offerings to Tiamat', gate: { kind: 'skill', skill: 'perception', dc, maxDistance: 1, mode: 'passive' }, indicatesDirection: false, indicatesDistance: false, revealsLocation: true, observeFrom: [] }],
      },
    } as never);
    return [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === 'Wayside shrine')!.id;
  }

  it('an observing mover journals hexes and the clues its score opens, and nothing reaches the party yet', () => {
    const { mapId, tokenId } = rider();
    shrine(12, 1, 14);
    const charId = pc(0, 0);
    dm({ kind: 'token.update', tokenId, patch: { observe: true, observation: 12 } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    dm({ kind: 'time.advance', minutes: 180 } as never);
    let t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    expect(t.journal.filter((j) => j.kind === 'hex').map((j) => j.q)).toEqual([11, 12, 13]);
    expect(t.journal.filter((j) => j.kind === 'clue')).toHaveLength(0); // passive 12 < DC 14
    expect([...runtime.discoveries.values()].filter((d) => d.characterId === charId)).toHaveLength(0);
    expect(runtime.requireMap(mapId).fog.get(hexKey(12, 0)) ?? 'hidden').toBe('hidden');
    // Keener eyes on the way back.
    dm({ kind: 'token.update', tokenId, patch: { observation: 15 } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 10, r: 0 }] } as never);
    dm({ kind: 'time.advance', minutes: 180 } as never);
    t = runtime.requireMap(mapId).tokens.get(tokenId)!;
    const sightings = t.journal.filter((j) => j.kind === 'clue');
    expect(sightings).toHaveLength(1);
    expect(sightings[0]!.text).toBe('Fresh offerings to Tiamat');
    expect(t.journal.filter((j) => j.kind === 'hex')).toHaveLength(4); // 10..13, no duplicates
    const full = runtime.buildFullState(mapId);
    const summary = full.movers.find((m) => m.tokenId === tokenId)!;
    expect([summary.journalHexes, summary.journalClues, summary.withParty]).toEqual([4, 1, false]);
    const player = runtime.createSeat('player', 'Alice');
    const view = filterStateForViewer(full, { role: 'player', seatId: player.id, characterId: charId });
    expect(view.mapState!.tokens.find((x) => x.id === tokenId)!.journal).toEqual([]);
    expect(() => asSeat(player, { kind: 'token.report', tokenId } as never)).toThrow();
  });

  it('delivering a report explores the hexes, creates discoveries, logs it, and undo takes it all back', () => {
    const { mapId, tokenId } = rider();
    shrine(12, 1, 10);
    const charId = pc(10, 0);
    dm({ kind: 'token.update', tokenId, patch: { observe: true } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }, { q: 10, r: 0 }] } as never);
    dm({ kind: 'time.advance', minutes: 360 } as never);
    expect(runtime.buildFullState(mapId).movers.find((m) => m.tokenId === tokenId)!.withParty).toBe(true);
    dm({ kind: 'token.report', tokenId } as never);
    const rt = runtime.requireMap(mapId);
    for (const q of [11, 12, 13]) expect(rt.fog.get(hexKey(q, 0))).toBe('explored');
    const found = [...runtime.discoveries.values()].filter((d) => d.characterId === charId);
    expect(found).toHaveLength(1);
    expect(found[0]!.how.kind).toBe('manual');
    expect(rt.tokens.get(tokenId)!.journal).toEqual([]);
    const note = runtime.log.find((e) => e.kind === 'note' && e.text.includes('reports:'));
    expect(note?.visibility).toBe('all');
    expect(runtime.log.some((e) => e.kind === 'discovery' && e.text.includes('reported by Dorn Ackley'))).toBe(true);
    expect(() => dm({ kind: 'token.report', tokenId } as never)).toThrow(/Nothing to report/);
    dm({ kind: 'undo' } as never);
    expect(runtime.requireMap(mapId).fog.get(hexKey(12, 0)) ?? 'hidden').toBe('hidden');
    expect([...runtime.discoveries.values()].filter((d) => d.characterId === charId)).toHaveLength(0);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.journal.length).toBeGreaterThan(0);
    expect(runtime.log.some((e) => e.kind === 'note' && e.text.includes('reports:'))).toBe(false);
  });

  it('a lost report clears the journal without telling the party; a dead mover takes it with it', () => {
    const { mapId, tokenId } = rider();
    shrine(12, 1, 10);
    const charId = pc(0, 0);
    dm({ kind: 'token.update', tokenId, patch: { observe: true } } as never);
    dm({ kind: 'token.route', tokenId, waypoints: [{ q: 13, r: 0 }] } as never);
    dm({ kind: 'time.advance', minutes: 180 } as never);
    dm({ kind: 'token.report', tokenId, discard: true } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.journal).toEqual([]);
    expect([...runtime.discoveries.values()].filter((d) => d.characterId === charId)).toHaveLength(0);
    expect(runtime.log.find((e) => e.text.includes('report is lost'))!.visibility).toBe('dm');
    dm({ kind: 'undo' } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)!.journal.length).toBeGreaterThan(0);
    dm({ kind: 'token.delete', tokenId } as never);
    expect(runtime.findToken(tokenId)).toBeNull();
    expect(runtime.requireMap(mapId).fog.get(hexKey(12, 0)) ?? 'hidden').toBe('hidden');
  });
});
