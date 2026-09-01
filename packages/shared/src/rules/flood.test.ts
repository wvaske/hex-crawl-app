import { describe, expect, it } from 'vitest';
import { hexKey, hexRange, type HexCoord, type TerrainId } from '../index.js';
import { floodFill, floodFillByTerrain } from './flood.js';

/** Region auto-detect flood fill (issue #113). */

function keys(cells: HexCoord[]): Set<string> {
  return new Set(cells.map((c) => hexKey(c.q, c.r)));
}

function paint(cells: [number, number, TerrainId][]): Map<string, TerrainId> {
  return new Map(cells.map(([q, r, t]) => [hexKey(q, r), t]));
}

describe('floodFill', () => {
  it('always returns the anchor, even when nothing is acceptable', () => {
    const cells = floodFill({ anchor: { q: 3, r: -2 }, accept: () => false });
    expect(cells).toEqual([{ q: 3, r: -2 }]);
  });

  it('walks the six axial neighbours breadth-first', () => {
    const region = keys(hexRange({ q: 0, r: 0 }, 2));
    const cells = floodFill({
      anchor: { q: 0, r: 0 },
      accept: (h) => region.has(hexKey(h.q, h.r)),
    });
    expect(cells.length).toBe(19); // radius-2 disc
    expect(keys(cells)).toEqual(region);
  });

  it('does not leak across a gap', () => {
    // Two discs separated by an unaccepted ring: only the anchor's is found.
    const near = keys(hexRange({ q: 0, r: 0 }, 1));
    const far = keys(hexRange({ q: 6, r: 0 }, 1));
    const cells = floodFill({
      anchor: { q: 0, r: 0 },
      accept: (h) => near.has(hexKey(h.q, h.r)) || far.has(hexKey(h.q, h.r)),
    });
    expect(cells.length).toBe(7);
    expect(keys(cells)).toEqual(near);
  });

  it('caps at maxCells', () => {
    const cells = floodFill({ anchor: { q: 0, r: 0 }, accept: () => true, maxCells: 25 });
    expect(cells.length).toBe(25);
  });

  it('stops at the bounding radius', () => {
    const cells = floodFill({
      anchor: { q: 0, r: 0 },
      accept: () => true,
      maxCells: 100000,
      maxRadius: 3,
    });
    expect(cells.length).toBe(37); // radius-3 disc
    expect(keys(cells)).toEqual(keys(hexRange({ q: 0, r: 0 }, 3)));
  });
});

describe('floodFillByTerrain', () => {
  const terrain = paint([
    [0, 0, 'forest'],
    [1, 0, 'forest'],
    [2, 0, 'forest'],
    [1, -1, 'hills'],
    // (3,0) unpainted — the edge of the painted world
    [4, 0, 'forest'],
  ]);

  it('grows across matching terrain only', () => {
    const cells = floodFillByTerrain(terrain, { q: 0, r: 0 }, new Set<TerrainId>(['forest']));
    expect(keys(cells)).toEqual(new Set(['0,0', '1,0', '2,0']));
  });

  it('accepts every terrain in the set', () => {
    const cells = floodFillByTerrain(
      terrain,
      { q: 0, r: 0 },
      new Set<TerrainId>(['forest', 'hills']),
    );
    expect(keys(cells)).toEqual(new Set(['0,0', '1,0', '2,0', '1,-1']));
  });

  it('never crosses unpainted hexes', () => {
    const cells = floodFillByTerrain(terrain, { q: 0, r: 0 }, new Set<TerrainId>(['forest']));
    expect(keys(cells).has('4,0')).toBe(false);
  });

  it('returns just the anchor when its own terrain is not selected', () => {
    const cells = floodFillByTerrain(terrain, { q: 0, r: 0 }, new Set<TerrainId>(['swamp']));
    expect(cells).toEqual([{ q: 0, r: 0 }]);
  });
});
