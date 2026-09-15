import { beforeEach, describe, expect, it } from 'vitest';
import { filterStateForViewer, seededRng, hexKey } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Move undo and the travel log (issue #127).
 *
 * A party move touches far more than token positions: the clock, the hex the
 * party left and the one it reached, the encounter-check counter, whatever
 * the knowledge engine opened, and several log lines. One undo has to put all
 * of it back — and a player's mis-drag must be as recoverable as the DM's.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `u${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `u${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Undo', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

/** A scout with a token at the origin, claimed by a player seat. */
function party(): { mapId: string; charId: string; tokenId: string; seat: SeatRecord } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name: 'Scout',
      color: '#00aa00',
      glyph: '🏹',
      speed: 30,
      skills: { perception: 4 },
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.keys()][0]!;
  const seat = runtime.createSeat('player', 'Alice');
  asSeat(seat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  seat.characterId = charId;
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
  return { mapId, charId, tokenId, seat };
}

function playerView(seat: SeatRecord) {
  return filterStateForViewer(runtime.buildFullState(), {
    seatId: seat.id,
    role: 'player',
    characterId: seat.characterId,
  });
}

describe('travel log', () => {
  it('writes a travel line everyone can read, with the hexes and time spent', () => {
    const { tokenId, seat } = party();
    asSeat(seat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    const travel = runtime.log.find((e) => e.kind === 'travel')!;
    expect(travel.visibility).toBe('all');
    // Default map: 6 mi/hex on foot at 3 mph = 2 hours a hex.
    expect(travel.data).toMatchObject({ hexes: 3, minutes: 360, from: { q: 0, r: 0 }, to: { q: 3, r: 0 } });
    expect(travel.text).toMatch(/Scout travelled 3 hexes/);
    expect(playerView(seat).log.some((e) => e.id === travel.id)).toBe(true);
  });

  it('logs a DM teleport for the DM only', () => {
    const { tokenId } = party();
    dm({ kind: 'token.move', tokenId, q: 5, r: 0, teleport: true } as never);
    const travel = runtime.log.find((e) => e.kind === 'travel')!;
    expect(travel.visibility).toBe('dm');
    expect(travel.text).toMatch(/teleported/);
    expect(runtime.campaign.time.minutes).toBe(8 * 60);
  });
});

describe('undoing a move', () => {
  it("reverts a player's move: position, clock, party hex, visits, fog and log", () => {
    const { mapId, tokenId, seat } = party();
    const rt = runtime.requireMap(mapId);
    const fogBefore = Object.fromEntries(rt.fog);
    // Linger an hour at the origin so the departure credits it with time.
    dm({ kind: 'time.advance', minutes: 60 } as never);
    const clockBefore = runtime.campaign.time.minutes;
    const logBefore = runtime.log.length;

    asSeat(seat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    expect(runtime.campaign.time.minutes).toBe(clockBefore + 360);
    expect(runtime.hexVisit(mapId, 0, 0)!.totalMinutes).toBe(60);
    expect(runtime.hexVisit(mapId, 3, 0)).not.toBeNull();
    // A player's move pushes an undo entry too — only the DM may pop it.
    expect(runtime.buildFullState().undoHistory[0]!.description).toMatch(/move Scout back to 0,0/);
    expect(() => asSeat(seat, { kind: 'undo' } as never)).toThrow(/DM/);

    dm({ kind: 'undo' } as never);
    expect(rt.tokens.get(tokenId)).toMatchObject({ q: 0, r: 0 });
    expect(runtime.campaign.time.minutes).toBe(clockBefore);
    expect(runtime.campaign.time.partyHex).toMatchObject({ q: 0, r: 0, arrivedMinutes: 8 * 60 });
    expect(runtime.hexVisit(mapId, 3, 0)).toBeNull();
    expect(runtime.hexVisit(mapId, 0, 0)!.totalMinutes).toBe(0);
    expect(Object.fromEntries(rt.fog)).toEqual(fogBefore);
    // The travel line is struck; an undo line (visible to all) replaces it.
    expect(runtime.log.filter((e) => e.kind === 'travel')).toHaveLength(0);
    const undo = runtime.log[runtime.log.length - 1]!;
    expect(undo.kind).toBe('undo');
    expect(undo.visibility).toBe('all');
    expect(undo.text).toMatch(/clock rewound 6 hours/);
    expect(runtime.log).toHaveLength(logBefore + 1);
    // Durable: a fresh runtime over the same database agrees.
    const reloaded = new Store(store.db).getCampaign(runtime.id)!;
    expect(reloaded.campaign.time.minutes).toBe(clockBefore);
    expect(reloaded.requireMap(mapId).tokens.get(tokenId)).toMatchObject({ q: 0, r: 0 });
    expect(reloaded.hexVisit(mapId, 3, 0)).toBeNull();
  });

  it('revokes the discoveries the move opened (mistakes happen)', () => {
    const { mapId, tokenId, seat, charId } = party();
    dm({
      kind: 'content.upsert',
      content: {
        id: null,
        mapId,
        q: 3,
        r: 0,
        type: 'ruin',
        title: 'Old Tower',
        dmNotes: '',
        glyph: '',
        clues: [{ id: null, text: 'A toppled tower', gate: { kind: 'auto' }, sortOrder: 0 }],
      },
    } as never);
    asSeat(seat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(1);
    expect(playerView(seat).mapState!.contents.map((c) => c.title)).toEqual(['Old Tower']);

    dm({ kind: 'undo' } as never);
    expect(runtime.discoveries.size).toBe(0);
    expect(runtime.hasDiscovery([...runtime.requireMap(mapId).contents.values()][0]!.clues[0]!.id, charId)).toBe(false);
    expect(playerView(seat).mapState!.contents).toEqual([]);
    expect(runtime.log.filter((e) => e.kind === 'discovery')).toHaveLength(0);
    expect(runtime.log[runtime.log.length - 1]!.text).toMatch(/1 discovery revoked/);
  });

  it('rewinds several moves at once with a count', () => {
    const { mapId, tokenId, seat } = party();
    asSeat(seat, { kind: 'token.move', tokenId, q: 1, r: 0 } as never);
    asSeat(seat, { kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    asSeat(seat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    expect(runtime.buildFullState().undoHistory).toHaveLength(3);
    dm({ kind: 'undo', count: 2 } as never);
    expect(runtime.requireMap(mapId).tokens.get(tokenId)).toMatchObject({ q: 1, r: 0 });
    expect(runtime.campaign.time.minutes).toBe(8 * 60 + 120);
    expect(runtime.buildFullState().undoHistory).toHaveLength(1);
  });
});

describe('encounters interrupt travel', () => {
  it('halts the party at the hex where an encounter triggers, and undo restores the counter', () => {
    const { mapId, tokenId, seat } = party();
    dm({
      kind: 'encounterTable.upsert',
      table: { id: null, name: 'Anywhere', terrains: [], die: '1d6', entries: [{ min: 1, max: 6, text: 'Wolves', quantity: '' }] },
    } as never);
    // Every hex is a check and every check triggers (needs 1+ on a d20).
    dm({ kind: 'map.update', mapId, patch: { encounterCheck: { autoEvery: 1, threshold: 1 } } } as never);
    asSeat(seat, { kind: 'token.move', tokenId, q: 4, r: 0 } as never);
    const rt = runtime.requireMap(mapId);
    expect(rt.tokens.get(tokenId)).toMatchObject({ q: 1, r: 0 });
    expect(rt.fog.get(hexKey(3, 0))).toBeUndefined(); // never walked
    expect(runtime.campaign.time.minutes).toBe(8 * 60 + 120); // one hex, not four
    const travel = runtime.log.find((e) => e.kind === 'travel')!;
    expect(travel.data).toMatchObject({ stoppedBy: 'encounter', hexes: 1, intended: { q: 4, r: 0 } });
    expect(travel.text).toMatch(/halted by an encounter, 3 hexes short/);
    expect(runtime.log.filter((e) => e.kind === 'encounter')).toHaveLength(1);
    expect(runtime.maps.get(mapId)!.encounterCheck.hexesSinceCheck).toBe(0);

    dm({ kind: 'undo' } as never);
    expect(rt.tokens.get(tokenId)).toMatchObject({ q: 0, r: 0 });
    expect(runtime.log.filter((e) => e.kind === 'encounter')).toHaveLength(0);
    expect(runtime.campaign.time.minutes).toBe(8 * 60);
  });
});
