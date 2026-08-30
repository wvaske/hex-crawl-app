import { describe, expect, it } from 'vitest';
import {
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbors,
  hexRange,
  hexRing,
  hexRound,
  parseHexKey,
} from './coords.js';
import { hexCorners, hexToPixel, pixelToHex, type HexLayout } from './layout.js';
import {
  SUPER_SCALE,
  clusterIndex,
  fineToIndex,
  superCenter,
  superCornerOffsets,
  superMembers,
  superMembersOf,
} from './super.js';

describe('hex keys', () => {
  it('round-trips', () => {
    expect(parseHexKey(hexKey(3, -7))).toEqual({ q: 3, r: -7 });
    expect(parseHexKey(hexKey(0, 0))).toEqual({ q: 0, r: 0 });
    expect(parseHexKey(hexKey(-12, 5))).toEqual({ q: -12, r: 5 });
  });
});

describe('neighbors and distance', () => {
  it('every hex has 6 distinct neighbors at distance 1', () => {
    const n = hexNeighbors({ q: 2, r: -1 });
    expect(n).toHaveLength(6);
    expect(new Set(n.map((h) => hexKey(h.q, h.r))).size).toBe(6);
    for (const h of n) expect(hexDistance({ q: 2, r: -1 }, h)).toBe(1);
  });

  it('distance is symmetric and satisfies known values', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(hexDistance({ q: -2, r: 1 }, { q: 4, r: -1 })).toBe(6);
    expect(hexDistance({ q: 4, r: -1 }, { q: -2, r: 1 })).toBe(6);
  });
});

describe('ring and range', () => {
  it('ring sizes are 6*radius', () => {
    const center = { q: 1, r: 1 };
    expect(hexRing(center, 0)).toEqual([center]);
    expect(hexRing(center, 1)).toHaveLength(6);
    expect(hexRing(center, 3)).toHaveLength(18);
    for (const h of hexRing(center, 3)) expect(hexDistance(center, h)).toBe(3);
  });

  it('range contains 1 + 3r(r+1) hexes, all within radius', () => {
    const center = { q: -2, r: 3 };
    for (const radius of [0, 1, 2, 4]) {
      const cells = hexRange(center, radius);
      expect(cells).toHaveLength(1 + 3 * radius * (radius + 1));
      for (const h of cells) expect(hexDistance(center, h)).toBeLessThanOrEqual(radius);
    }
  });
});

describe('rounding and lines', () => {
  it('rounds exact coordinates to themselves', () => {
    expect(hexRound(2, -3)).toEqual({ q: 2, r: -3 });
  });

  it('line endpoints match and consecutive cells are adjacent', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 5, r: -3 };
    const line = hexLine(a, b);
    expect(line[0]).toEqual(a);
    expect(line[line.length - 1]).toEqual(b);
    for (let i = 1; i < line.length; i++) {
      expect(hexDistance(line[i - 1]!, line[i]!)).toBe(1);
    }
  });
});

describe('layout pixel conversion', () => {
  const layouts: HexLayout[] = [
    { orientation: 'pointy', size: 40, origin: { x: 0, y: 0 } },
    { orientation: 'flat', size: 48, origin: { x: 100, y: -50 } },
  ];

  it('hexToPixel/pixelToHex round-trip over a grid', () => {
    for (const layout of layouts) {
      for (let q = -5; q <= 5; q++) {
        for (let r = -5; r <= 5; r++) {
          const px = hexToPixel(layout, { q, r });
          expect(pixelToHex(layout, px)).toEqual({ q, r });
          // Also a point nudged off-center stays in the same hex.
          expect(pixelToHex(layout, { x: px.x + layout.size * 0.3, y: px.y })).toEqual({ q, r });
        }
      }
    }
  });

  it('corners are equidistant from center', () => {
    for (const layout of layouts) {
      const corners = hexCorners(layout, { q: 2, r: 1 });
      const center = hexToPixel(layout, { q: 2, r: 1 });
      expect(corners).toHaveLength(6);
      for (const c of corners) {
        const d = Math.hypot(c.x - center.x, c.y - center.y);
        expect(d).toBeCloseTo(layout.size, 6);
      }
    }
  });
});

describe('7-hex superclusters', () => {
  it('every hex belongs to exactly one cluster whose center is within distance 1', () => {
    for (let q = -12; q <= 12; q++) {
      for (let r = -12; r <= 12; r++) {
        const c = superCenter({ q, r }, 1);
        expect(hexDistance({ q, r }, c)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clusters partition the plane into cells of exactly 7', () => {
    const byCluster = new Map<string, number>();
    for (let q = -20; q <= 20; q++) {
      for (let r = -20; r <= 20; r++) {
        const idx = clusterIndex({ q, r });
        const key = `${idx.q},${idx.r}`;
        byCluster.set(key, (byCluster.get(key) ?? 0) + 1);
      }
    }
    // Interior clusters (away from the scan edge) must have exactly 7 members.
    for (const [key, count] of byCluster) {
      const [i, r] = key.split(',').map(Number);
      const center = superCenter({ q: 2 * i! - r!, r: i! + 3 * r! }, 0);
      if (Math.abs(center.q) <= 12 && Math.abs(center.r) <= 12) {
        expect(count).toBe(7);
      }
    }
  });

  it('superMembers returns 7 at level 1 and 49 at level 2, consistent with membership', () => {
    const h = { q: 5, r: -3 };
    const idx1 = fineToIndex(h, 1);
    const members1 = superMembers(idx1, 1);
    expect(members1).toHaveLength(7);
    expect(members1.some((m) => m.q === h.q && m.r === h.r)).toBe(true);
    for (const m of members1) {
      expect(fineToIndex(m, 1)).toEqual(idx1);
    }
    const members2 = superMembersOf(h, 2);
    expect(members2).toHaveLength(49);
    const idx2 = fineToIndex(h, 2);
    for (const m of members2) {
      expect(fineToIndex(m, 2)).toEqual(idx2);
    }
  });

  it('level-2 centers agree between chain and direct computation', () => {
    for (let q = -9; q <= 9; q += 3) {
      for (let r = -9; r <= 9; r += 3) {
        const c2 = superCenter({ q, r }, 2);
        // The level-2 center must itself be in the same level-2 cell.
        expect(fineToIndex(c2, 2)).toEqual(fineToIndex({ q, r }, 2));
      }
    }
  });

  it('corner offsets scale by sqrt(7) per level', () => {
    const layout = { orientation: 'flat' as const, size: 12, origin: { x: 0, y: 0 } };
    const c1 = superCornerOffsets(layout, 1);
    const r1 = Math.hypot(c1[0]!.x, c1[0]!.y);
    expect(r1).toBeCloseTo(12 * SUPER_SCALE, 6);
    const c2 = superCornerOffsets(layout, 2);
    expect(Math.hypot(c2[0]!.x, c2[0]!.y)).toBeCloseTo(12 * 7, 6);
  });
});
