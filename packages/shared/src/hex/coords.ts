/**
 * Axial hex coordinates (q, r) with cube math where needed.
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

export interface HexCoord {
  q: number;
  r: number;
}

export type HexKey = string;

export function hexKey(q: number, r: number): HexKey {
  return `${q},${r}`;
}

export function parseHexKey(key: HexKey): HexCoord {
  const idx = key.indexOf(',');
  return { q: Number(key.slice(0, idx)), r: Number(key.slice(idx + 1)) };
}

export function hexEquals(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: HexCoord, b: HexCoord): HexCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexScale(a: HexCoord, k: number): HexCoord {
  return { q: a.q * k, r: a.r * k };
}

/** The six axial direction vectors, counter-clockwise from "east". */
export const HEX_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexNeighbor(hex: HexCoord, direction: number): HexCoord {
  const d = HEX_DIRECTIONS[((direction % 6) + 6) % 6]!;
  return hexAdd(hex, d);
}

export function hexNeighbors(hex: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map((d) => hexAdd(hex, d));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** All hexes at exactly `radius` from center (radius >= 1). */
export function hexRing(center: HexCoord, radius: number): HexCoord[] {
  if (radius <= 0) return radius === 0 ? [center] : [];
  const results: HexCoord[] = [];
  let hex = hexAdd(center, hexScale(HEX_DIRECTIONS[4]!, radius));
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(hex);
      hex = hexNeighbor(hex, side);
    }
  }
  return results;
}

/** All hexes within `radius` of center, inclusive. */
export function hexRange(center: HexCoord, radius: number): HexCoord[] {
  const results: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      results.push({ q: center.q + q, r: center.r + r });
    }
  }
  return results;
}

/** Round fractional axial coordinates to the nearest hex. */
export function hexRound(fq: number, fr: number): HexCoord {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) {
    q = -r - s;
  } else if (dr > ds) {
    r = -q - s;
  }
  // Math.round can produce -0; normalize so keys and equality behave.
  return { q: q + 0 === 0 ? 0 : q, r: r + 0 === 0 ? 0 : r };
}

/** Hexes forming a line from a to b, inclusive. */
export function hexLine(a: HexCoord, b: HexCoord): HexCoord[] {
  const n = hexDistance(a, b);
  if (n === 0) return [a];
  const results: HexCoord[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Nudge to avoid landing exactly on edges.
    const fq = a.q + (b.q - a.q) * t + 1e-6;
    const fr = a.r + (b.r - a.r) * t + 1e-6;
    results.push(hexRound(fq, fr));
  }
  return results;
}
