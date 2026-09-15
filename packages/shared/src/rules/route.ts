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
  /** Hard cap on hexes expanded before giving up. Default 250000. */
  maxNodes?: number;
}

/**
 * Expansion budget. A* on open ground expands roughly the corridor between
 * the two ends, so even a 200-hex trip across a fully revealed map stays in
 * the low thousands; the cap only bites when the goal is truly walled off
 * behind a huge explored area.
 */
export const ROUTE_MAX_NODES = 250000;

/**
 * Shortest passable path from `from` to `to`, inclusive of both, or null
 * when the destination cannot be reached through passable hexes. A route
 * from a hex to itself is `[from]`.
 *
 * A* with the hex distance as its (exact-on-open-ground) heuristic. Uniform
 * step cost means f = g + h is an integer, so the open set is a bucket
 * queue indexed by f — no heap, O(1) push/pop.
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
  const startKey = hexKey(start.q, start.r);

  const cameFrom = new Map<string, string | null>([[startKey, null]]);
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();
  // Bucket queue: buckets[f] holds hexes whose f = g + h equals that index.
  const buckets: HexCoord[][] = [];
  const push = (hex: HexCoord, f: number) => {
    (buckets[f] ??= []).push(hex);
  };
  push(start, hexDistance(start, goal));
  let f = hexDistance(start, goal);
  let expanded = 0;

  for (;;) {
    while (f < buckets.length && (!buckets[f] || buckets[f]!.length === 0)) f++;
    if (f >= buckets.length) return null;
    const hex = buckets[f]!.pop()!;
    const key = hexKey(hex.q, hex.r);
    if (closed.has(key)) continue;
    // A stale queue entry (the hex was later reached more cheaply) would
    // have a larger f than its real one; with an admissible heuristic the
    // real entry is popped first, so the closed check above suffices.
    closed.add(key);
    if (key === goalKey) return unwind(cameFrom, goalKey);
    if (++expanded > maxNodes) return null;
    const g = gScore.get(key)!;
    // Neighbours ordered so that among equally short routes the walk heads
    // straight for the goal — a road, not a zig-zag along the fog's edge.
    const next = hexNeighbors(hex).sort((a, b) => hexDistance(a, goal) - hexDistance(b, goal));
    for (const n of next) {
      const nKey = hexKey(n.q, n.r);
      if (closed.has(nKey)) continue;
      if (nKey !== goalKey && !passable(n)) continue;
      const tentative = g + 1;
      const known = gScore.get(nKey);
      if (known !== undefined && known <= tentative) continue;
      gScore.set(nKey, tentative);
      cameFrom.set(nKey, key);
      const nf = tentative + hexDistance(n, goal);
      push(n, nf);
      if (nf < f) f = nf;
    }
  }
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
