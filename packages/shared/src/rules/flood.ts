import { hexDistance, hexKey, hexNeighbors, type HexCoord } from '../hex/coords.js';
import type { TerrainId } from '../domain.js';

/**
 * Region auto-detect (issue #113): a contiguous hex flood fill from an anchor.
 *
 * The client's two detection modes (terrain match, map-image colour match)
 * differ only in what they accept, so the traversal itself lives here as a
 * pure function with an `accept` predicate — and is unit-tested, which the
 * client (no test runner) could not be.
 *
 * Two invariants worth knowing:
 * - the anchor is ALWAYS in the result, whether or not it passes `accept`;
 *   it is the region's home hex by definition, and the fill grows from it.
 * - the walk is bounded twice — by `maxCells` and by a ring radius — because
 *   a loose colour tolerance on flat art would otherwise walk the plane.
 */
export interface FloodOptions {
  anchor: HexCoord;
  /** Called at most once per candidate hex; the anchor is never asked. */
  accept: (hex: HexCoord) => boolean;
  /** Hard cap on the returned cells, anchor included. Default 3000. */
  maxCells?: number;
  /** Hard stop at this hex distance from the anchor. Default 60. */
  maxRadius?: number;
}

export const FLOOD_MAX_CELLS = 3000;
export const FLOOD_MAX_RADIUS = 60;

/** Breadth-first flood fill over the six axial neighbours. Anchor first. */
export function floodFill(opts: FloodOptions): HexCoord[] {
  const maxCells = Math.max(1, opts.maxCells ?? FLOOD_MAX_CELLS);
  const maxRadius = Math.max(0, opts.maxRadius ?? FLOOD_MAX_RADIUS);
  const anchor = { q: opts.anchor.q, r: opts.anchor.r };
  const out: HexCoord[] = [anchor];
  const seen = new Set<string>([hexKey(anchor.q, anchor.r)]);
  const queue: HexCoord[] = [anchor];
  let head = 0;
  while (head < queue.length && out.length < maxCells) {
    const hex = queue[head++]!;
    for (const next of hexNeighbors(hex)) {
      const key = hexKey(next.q, next.r);
      if (seen.has(key)) continue;
      seen.add(key);
      if (hexDistance(anchor, next) > maxRadius) continue;
      if (!opts.accept(next)) continue;
      out.push(next);
      queue.push(next);
      if (out.length >= maxCells) break;
    }
  }
  return out;
}

/**
 * Terrain-match detection: grow from the anchor across hexes whose PAINTED
 * terrain is in `terrains`. Unpainted hexes are never accepted — an empty
 * hex is not "the same terrain", it's the edge of the painted world.
 */
export function floodFillByTerrain(
  terrainAt: ReadonlyMap<string, TerrainId>,
  anchor: HexCoord,
  terrains: ReadonlySet<TerrainId>,
  opts: { maxCells?: number; maxRadius?: number } = {},
): HexCoord[] {
  return floodFill({
    anchor,
    accept: (hex) => {
      const terrain = terrainAt.get(hexKey(hex.q, hex.r));
      return terrain !== undefined && terrains.has(terrain);
    },
    maxCells: opts.maxCells,
    maxRadius: opts.maxRadius,
  });
}
