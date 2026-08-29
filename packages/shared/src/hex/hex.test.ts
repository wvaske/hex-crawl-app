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
