import type { FogState, TerrainId, Trail, TravelPace } from '../domain.js';
import { hexDistance, hexKey, hexLine, type HexCoord } from '../hex/coords.js';
import { stepCost, type EdgeIndex, type StepCostOptions } from './edges.js';
import { findRoute } from './route.js';
import { PACE_MULTIPLIER, type TravelMedium, type TravelMode } from './time.js';

/**
 * Journey planning for things that move on their own (retinue markers,
 * roaming encounters): the shortest *legal* path to each waypoint, with a
 * preference for roads and, after that, for ground the party knows.
 *
 * Unlike a party move, a journey ignores fog — a courier does not need the
 * players to have explored the road. What it respects is the mode's medium
 * (a horse cannot cross open water, a ship cannot cross a plain, a griffon
 * crosses anything) and impassable edges.
 *
 * Costs are whole numbers because `findRoute`'s bucket queue needs them:
 *   road hex ........ 1
 *   known off-road .. 2   (fog explored or visible)
 *   unknown off-road  3
 * multiplied by the edge effort (1, difficult 2, very difficult 3). So a road
 * detour is taken when it is shorter than twice the straight walk, and known
 * ground is preferred to the fog when it costs less than half again as much.
 */

export const ROAD_STEP = 1;
export const KNOWN_STEP = 2;
export const UNKNOWN_STEP = 3;

export interface JourneyWorld {
  terrainAt: (hex: HexCoord) => TerrainId | undefined;
  fogAt: (hex: HexCoord) => FogState | undefined;
  /** Is this hex on a road (a `road` kind trail)? */
  roadAt: (hex: HexCoord) => boolean;
  edges: EdgeIndex;
}

/** Hexes a `road` trail covers, keyed for `roadAt`. */
export function roadIndex(trails: Iterable<Trail>): Set<string> {
  const set = new Set<string>();
  for (const t of trails) {
    if (t.kind !== 'road') continue;
    for (const c of t.cells) set.add(hexKey(c.q, c.r));
  }
  return set;
}

/** Can a mode of this medium enter a hex of this terrain? Unpainted hexes are open. */
export function mediumPassable(medium: TravelMedium, terrain: TerrainId | undefined): boolean {
  if (medium === 'air' || terrain === undefined) return true;
  if (medium === 'water') return terrain === 'water' || terrain === 'coast';
  return terrain !== 'water';
}

/** Step cost for a journey: road / known / unknown tier plus the edge extra. */
export function journeyStepCost(
  world: JourneyWorld,
  from: HexCoord,
  to: HexCoord,
  opts: StepCostOptions = {},
): number {
  const edge = stepCost(world.edges, from, to, opts);
  if (!(edge < Infinity)) return Infinity;
  let base = UNKNOWN_STEP;
  if (world.roadAt(from) && world.roadAt(to)) base = ROAD_STEP;
  else {
    const fog = world.fogAt(to);
    if (fog === 'explored' || fog === 'visible') base = KNOWN_STEP;
  }
  // `edge` is 1 + extra. The tier multiplies the whole step so a difficult
  // crossing stays as expensive *relative* to the walk as it is for a party
  // (a very difficult edge is still three ordinary steps).
  return base * edge;
}

/**
 * Hexes a mover will walk from `from` through each waypoint in order (the
 * start is not included). Each leg is the cheapest legal route; a leg with
 * no legal route at all (an island for a horse) falls back to the straight
 * line so the DM still gets *a* plan and can fix it, rather than nothing.
 */
export function planJourney(
  world: JourneyWorld,
  medium: TravelMedium,
  from: HexCoord,
  waypoints: HexCoord[],
  opts: { maxNodes?: number } = {},
): HexCoord[] {
  const route: HexCoord[] = [];
  let cur: HexCoord = { q: from.q, r: from.r };
  const passable = (h: HexCoord) => mediumPassable(medium, world.terrainAt(h));
  for (const wp of waypoints) {
    if (wp.q === cur.q && wp.r === cur.r) continue;
    let leg: HexCoord[] | null = null;
    if (hexDistance(cur, wp) > 0) {
      leg = findRoute(cur, wp, passable, {
        stepCost: (a, b) => journeyStepCost(world, a, b),
        maxNodes: opts.maxNodes,
      });
    }
    leg ??= hexLine(cur, wp);
    route.push(...leg.slice(1).map((h) => ({ q: h.q, r: h.r })));
    cur = { q: wp.q, r: wp.r };
  }
  return route;
}

/** Miles per hour for a mode at a pace. */
export function journeyMph(mode: TravelMode, pace: TravelPace): number {
  return mode.mph * PACE_MULTIPLIER[pace];
}
