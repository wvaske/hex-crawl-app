import { beforeEach, describe, expect, it } from 'vitest';
import { edgeKey, filterStateForViewer, hexKey, seededRng } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Terrain difficulty on directed hex edges: marking and clearing (with
 * undo), the region-border apply, what a difficult crossing costs the party
 * clock, how an impassable edge blocks players and routes, and what players
 * get to see of it.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `e${cmdCounter++}` } as ClientCommand, {
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
  const created = store.createCampaign('Edges', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

function mapId(): string {
  return runtime.campaign.activeMapId!;
}

/** Default map: 6 miles per hex on foot at 3 mph = 120 minutes a hex. */
const HEX_MINUTES = 120;
const START = 8 * 60;

function party(): { tokenId: string; seat: SeatRecord } {
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
  dm({ kind: 'map.update', mapId: mapId(), patch: { fogMode: 'manual', sightRadius: 0 } } as never);
  dm({
    kind: 'token.create',
    mapId: mapId(),
    q: 0,
    r: 0,
    tokenKind: 'pc',
    characterId: charId,
    label: '',
    color: '#00aa00',
    glyph: '',
    playerVisible: true,
  } as never);
  const tokenId = [...runtime.requireMap(mapId()).tokens.keys()][0]!;
  return { tokenId, seat };
}

function explore(cells: { q: number; r: number }[]): void {
  dm({ kind: 'fog.set', mapId: mapId(), cells, state: 'explored' } as never);
}

describe('edge.set', () => {
  it('marks, remarks and clears directed edges, and one undo reverts the batch', () => {
    const rt = runtime.requireMap(mapId());
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [
        { q: 0, r: 0, dir: 0, difficulty: 'difficult' },
        { q: 0, r: 0, dir: 1, difficulty: 'impassable' },
      ],
    } as never);
    expect(rt.edges.get(edgeKey(0, 0, 0))).toBe('difficult');
    expect(rt.edges.get(edgeKey(0, 0, 1))).toBe('impassable');
    // The reverse crossing is untouched: difficulty is one-way by default.
    expect(rt.edges.get(edgeKey(1, 0, 3))).toBeUndefined();

    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [
        { q: 0, r: 0, dir: 0, difficulty: 'very_difficult' },
        { q: 0, r: 0, dir: 1, difficulty: null },
      ],
    } as never);
    expect(rt.edges.get(edgeKey(0, 0, 0))).toBe('very_difficult');
    expect(rt.edges.has(edgeKey(0, 0, 1))).toBe(false);
    expect(runtime.mapState(mapId())!.edges).toEqual([
      { q: 0, r: 0, dir: 0, difficulty: 'very_difficult' },
    ]);

    // Both commands landed within the merge window: one undo puts it all back.
    expect(runtime.undoStack).toHaveLength(1);
    dm({ kind: 'undo' } as never);
    expect(rt.edges.size).toBe(0);

    // Persisted: a reload sees what the runtime saw.
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [{ q: 2, r: 2, dir: 5, difficulty: 'difficult' }],
    } as never);
    const reloaded = new Store(store.db).getCampaign(runtime.id)!;
    expect(reloaded.requireMap(mapId()).edges.get(edgeKey(2, 2, 5))).toBe('difficult');
  });

  it('players may not mark edges', () => {
    const { seat } = party();
    expect(() =>
      asSeat(seat, {
        kind: 'edge.set',
        mapId: mapId(),
        edges: [{ q: 0, r: 0, dir: 0, difficulty: 'difficult' }],
      } as never),
    ).toThrow();
  });
});

