import { describe, expect, it } from 'vitest';
import { hexKey, hexLine, type HexCoord } from '../hex/coords.js';
import { exploredPassable, findRoute } from './route.js';

function passableSet(cells: HexCoord[]): (hex: HexCoord) => boolean {
  const keys = new Set(cells.map((c) => hexKey(c.q, c.r)));
  return (hex) => keys.has(hexKey(hex.q, hex.r));
}

describe('findRoute', () => {
  it('walks a straight explored line', () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 4, r: 0 });
    const route = findRoute({ q: 0, r: 0 }, { q: 4, r: 0 }, passableSet(line));
    expect(route).toEqual(line);
  });

  it('follows the explored road around unexplored ground', () => {
    // An L-shaped road: east along r=0, then "south" along q=3.
    const road = [
      ...hexLine({ q: 0, r: 0 }, { q: 3, r: 0 }),
      ...hexLine({ q: 3, r: 0 }, { q: 3, r: 3 }),
    ];
    const route = findRoute({ q: 0, r: 0 }, { q: 3, r: 3 }, passableSet(road))!;
    expect(route).not.toBeNull();
    expect(route[0]).toEqual({ q: 0, r: 0 });
    expect(route[route.length - 1]).toEqual({ q: 3, r: 3 });
    // Every step is a neighbour of the last and lies on the road.
    const onRoad = passableSet(road);
    for (let i = 1; i < route.length; i++) {
      expect(onRoad(route[i]!)).toBe(true);
    }
    expect(route.length).toBe(7); // 3 east + 3 south, plus the start
  });

  it('is null when a gap of unexplored hexes breaks the road', () => {
    const road = hexLine({ q: 0, r: 0 }, { q: 5, r: 0 }).filter((h) => h.q !== 3);
    expect(findRoute({ q: 0, r: 0 }, { q: 5, r: 0 }, passableSet(road))).toBeNull();
  });

  it('is null when the destination itself is unexplored, and trivial for no move', () => {
    const road = hexLine({ q: 0, r: 0 }, { q: 2, r: 0 });
    expect(findRoute({ q: 0, r: 0 }, { q: 3, r: 0 }, passableSet(road))).toBeNull();
    expect(findRoute({ q: 1, r: 1 }, { q: 1, r: 1 }, () => false)).toEqual([{ q: 1, r: 1 }]);
  });

  it('does not need the start hex to be passable', () => {
    const road = hexLine({ q: 1, r: 0 }, { q: 3, r: 0 });
    const route = findRoute({ q: 0, r: 0 }, { q: 3, r: 0 }, passableSet(road));
    expect(route?.length).toBe(4);
  });

  it('gives up within the node budget', () => {
    expect(findRoute({ q: 0, r: 0 }, { q: 50, r: 0 }, () => true, { maxNodes: 20 })).toBeNull();
  });
});

describe('exploredPassable', () => {
  it('treats explored and visible as known ground, hidden and unknown as not', () => {
    const fog = new Map<string, 'hidden' | 'explored' | 'visible'>([
      ['0,0', 'visible'],
      ['1,0', 'explored'],
      ['2,0', 'hidden'],
    ]);
    const passable = exploredPassable((h) => fog.get(hexKey(h.q, h.r)));
    expect(passable({ q: 0, r: 0 })).toBe(true);
    expect(passable({ q: 1, r: 0 })).toBe(true);
    expect(passable({ q: 2, r: 0 })).toBe(false);
    expect(passable({ q: 9, r: 9 })).toBe(false);
  });
});
