import { hexDistance, hexKey, hexNeighbors, type HexCoord } from '../hex/coords.js';

/**
 * Routing through known ground (issue #130).
 *
 * A party that has already explored the road between two towns should be
 * able to travel it in one go, and the trip should follow that road — not a
 * straight line through unexplored mountains. `findRoute` is a plain
 * breadth-first search over the six neighbours with a pluggable `passable`
 * predicate; on the server that predicate is "fog is explored or visible",
 * on the client it is the same test over the fog cells a viewer can see.
 *
 * Uniform cost by design: there is no terrain speed yet, so the shortest
 * route by hex count is the fastest. Both ends count — the destination has to
 * be passable too, or there is no route (the start is always allowed: you are
 * standing on it).
 *
 * The search is bounded by `maxNodes` so a huge explored map cannot make one
 * hover computation expensive; a route beyond that budget reads as "none".
 */
export interface RouteOptions {
  /** Hard cap on hexes expanded before giving up. Default 20000. */
  maxNodes?: number;
}

export const ROUTE_MAX_NODES = 20000;

/**
 * Shortest passable path from `from` to `to`, inclusive of both, or null
 * when the destination cannot be reached through passable hexes. A route
 * from a hex to itself is `[from]`.
 */
export function findRoute(
  from: HexCoord,
  to: HexCoord,
  passable: (hex: HexCoord) => boolean,
  opts: RouteOptions = {},
): HexCoord[] | null {
  const start = { q: from.q, r: from.r };
  const goal = { q: to.q, r: to.r };
  if (start.q === goal.q && start.r === goal.r) return [start];
  if (!passable(goal)) return null;
  const maxNodes = Math.max(1, opts.maxNodes ?? ROUTE_MAX_NODES);
  const goalKey = hexKey(goal.q, goal.r);
  const cameFrom = new Map<string, string | null>([[hexKey(start.q, start.r), null]]);
  const queue: HexCoord[] = [start];
  let head = 0;
  let expanded = 0;
  while (head < queue.length) {
    const hex = queue[head++]!;
    if (++expanded > maxNodes) return null;
    // Neighbours ordered by straight-line distance to the goal, so among
    // equally short routes the walk prefers the one that heads there
    // directly — a road, not a zig-zag along the fog's edge.
    const next = hexNeighbors(hex).sort((a, b) => hexDistance(a, goal) - hexDistance(b, goal));
    for (const n of next) {
      const key = hexKey(n.q, n.r);
      if (cameFrom.has(key)) continue;
      if (key !== goalKey && !passable(n)) continue;
      cameFrom.set(key, hexKey(hex.q, hex.r));
      if (key === goalKey) return unwind(cameFrom, goalKey);
      queue.push(n);
    }
  }
  return null;
}

function unwind(cameFrom: Map<string, string | null>, endKey: string): HexCoord[] {
  const path: HexCoord[] = [];
  let key: string | null = endKey;
  while (key !== null) {
    const idx = key.indexOf(',');
    path.push({ q: Number(key.slice(0, idx)), r: Number(key.slice(idx + 1)) });
    key = cameFrom.get(key) ?? null;
  }
  return path.reverse();
}

/**
 * The predicate for "known ground": explored or visible fog. Hidden cells
 * (absent from the map) are not routable — a route exists only when every
 * connecting hex has been explored.
 */
export function exploredPassable(
  fogAt: (hex: HexCoord) => 'hidden' | 'explored' | 'visible' | undefined,
): (hex: HexCoord) => boolean {
  return (hex) => {
    const state = fogAt(hex);
    return state === 'explored' || state === 'visible';
  };
}
