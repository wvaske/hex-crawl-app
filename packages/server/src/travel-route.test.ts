import { beforeEach, describe, expect, it } from 'vitest';
import { seededRng, hexKey, hexLine } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Routed travel through explored hexes (issue #130): a long move follows the
 * road the party already knows, step mode lets players cover any distance
 * over known ground (and only one hex into the unknown), and a campaign can
 * make routed journeys halt at nightfall.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `r${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `r${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Routes', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

function party(): { mapId: string; tokenId: string; seat: SeatRecord } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name: 'Scout',
      color: '#00aa00',
      glyph: '🏹',
      speed: 30,
      skills: {},
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.keys()][0]!;
  const seat = runtime.createSeat('player', 'Alice');
  asSeat(seat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  seat.characterId = charId;
  // No auto-reveal: the explored ground is exactly what the tests paint.
  dm({ kind: 'map.update', mapId, patch: { fogMode: 'manual', sightRadius: 0 } } as never);
  dm({
    kind: 'token.create',
    mapId,
    q: 0,
    r: 0,
    tokenKind: 'pc',
    characterId: charId,
    label: '',
    color: '#00aa00',
    glyph: '',
    playerVisible: true,
  } as never);
  const tokenId = [...runtime.requireMap(mapId).tokens.keys()][0]!;
  return { mapId, tokenId, seat };
}

/**
 * An L-shaped explored road: east along r=0 to (3,0), then north to (3,-3).
 * (3,-3) is three hexes from the origin as the crow flies; by road it is five
 * (the corner cuts diagonally from (2,0) to (3,-1)).
 */
function paintRoad(mapId: string): void {
  const cells = [
    ...hexLine({ q: 0, r: 0 }, { q: 3, r: 0 }),
    ...hexLine({ q: 3, r: 0 }, { q: 3, r: -3 }),
  ];
  dm({ kind: 'fog.set', mapId, cells, state: 'explored' } as never);
}

describe('routed travel', () => {
  it('follows the explored road instead of the straight line', () => {
    const { mapId, tokenId } = party();
    paintRoad(mapId);
    const rt = runtime.requireMap(mapId);
    dm({ kind: 'token.move', tokenId, q: 3, r: -3 } as never);
    expect(rt.tokens.get(tokenId)).toMatchObject({ q: 3, r: -3 });
    // Five hexes of road, not the three-hex diagonal: the clock says so, and
    // the straight-line hexes were never walked.
    expect(runtime.campaign.time.minutes).toBe(8 * 60 + 5 * 120);
    for (const h of hexLine({ q: 0, r: 0 }, { q: 3, r: -3 }).slice(1, -1)) {
      expect(rt.fog.get(hexKey(h.q, h.r))).toBeUndefined();
    }
    const travel = runtime.log.find((e) => e.kind === 'travel')!;
    expect(travel.data).toMatchObject({ routed: true, hexes: 5 });
  });

  it('falls back to a straight line when no explored route exists, or routing is off', () => {
    const { mapId, tokenId } = party();
    dm({ kind: 'token.move', tokenId, q: 3, r: -3 } as never);
    expect(runtime.log.find((e) => e.kind === 'travel')!.data).toMatchObject({ routed: false, hexes: 3 });
    dm({ kind: 'undo' } as never);
    paintRoad(mapId);
    dm({ kind: 'map.update', mapId, patch: { routeExplored: false } } as never);
    dm({ kind: 'token.move', tokenId, q: 3, r: -3 } as never);
    expect(runtime.log.find((e) => e.kind === 'travel')!.data).toMatchObject({ routed: false, hexes: 3 });
  });

  it('step mode: any distance over known ground, one hex into the unknown', () => {
    const { mapId, tokenId, seat } = party();
    dm({ kind: 'map.update', mapId, patch: { moveMode: 'step' } } as never);
    expect(() => asSeat(seat, { kind: 'token.move', tokenId, q: 3, r: -3 } as never)).toThrow(
      /No explored route/,
    );
    paintRoad(mapId);
    asSeat(seat, { kind: 'token.move', tokenId, q: 3, r: -3 } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)).toMatchObject({ q: 3, r: -3 });
    // Off the road: one step is fine, two is not.
    asSeat(seat, { kind: 'token.move', tokenId, q: 4, r: -3 } as never);
    expect(() => asSeat(seat, { kind: 'token.move', tokenId, q: 6, r: -3 } as never)).toThrow(
      /No explored route/,
    );
    // The old message survives on maps that do not route at all.
    dm({ kind: 'map.update', mapId, patch: { routeExplored: false } } as never);
    expect(() => asSeat(seat, { kind: 'token.move', tokenId, q: 6, r: -3 } as never)).toThrow(
      /one hex at a time/,
    );
  });

  it('records the route length on a pending move request', () => {
    const { mapId, tokenId, seat } = party();
    dm({ kind: 'map.update', mapId, patch: { moveApproval: true } } as never);
    paintRoad(mapId);
    asSeat(seat, { kind: 'move.request', tokenId, q: 3, r: -3 } as never);
    const pending = runtime.requireMap(mapId).pendingMoves.get(tokenId)!;
    expect(pending.routeHexes).toBe(5);
    dm({ kind: 'move.resolve', tokenId, approve: true, teleport: false } as never);
    expect(runtime.log.find((e) => e.kind === 'travel')!.data).toMatchObject({
      routed: true,
      hexes: 5,
      approved: true,
    });
  });

  it('the DM can approve a request as the straight line instead of the route', () => {
    const { mapId, tokenId, seat } = party();
    dm({ kind: 'map.update', mapId, patch: { moveApproval: true } } as never);
    paintRoad(mapId);
    asSeat(seat, { kind: 'move.request', tokenId, q: 3, r: -3 } as never);
    dm({ kind: 'move.resolve', tokenId, approve: true, teleport: false, route: false } as never);
    expect(runtime.log.find((e) => e.kind === 'travel')!.data).toMatchObject({
      routed: false,
      hexes: 3,
      approved: true,
    });
  });
});