describe('content.applyEdges', () => {
  function canyon(): string {
    dm({
      kind: 'content.upsert',
      content: {
        id: null,
        mapId: mapId(),
        q: 0,
        r: 0,
        area: [{ q: 1, r: 0 }],
        type: 'region',
        title: 'Canyon',
        dmNotes: '',
        glyph: '',
        showLabel: false,
        scaleVisibility: 1,
        enabled: true,
        knownLocation: false,
        quest: '',
        wikiPage: '',
        observeFrom: [],
        clues: [],
      },
    } as never);
    return [...runtime.requireMap(mapId()).contents.keys()][0]!;
  }

  it('marks the outward, inward or both crossings of the footprint border', () => {
    const id = canyon();
    const rt = runtime.requireMap(mapId());
    dm({ kind: 'content.applyEdges', contentId: id, side: 'leaving', difficulty: 'difficult' } as never);
    // Two hexes, ten outward edges; the shared edge is interior both ways.
    expect(rt.edges.size).toBe(10);
    expect(rt.edges.has(edgeKey(0, 0, 0))).toBe(false);
    expect(rt.edges.has(edgeKey(1, 0, 3))).toBe(false);
    expect(rt.edges.get(edgeKey(0, 0, 3))).toBe('difficult');
    // Entering is the reverse of every outward edge, on the neighbours.
    expect(rt.edges.has(edgeKey(-1, 0, 0))).toBe(false);

    dm({ kind: 'content.applyEdges', contentId: id, side: 'entering', difficulty: 'impassable' } as never);
    expect(rt.edges.size).toBe(20);
    expect(rt.edges.get(edgeKey(-1, 0, 0))).toBe('impassable');

    dm({ kind: 'content.applyEdges', contentId: id, side: 'both', difficulty: null } as never);
    expect(rt.edges.size).toBe(0);

    const notes = runtime.log.filter((e) => e.kind === 'note').map((e) => e.text);
    expect(notes[0]).toMatch(/Marked difficult leaving Canyon — 10 edges/);
    expect(notes[2]).toMatch(/Cleared the border of Canyon — 20 edges/);
  });

  it('an exception click after the apply folds into the same undo entry', () => {
    const id = canyon();
    const rt = runtime.requireMap(mapId());
    dm({ kind: 'content.applyEdges', contentId: id, side: 'leaving', difficulty: 'difficult' } as never);
    // The gentle slope: leaving (1,0) eastward is not hard after all.
    dm({ kind: 'edge.set', mapId: mapId(), edges: [{ q: 1, r: 0, dir: 0, difficulty: null }] } as never);
    expect(rt.edges.size).toBe(9);
    expect(runtime.undoStack).toHaveLength(1);
    dm({ kind: 'undo' } as never);
    expect(rt.edges.size).toBe(0);
  });
});

