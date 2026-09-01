import { beforeEach, describe, expect, it } from 'vitest';
import { ClientCommandSchema, seededRng } from '@hexcrawl/shared';
import type { ClientCommand, Content } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * `content.area` (issue #108): the region brush's wire format. A stroke sends
 * only the hexes it touched, so painting a 200-hex forest never resends the
 * content payload and two strokes can't clobber each other's cells.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `a${cmdCounter++}` } as ClientCommand, {
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
  const created = store.createCampaign('Areas', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

/** A region anchored at (5,0) with an initial footprint of (6,0). */
function region(title: string, clues: unknown[] = []): Content {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'content.upsert',
    content: {
      id: null,
      mapId,
      q: 5,
      r: 0,
      area: [{ q: 6, r: 0 }],
      type: 'region',
      title,
      dmNotes: '',
      glyph: '',
      clues,
    },
  } as never);
  return [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === title)!;
}

function areaOf(contentId: string): { q: number; r: number }[] {
  const mapId = runtime.campaign.activeMapId!;
  return runtime.requireMap(mapId).contents.get(contentId)!.area;
}

/** A PC token at the origin, with a claimed seat, so gates can fire. */
function party(): { mapId: string; charId: string; tokenId: string; seat: SeatRecord } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name: 'Scout',
      color: '#00aa00',
      glyph: '🏹',
      speed: 30,
      skills: { perception: 4, survival: 2 },
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.keys()][0]!;
  const seat = runtime.createSeat('player', 'Alice');
  asSeat(seat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  seat.characterId = runtime.seats.get(seat.id)!.characterId;
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

describe('content.area: the command schema', () => {
  it('accepts add-only, remove-only and both; rejects neither', () => {
    const base = { id: 'x1', kind: 'content.area' as const, contentId: 'c1' };
    expect(ClientCommandSchema.safeParse({ ...base, add: [{ q: 1, r: 1 }] }).success).toBe(true);
    expect(ClientCommandSchema.safeParse({ ...base, remove: [{ q: 1, r: 1 }] }).success).toBe(true);
    expect(
      ClientCommandSchema.safeParse({ ...base, add: [{ q: 1, r: 1 }], remove: [] }).success,
    ).toBe(true);
    expect(ClientCommandSchema.safeParse(base).success).toBe(false);
  });

  it('caps each list at 5000 cells', () => {
    const cells = Array.from({ length: 5001 }, (_, i) => ({ q: i, r: 0 }));
    const parsed = ClientCommandSchema.safeParse({
      id: 'x2',
      kind: 'content.area',
      contentId: 'c1',
      add: cells,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('content.area: merging', () => {
  it('adds hexes to the stored footprint', () => {
    const content = region('Forest of Wyrms');
    dm({
      kind: 'content.area',
      contentId: content.id,
      add: [
        { q: 7, r: 0 },
        { q: 8, r: 0 },
      ],
    } as never);
    expect(areaOf(content.id)).toEqual([
      { q: 6, r: 0 },
      { q: 7, r: 0 },
      { q: 8, r: 0 },
    ]);
  });

  it('dedupes by hex key — repainting the same cells is a no-op', () => {
    const content = region('Forest of Wyrms');
    dm({ kind: 'content.area', contentId: content.id, add: [{ q: 7, r: 0 }] } as never);
    const undoDepth = runtime.undoStack.length;
    dm({
      kind: 'content.area',
      contentId: content.id,
      add: [
        { q: 6, r: 0 },
        { q: 7, r: 0 },
        { q: 7, r: 0 },
      ],
    } as never);
    expect(areaOf(content.id)).toEqual([
      { q: 6, r: 0 },
      { q: 7, r: 0 },
    ]);
    // Nothing changed, so the stroke did not stack another undo entry.
    expect(runtime.undoStack.length).toBe(undoDepth);
  });

  it('never stores the anchor, and ignores a request to remove it', () => {
    const content = region('Forest of Wyrms');
    dm({
      kind: 'content.area',
      contentId: content.id,
      add: [
        { q: 5, r: 0 }, // the anchor — an implicit member
        { q: 7, r: 0 },
      ],
    } as never);
    expect(areaOf(content.id)).toEqual([
      { q: 6, r: 0 },
      { q: 7, r: 0 },
    ]);

    dm({ kind: 'content.area', contentId: content.id, remove: [{ q: 5, r: 0 }] } as never);
    const after = runtime.requireMap(runtime.campaign.activeMapId!).contents.get(content.id)!;
    expect(after.q).toBe(5);
    expect(after.r).toBe(0);
    expect(after.area).toEqual([
      { q: 6, r: 0 },
      { q: 7, r: 0 },
    ]);
  });

  it('removes hexes, ignoring ones that were never members', () => {
    const content = region('Forest of Wyrms');
    dm({
      kind: 'content.area',
      contentId: content.id,
      add: [
        { q: 7, r: 0 },
        { q: 8, r: 0 },
      ],
    } as never);
    dm({
      kind: 'content.area',
      contentId: content.id,
      remove: [
        { q: 7, r: 0 },
        { q: 40, r: 40 },
      ],
    } as never);
    expect(areaOf(content.id)).toEqual([
      { q: 6, r: 0 },
      { q: 8, r: 0 },
    ]);
  });

  it('applies add and remove in one stroke (remove wins on a collision)', () => {
    const content = region('Forest of Wyrms');
    dm({
      kind: 'content.area',
      contentId: content.id,
      add: [{ q: 7, r: 0 }],
      remove: [{ q: 6, r: 0 }],
    } as never);
    expect(areaOf(content.id)).toEqual([{ q: 7, r: 0 }]);
  });

  it('survives a round trip through the database', () => {
    const mapId = runtime.campaign.activeMapId!;
    const content = region('Serpent Hills');
    dm({ kind: 'content.area', contentId: content.id, add: [{ q: 7, r: 0 }] } as never);
    store.forget(runtime.id);
    const reloaded = store.getCampaign(runtime.id)!;
    expect(reloaded.requireMap(mapId).contents.get(content.id)!.area).toEqual([
      { q: 6, r: 0 },
      { q: 7, r: 0 },
    ]);
  });

  it('rejects an unknown content id', () => {
    expect(() =>
      dm({ kind: 'content.area', contentId: 'nope', add: [{ q: 1, r: 1 }] } as never),
    ).toThrow(/not found/i);
  });
});

describe('content.area: knowledge re-evaluation', () => {
  it('growing a region over a standing party opens its entering gate', () => {
    const { tokenId, seat } = party();
    const content = region('Forest of Wyrms', [
      { id: null, text: 'You are among the wyrm-trees', gate: { kind: 'auto' }, sortOrder: 0 },
    ]);
    // Two hexes clear of the footprint (anchor 5,0 plus 6,0).
    asSeat(seat, { kind: 'token.move', tokenId, q: 9, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(0);

    // The brush spreads the forest out to where the party is standing: no one
    // moved, but they are inside the region now.
    dm({
      kind: 'content.area',
      contentId: content.id,
      add: [
        { q: 7, r: 0 },
        { q: 8, r: 0 },
        { q: 9, r: 0 },
      ],
    } as never);
    expect(runtime.discoveries.size).toBe(1);
    expect([...runtime.discoveries.values()][0]!.locates).toBe(true);
  });

  it('shrinking a region leaves existing discoveries alone', () => {
    const { tokenId, seat } = party();
    const content = region('Forest of Wyrms', [
      { id: null, text: 'You are among the wyrm-trees', gate: { kind: 'auto' }, sortOrder: 0 },
    ]);
    asSeat(seat, { kind: 'token.move', tokenId, q: 6, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(1);
    dm({ kind: 'content.area', contentId: content.id, remove: [{ q: 6, r: 0 }] } as never);
    expect(areaOf(content.id)).toEqual([]);
    expect(runtime.discoveries.size).toBe(1); // learned is learned
  });
});

describe('content.area: undo and authority', () => {
  it('undo restores the footprint the stroke started from', () => {
    const content = region('Forest of Wyrms');
    dm({
      kind: 'content.area',
      contentId: content.id,
      add: [
        { q: 7, r: 0 },
        { q: 8, r: 0 },
      ],
    } as never);
    expect(areaOf(content.id)).toHaveLength(3);
    dm({ kind: 'undo' } as never);
    expect(areaOf(content.id)).toEqual([{ q: 6, r: 0 }]);
  });

  it('undo of a removal puts the hexes back', () => {
    const content = region('Forest of Wyrms');
    dm({ kind: 'content.area', contentId: content.id, remove: [{ q: 6, r: 0 }] } as never);
    expect(areaOf(content.id)).toEqual([]);
    dm({ kind: 'undo' } as never);
    expect(areaOf(content.id)).toEqual([{ q: 6, r: 0 }]);
  });

  it('merges the flushes of one drag into a single undo step', () => {
    const content = region('Forest of Wyrms');
    const depth = runtime.undoStack.length;
    // A drag flushes every ~180ms; each flush is its own command.
    dm({ kind: 'content.area', contentId: content.id, add: [{ q: 7, r: 0 }] } as never);
    dm({ kind: 'content.area', contentId: content.id, add: [{ q: 8, r: 0 }] } as never);
    dm({ kind: 'content.area', contentId: content.id, add: [{ q: 9, r: 0 }] } as never);
    expect(runtime.undoStack.length).toBe(depth + 1);
    dm({ kind: 'undo' } as never);
    expect(areaOf(content.id)).toEqual([{ q: 6, r: 0 }]);
  });

  it('keeps a different region on its own undo step', () => {
    const a = region('Forest of Wyrms');
    const b = region('Serpent Hills');
    dm({ kind: 'content.area', contentId: a.id, add: [{ q: 7, r: 0 }] } as never);
    dm({ kind: 'content.area', contentId: b.id, add: [{ q: 8, r: 0 }] } as never);
    dm({ kind: 'undo' } as never);
    expect(areaOf(b.id)).toEqual([{ q: 6, r: 0 }]);
    expect(areaOf(a.id)).toHaveLength(2);
  });

  it('is DM-only', () => {
    const content = region('Forest of Wyrms');
    const player = runtime.createSeat('player', 'Bob');
    expect(() =>
      asSeat(player, {
        kind: 'content.area',
        contentId: content.id,
        add: [{ q: 7, r: 0 }],
      } as never),
    ).toThrow(/DM/);
    expect(areaOf(content.id)).toEqual([{ q: 6, r: 0 }]);
  });
});