describe('halting at nightfall', () => {
  it('stops a routed journey at the hex where dusk falls, and not a party that set out after dark', () => {
    const { mapId, tokenId } = party();
    paintRoad(mapId);
    dm({ kind: 'campaign.update', settings: { stopTravelAtNight: true } } as never);
    // 13:00 start, 2 hours a hex, sunset at 20:00: the road's hexes land at
    // 15, 17, 19, 21 and 23 o'clock. Dusk catches the party on the fourth
    // step, so they walk it and camp there — one hex short of the goal.
    dm({ kind: 'time.set', minutes: 13 * 60 } as never);
    dm({ kind: 'token.move', tokenId, q: 3, r: -3 } as never);
    const rt = runtime.requireMap(mapId);
    expect(rt.tokens.get(tokenId)).toMatchObject({ q: 3, r: -2 });
    expect(runtime.campaign.time.minutes).toBe(21 * 60);
    const travel = runtime.log.find((e) => e.kind === 'travel')!;
    expect(travel.data).toMatchObject({ stoppedBy: 'night', hexes: 4 });
    expect(travel.text).toMatch(/halts for the night, 1 hex short/);

    // Sent on again in the dark: that is a choice, and it is not stopped.
    dm({ kind: 'time.set', minutes: 22 * 60 } as never);
    dm({ kind: 'token.move', tokenId, q: 3, r: -3 } as never);
    expect(rt.tokens.get(tokenId)).toMatchObject({ q: 3, r: -3 });
  });

  it('leaves straight-line and unrouted moves alone', () => {
    const { mapId, tokenId } = party();
    dm({ kind: 'campaign.update', settings: { stopTravelAtNight: true } } as never);
    dm({ kind: 'time.set', minutes: 19 * 60 } as never);
    dm({ kind: 'token.move', tokenId, q: 3, r: -3 } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)).toMatchObject({ q: 3, r: -3 });
  });
});