describe('travel over difficult edges', () => {
  it('charges the clock per hex of effort, one way only', () => {
    const { tokenId } = party();
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [{ q: 0, r: 0, dir: 0, difficulty: 'difficult' }],
    } as never);
    dm({ kind: 'token.move', tokenId, q: 1, r: 0 } as never);
    expect(runtime.campaign.time.minutes).toBe(START + 2 * HEX_MINUTES);
    const up = runtime.log.find((e) => e.kind === 'travel')!;
    expect(up.data).toMatchObject({ hexes: 1, effort: 2, minutes: 2 * HEX_MINUTES });
    expect(up.text).toMatch(/over difficult ground \(2 hexes of effort\)/);

    // Back down is a normal step.
    dm({ kind: 'token.move', tokenId, q: 0, r: 0 } as never);
    expect(runtime.campaign.time.minutes).toBe(START + 3 * HEX_MINUTES);
    const down = runtime.log.filter((e) => e.kind === 'travel')[1]!;
    expect(down.data).toMatchObject({ hexes: 1, effort: 1 });
    expect(down.text).not.toMatch(/difficult ground/);
  });

  it('very difficult costs two extra; undoing the move rewinds the full charge', () => {
    const { tokenId } = party();
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [{ q: 0, r: 0, dir: 0, difficulty: 'very_difficult' }],
    } as never);
    dm({ kind: 'token.move', tokenId, q: 1, r: 0 } as never);
    expect(runtime.campaign.time.minutes).toBe(START + 3 * HEX_MINUTES);
    dm({ kind: 'undo' } as never);
    expect(runtime.campaign.time.minutes).toBe(START);
    expect(runtime.requireMap(mapId()).tokens.get(tokenId)).toMatchObject({ q: 0, r: 0 });
  });

  it('a player cannot step or declare a move across an impassable edge; the DM pays to', () => {
    const { tokenId, seat } = party();
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [{ q: 0, r: 0, dir: 0, difficulty: 'impassable' }],
    } as never);
    expect(() => asSeat(seat, { kind: 'token.move', tokenId, q: 1, r: 0 } as never)).toThrow(
      /impassable/,
    );
    // Another direction is fine.
    asSeat(seat, { kind: 'token.move', tokenId, q: 0, r: 1 } as never);
    expect(runtime.requireMap(mapId()).tokens.get(tokenId)).toMatchObject({ q: 0, r: 1 });
    asSeat(seat, { kind: 'token.move', tokenId, q: 0, r: 0 } as never);

    dm({ kind: 'map.update', mapId: mapId(), patch: { moveApproval: true } } as never);
    expect(() => asSeat(seat, { kind: 'move.request', tokenId, q: 1, r: 0 } as never)).toThrow(
      /impassable/,
    );
    expect(runtime.requireMap(mapId()).pendingMoves.size).toBe(0);

    // The DM overrides the map and is charged the very-difficult rate.
    const before = runtime.campaign.time.minutes;
    dm({ kind: 'token.move', tokenId, q: 1, r: 0 } as never);
    expect(runtime.campaign.time.minutes).toBe(before + 3 * HEX_MINUTES);
  });

  it('routes around a cliff and takes the cheaper detour over a hard climb', () => {
    const { tokenId } = party();
    const rt = runtime.requireMap(mapId());
    // Direct: (0,0) → (1,0) → (2,0). Detour: (1,0) → (1,1) → (2,0).
    explore([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 1, r: 1 },
      { q: 2, r: 0 },
    ]);
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [{ q: 1, r: 0, dir: 0, difficulty: 'impassable' }],
    } as never);
    dm({ kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    expect(rt.tokens.get(tokenId)).toMatchObject({ q: 2, r: 0 });
    expect(runtime.log.find((e) => e.kind === 'travel')!.data).toMatchObject({
      routed: true,
      hexes: 3,
      effort: 3,
    });
    expect(rt.fog.get(hexKey(1, 1))).toBe('explored');
    dm({ kind: 'undo' } as never);

    // Very difficult (step costs 3): direct = 1 + 3 = 4, detour = 3 → detour.
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [{ q: 1, r: 0, dir: 0, difficulty: 'very_difficult' }],
    } as never);
    dm({ kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    expect(runtime.log.filter((e) => e.kind === 'travel').pop()!.data).toMatchObject({
      routed: true,
      hexes: 3,
      effort: 3,
    });
  });

  it('halts for the night where the effort, not the hex count, says dusk falls', () => {
    const { tokenId } = party();
    dm({ kind: 'campaign.update', settings: { stopTravelAtNight: true } } as never);
    explore([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ]);
    // Sunset at 20:00; the party sets out at 14:00 with 6 hours = 3 hexes of
    // daylight. A very difficult second step eats two of them.
    dm({ kind: 'time.set', minutes: 14 * 60 } as never);
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [{ q: 1, r: 0, dir: 0, difficulty: 'very_difficult' }],
    } as never);
    dm({ kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    expect(runtime.requireMap(mapId()).tokens.get(tokenId)).toMatchObject({ q: 2, r: 0 });
    expect(runtime.log.find((e) => e.kind === 'travel')!.data).toMatchObject({
      stoppedBy: 'night',
      hexes: 2,
      effort: 4,
    });
  });
});

describe('what players see', () => {
  it('gets the edges touching a visible hex and nothing in the dark', () => {
    const { seat } = party();
    explore([{ q: 0, r: 0 }]);
    dm({
      kind: 'edge.set',
      mapId: mapId(),
      edges: [
        { q: 0, r: 0, dir: 0, difficulty: 'difficult' },
        { q: 1, r: 0, dir: 3, difficulty: 'very_difficult' },
        { q: 5, r: 5, dir: 0, difficulty: 'impassable' },
      ],
    } as never);
    const view = filterStateForViewer(runtime.buildFullState(mapId()), {
      seatId: seat.id,
      role: 'player',
      characterId: seat.characterId,
    });
    expect(view.mapState!.edges).toEqual([
      { q: 0, r: 0, dir: 0, difficulty: 'difficult' },
      { q: 1, r: 0, dir: 3, difficulty: 'very_difficult' },
    ]);
  });
});
