import type { HexCoord } from '@hex-crawl/shared';

/**
 * Flat-top hex neighbor direction offsets (axial coordinates).
 * Order: E, NE, NW, W, SW, SE
 */
const FLAT_TOP_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 },   // East
  { q: 1, r: -1 },  // Northeast
  { q: 0, r: -1 },  // Northwest
  { q: -1, r: 0 },  // West
  { q: -1, r: 1 },  // Southwest
  { q: 0, r: 1 },   // Southeast
] as const;

/** Get the 6 neighbor axial coordinates for a flat-top hex */
export function getNeighborCoords(q: number, r: number): HexCoord[] {
  return FLAT_TOP_DIRECTIONS.map((dir) => ({
    q: q + dir.q,
    r: r + dir.r,
  }));
}

/**
 * Calculate the distance between two hexes using cube distance formula.
 * distance = max(|dq|, |dr|, |ds|) where s = -q - r
 */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = Math.abs(a.q - b.q);
  const dr = Math.abs(a.r - b.r);
  const ds = Math.abs((-a.q - a.r) - (-b.q - b.r));
  return Math.max(dq, dr, ds);
}
