import type { HexCoord, MapInfo, Retinue, Token } from '@hexcrawl/shared';
import {
  DEFAULT_NPC_MPH,
  exploredPassable,
  findRoute,
  hexDistance,
  hexKey,
  hexLine,
  minutesPerHex,
  stepCost,
  travelWindowMinutes,
} from '@hexcrawl/shared';
import type { CampaignRuntime } from '../state/runtime.js';

/**
 * NPC travellers (retinue markers): tokens with a planned `route` advance
 * along it as the campaign clock runs. The party's own moves are the usual
 * tick — every time the players travel, the clock moves and so do the NPCs —
 * but any clock advance counts, so a "camp till dawn" moves a courier too.
 *
 * Distance is banked in clock minutes: `travelCredit` accumulates the minutes
 * inside the daily travel window (`travelWindowMinutes`), and each hex of the
 * route is bought at `minutesPerHex(map.milesPerHex, speed)` times the edge
 * step cost. Speed is the token's own `mph`, else the retinue's, else on foot.
 */

export interface TravellerMove {
  tokenId: string;
  mapId: string;
  label: string;
  from: HexCoord;
  to: HexCoord;
  /** Route and credit as they stood before the advance — what undo restores. */
  routeBefore: HexCoord[];
  creditBefore: number;
  /** The route is finished: the token stands at its destination. */
  arrived: boolean;
}

export function retinueOf(runtime: CampaignRuntime, token: Token): Retinue | null {
  if (!token.retinueId) return null;
  return runtime.campaign.settings.retinues.find((r) => r.id === token.retinueId) ?? null;
}

/** Travel speed in miles per hour for an NPC token. */
export function travellerSpeed(runtime: CampaignRuntime, token: Token): number {
  if (token.mph && token.mph > 0) return token.mph;
  const retinue = retinueOf(runtime, token);
  if (retinue?.mph && retinue.mph > 0) return retinue.mph;
  return DEFAULT_NPC_MPH;
}

/** How a DM pays for routing an NPC over an impassable edge: same as a party. */
const WALKED = { impassableAs: 3 };

/**
 * Advance every routed token for a clock move from `fromMinutes` to
 * `toMinutes`. Mutates the runtime (write-through) and returns one record per
 * token that moved, for the caller's log line and undo entry. Tokens whose
 * route is empty are untouched; a token that reaches the end of its route has
 * its credit zeroed so idle time never banks toward a journey not yet planned.
 */
export function advanceTravellers(
  runtime: CampaignRuntime,
  fromMinutes: number,
  toMinutes: number,
): TravellerMove[] {
  const settings = runtime.campaign.settings;
  const banked = travelWindowMinutes(fromMinutes, toMinutes, settings);
  const moves: TravellerMove[] = [];
  if (banked <= 0) return moves;
  for (const [mapId, rt] of runtime.mapStates) {
    const map = runtime.maps.get(mapId);
    if (!map) continue;
    for (const token of [...rt.tokens.values()]) {
      if (token.kind !== 'npc' || token.route.length === 0) continue;
      const perHex = minutesPerHex(map.milesPerHex, travellerSpeed(runtime, token));
      if (!(perHex > 0)) continue;
      const routeBefore = token.route.map((h) => ({ q: h.q, r: h.r }));
      const creditBefore = token.travelCredit;
      let credit = creditBefore + banked;
      let cur: HexCoord = { q: token.q, r: token.r };
      const remaining = [...routeBefore];
      let stepped = 0;
      while (remaining.length) {
        const next = remaining[0]!;
        const cost = perHex * stepCost(rt.edges, cur, next, WALKED);
        if (credit < cost) break;
        credit -= cost;
        cur = next;
        remaining.shift();
        stepped++;
      }
      const arrived = remaining.length === 0;
      if (stepped === 0 && !arrived) {
        // Nothing crossed yet: just bank the minutes toward the next hex.
        runtime.updateToken(mapId, token.id, { travelCredit: credit });
        continue;
      }
      runtime.updateToken(mapId, token.id, {
        q: cur.q,
        r: cur.r,
        route: remaining,
        travelCredit: arrived ? 0 : credit,
      });
      if (stepped > 0) {
        moves.push({
          tokenId: token.id,
          mapId,
          label: token.label || 'traveller',
          from: { q: token.q, r: token.r },
          to: cur,
          routeBefore,
          creditBefore,
          arrived,
        });
      }
    }
  }
  return moves;
}

/** Put travellers back where an advance found them (undo). */
export function restoreTravellers(runtime: CampaignRuntime, moves: TravellerMove[]): void {
  for (const m of moves) {
    if (!runtime.findToken(m.tokenId)) continue;
    runtime.updateToken(m.mapId, m.tokenId, {
      q: m.from.q,
      r: m.from.r,
      route: m.routeBefore,
      travelCredit: m.creditBefore,
    });
  }
}

/**
 * Minutes of travel-window time still needed for a token to finish its route
 * (for the ETA shown to the DM). Null when the token has no route.
 */
export function routeMinutesLeft(
  runtime: CampaignRuntime,
  token: Token,
): number | null {
  if (token.route.length === 0) return null;
  const rt = runtime.mapStates.get(token.mapId);
  const map = runtime.maps.get(token.mapId);
  if (!rt || !map) return null;
  const perHex = minutesPerHex(map.milesPerHex, travellerSpeed(runtime, token));
  let cur: HexCoord = { q: token.q, r: token.r };
  let total = 0;
  for (const next of token.route) {
    total += perHex * stepCost(rt.edges, cur, next, WALKED);
    cur = next;
  }
  return Math.max(0, total - token.travelCredit);
}

/**
 * String waypoints into the hexes an NPC will walk, using the party's own
 * routing: through explored ground when the map routes that way and a route
 * exists, the straight line otherwise. The token's current hex is not part of
 * the result; a waypoint equal to the current position is skipped.
 */
export function planRoute(
  runtime: CampaignRuntime,
  map: MapInfo,
  from: HexCoord,
  waypoints: HexCoord[],
): HexCoord[] {
  const rt = runtime.mapStates.get(map.id);
  const route: HexCoord[] = [];
  let cur: HexCoord = { q: from.q, r: from.r };
  for (const wp of waypoints) {
    if (wp.q === cur.q && wp.r === cur.r) continue;
    let leg: HexCoord[] | null = null;
    if (rt && map.routeExplored && hexDistance(cur, wp) > 1) {
      leg = findRoute(cur, wp, exploredPassable((h) => rt.fog.get(hexKey(h.q, h.r))), {
        stepCost: (a, b) => stepCost(rt.edges, a, b),
      });
    }
    leg ??= hexLine(cur, wp);
    route.push(...leg.slice(1).map((h) => ({ q: h.q, r: h.r })));
    cur = { q: wp.q, r: wp.r };
  }
  return route;
}
