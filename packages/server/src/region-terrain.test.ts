import { beforeEach, describe, expect, it } from 'vitest';
import { hexKey, seededRng } from '@hexcrawl/shared';
import type { ClientCommand, Content, TerrainId } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * `content.applyTerrain` (issue #113): one terrain across a region's whole
 * footprint, with the overlap policy that makes it usable — by default the
 * hexes another region already claims are left alone.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `t${cmdCounter++}` } as ClientCommand, {
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
  const created = store.createCampaign('Fill', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

function mapId(): string {
  return runtime.campaign.activeMapId!;
}

/** A region anchored at `anchor` covering the given extra hexes. */
function region(title: string, anchor: [number, number], area: [number, number][]): Content {
  dm({
    kind: 'content.upsert',
    content: {
      id: null,
      mapId: mapId(),
      q: anchor[0],
      r: anchor[1],
      area: area.map(([q, r]) => ({ q, r })),
      type: 'region',
      title,
      dmNotes: '',
      glyph: '',
      clues: [],
    },
  } as never);
  return [...runtime.requireMap(mapId()).contents.values()].find((c) => c.title === title)!;
}

function terrainAt(q: number, r: number): TerrainId | undefined {
  return runtime.requireMap(mapId()).hexes.get(hexKey(q, r));
}

function lastNote(): string {
  return [...runtime.log].reverse().find((e) => e.kind === 'note')?.text ?? '';
}

describe('content.applyTerrain', () => {
  it('paints the whole footprint, anchor included', () => {
    const wood = region('Greenwood', [0, 0], [
      [1, 0],
      [2, 0],
    ]);
    dm({ kind: 'content.applyTerrain', contentId: wood.id, terrain: 'forest' } as never);
    expect(terrainAt(0, 0)).toBe('forest');
    expect(terrainAt(1, 0)).toBe('forest');
    expect(terrainAt(2, 0)).toBe('forest');
    expect(lastNote()).toBe('Painted forest across Greenwood — 3 hexes');
  });

  it('skips hexes claimed by another region by default, and reports the count', () => {
    const wood = region('Greenwood', [0, 0], [
      [1, 0],
      [2, 0],
    ]);
    region('Bog', [2, 0], [[3, 0]]);
    dm({ kind: 'content.applyTerrain', contentId: wood.id, terrain: 'forest' } as never);
    expect(terrainAt(0, 0)).toBe('forest');
    expect(terrainAt(1, 0)).toBe('forest');
    expect(terrainAt(2, 0)).toBeUndefined(); // the Bog's anchor, left alone
    expect(lastNote()).toBe(
      'Painted forest across Greenwood — 2 hexes (1 skipped in other regions)',
    );
  });

  it('does not treat an anchor-only pin as a region', () => {
    const wood = region('Greenwood', [0, 0], [[1, 0]]);
    region('Old Mill', [1, 0], []); // a plain pin inside the wood
    dm({ kind: 'content.applyTerrain', contentId: wood.id, terrain: 'forest' } as never);
    expect(terrainAt(1, 0)).toBe('forest');
    expect(lastNote()).toBe('Painted forest across Greenwood — 2 hexes');
  });

  it('overwrites overlapping cells when skipOtherRegions is false', () => {
    const wood = region('Greenwood', [0, 0], [
      [1, 0],
      [2, 0],
    ]);
    region('Bog', [2, 0], [[3, 0]]);
    dm({
      kind: 'content.applyTerrain',
      contentId: wood.id,
      terrain: 'forest',
      skipOtherRegions: false,
    } as never);
    expect(terrainAt(2, 0)).toBe('forest');
    expect(terrainAt(3, 0)).toBeUndefined(); // never in the Greenwood's footprint
    expect(lastNote()).toBe('Painted forest across Greenwood — 3 hexes');
  });

  it('erases with a null terrain', () => {
    const wood = region('Greenwood', [0, 0], [[1, 0]]);
    dm({ kind: 'terrain.paint', mapId: mapId(), cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], terrain: 'swamp' } as never);
    expect(terrainAt(0, 0)).toBe('swamp');
    dm({ kind: 'content.applyTerrain', contentId: wood.id, terrain: null } as never);
    expect(terrainAt(0, 0)).toBeUndefined();
    expect(terrainAt(1, 0)).toBeUndefined();
    expect(lastNote()).toBe('Erased terrain across Greenwood — 2 hexes');
  });

  it('is undoable back to the prior terrain', () => {
    const wood = region('Greenwood', [0, 0], [[1, 0]]);
    dm({ kind: 'terrain.paint', mapId: mapId(), cells: [{ q: 0, r: 0 }], terrain: 'plains' } as never);
    // The undo window merges consecutive terrain edits, so step off it first.
    const top = runtime.undoStack[runtime.undoStack.length - 1];
    if (top) top.at -= 10_000;
    dm({ kind: 'content.applyTerrain', contentId: wood.id, terrain: 'forest' } as never);
    expect(terrainAt(0, 0)).toBe('forest');
    expect(terrainAt(1, 0)).toBe('forest');
    dm({ kind: 'undo' } as never);
    expect(terrainAt(0, 0)).toBe('plains');
    expect(terrainAt(1, 0)).toBeUndefined();
  });

  it('is DM-only', () => {
    const wood = region('Greenwood', [0, 0], [[1, 0]]);
    const player = runtime.createSeat('player', 'Bob');
    expect(() =>
      asSeat(player, {
        kind: 'content.applyTerrain',
        contentId: wood.id,
        terrain: 'forest',
      } as never),
    ).toThrow(/Only the DM/);
    expect(terrainAt(0, 0)).toBeUndefined();
  });

  it('rejects an unknown content id', () => {
    expect(() =>
      dm({ kind: 'content.applyTerrain', contentId: 'nope', terrain: 'forest' } as never),
    ).toThrow(/not found/i);
  });
});
