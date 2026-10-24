import type { Content, HexCoord, MapInfo, Retinue, Token, Trail, TrailDiscovery, TravelPace } from '@hexcrawl/shared';
import { nanoid } from 'nanoid';
import {
  MINUTES_PER_DAY,
  hexKey,
  journeyMph,
  minutesPerHex,
  planJourney,
  resolveTravelMode,
  roadIndex,
  stepCost,
  travelWindowMinutes,
  type TravelMode,
} from '@hexcrawl/shared';
import type { Rng } from '@hexcrawl/shared';
import type { CampaignRuntime } from '../state/runtime.js';
import { rollEncounter, type EncounterResult } from './encounters.js';

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
  encounterMilesBefore: number;
  /** The route is finished: the token stands at its destination. */
  arrived: boolean;
  /** A looping route reached its end and was planned again through its waypoints. */
  looped: boolean;
  /** Encounter rolls made along the way (every `encounterEveryMiles`). */
  encounters: { q: number; r: number; result: EncounterResult }[];
  /** Its tracks trail before this tick (null: none existed — undo deletes it). */
  trailBefore: Trail | null;
  /** Whether tracks were laid this tick (so undo knows to touch the trail). */
  laidTracks: boolean;
  /** The attached presence content before it followed the mover. */
  contentBefore: Content | null;
}

/** A tracks trail before expired cells were pruned, with the finds on it. */
export interface TrackPrune {
  trail: Trail;
  discoveries: TrailDiscovery[];
}

/** Everything one clock advance did to movers, for one undo entry. */
export interface TravellerTick {
  moves: TravellerMove[];
  prunes: TrackPrune[];
}

/** The id of the tracks trail a mover lays. */
export function tracksTrailId(tokenId: string): string {
  return `tracks:${tokenId}`;
}

export function retinueOf(runtime: CampaignRuntime, token: Token): Retinue | null {
  if (!token.retinueId) return null;
  return runtime.campaign.settings.retinues.find((r) => r.id === token.retinueId) ?? null;
}

/** The mode and pace an NPC travels at: its own, else its retinue's, else on foot at normal. */
export function travellerMode(
  runtime: CampaignRuntime,
  token: Token,
): { mode: TravelMode; pace: TravelPace } {
  const retinue = retinueOf(runtime, token);
  const custom = runtime.campaign.settings.customTravelModes;
  const modeId = token.travelMode ?? retinue?.travelMode ?? 'foot';
  return {
    mode: resolveTravelMode(modeId, custom),
    pace: token.pace ?? retinue?.pace ?? 'normal',
  };
}

/** Travel speed in miles per hour for an NPC token. */
export function travellerSpeed(runtime: CampaignRuntime, token: Token): number {
  const { mode, pace } = travellerMode(runtime, token);
  return journeyMph(mode, pace);
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
  rng: Rng | null = null,
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
      const encounterMilesBefore = token.encounterMiles;
      const existingTrail = rt.trails.get(tracksTrailId(token.id)) ?? null;
      const trailBefore = existingTrail ? structuredClone(existingTrail) : null;
      const contentBefore = token.contentId
        ? structuredClone(rt.contents.get(token.contentId) ?? null)
        : null;
      const laid: { q: number; r: number; at: number }[] = [];
      // Clock minute a step lands on: window-minutes consumed, scaled onto
      // the real clock span (the window may be a fraction of the advance).
      const span = toMinutes - fromMinutes;
      const stamp = (left: number) =>
        Math.round(fromMinutes + ((creditBefore + banked - left) / (creditBefore + banked)) * span);
      let credit = creditBefore + banked;
      let cur: HexCoord = { q: token.q, r: token.r };
      let remaining = [...routeBefore];
      let stepped = 0;
      let looped = false;
      let miles = token.encounterMiles;
      const encounters: TravellerMove['encounters'] = [];
      while (remaining.length) {
        const next = remaining[0]!;
        const cost = perHex * stepCost(rt.edges, cur, next, WALKED);
        if (credit < cost) break;
        credit -= cost;
        cur = next;
        remaining.shift();
        stepped++;
        if (token.layTracks) laid.push({ q: cur.q, r: cur.r, at: stamp(credit) });
        // Wandering-encounter cadence by distance: roll on the terrain table
        // of the hex entered every N miles. The mover is not halted — the DM
        // reads the log and decides what, if anything, it meets.
        if (token.encounterEveryMiles && rng) {
          miles += map.milesPerHex;
          if (miles >= token.encounterEveryMiles) {
            miles = 0;
            encounters.push({
              q: cur.q,
              r: cur.r,
              result: rollEncounter(
                runtime,
                { mapId, q: cur.q, r: cur.r, tableId: null, skipCheck: false },
                rng,
              ),
            });
          }
        }
        // A patrol: at the end of its route it plans the same waypoints again
        // from where it stands and keeps walking on this very tick.
        if (remaining.length === 0 && token.loop && token.waypoints.length && !looped) {
          const again = planRoute(runtime, map, { ...token, q: cur.q, r: cur.r }, token.waypoints);
          if (again.length) {
            remaining = again;
            looped = true;
          }
        }
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
        encounterMiles: miles,
      });
      // Tracks: the trail grows by the hexes walked this tick. A new trail
      // starts from where the mover stood, so the first sign already points
      // onward. The gate and fade follow the token's current settings.
      if (laid.length) {
        const cells = existingTrail
          ? [...existingTrail.cells, ...laid]
          : [{ q: token.q, r: token.r, at: fromMinutes }, ...laid];
        runtime.upsertTrail({
          id: tracksTrailId(token.id),
          mapId,
          name: `${token.label || 'A traveller'}'s tracks`,
          glyph: existingTrail?.glyph ?? '👣',
          dmNotes: existingTrail?.dmNotes ?? '',
          gate: token.tracksGate,
          cells,
          kind: 'tracks',
          fade: { dcPerDay: token.tracksDcPerDay, expireDays: token.tracksExpireDays },
          moverId: token.id,
        });
      }
      // Presence: the attached content (and its footprint) rides along.
      if (contentBefore && stepped > 0) {
        const dq = cur.q - token.q;
        const dr = cur.r - token.r;
        runtime.upsertContent({
          ...contentBefore,
          q: cur.q,
          r: cur.r,
          area: contentBefore.area.map((h) => ({ q: h.q + dq, r: h.r + dr })),
        });
      }
      if (stepped > 0) {
        moves.push({
          tokenId: token.id,
          mapId,
          label: token.label || 'traveller',
          from: { q: token.q, r: token.r },
          to: cur,
          routeBefore,
          creditBefore,
          encounterMilesBefore,
          arrived,
          looped,
          encounters,
          trailBefore,
          laidTracks: laid.length > 0,
          contentBefore,
        });
      }
    }
  }
  return moves;
}

/**
 * Drop tracks older than their trail's `expireDays`. Tracks are appended in
 * walking order, so the expired cells are a prefix; the finds on the trail
 * are re-indexed to match (and finds on dropped cells are gone with them).
 * Returns what was pruned, for undo.
 */
export function pruneTracks(runtime: CampaignRuntime, nowMinutes: number): TrackPrune[] {
  const prunes: TrackPrune[] = [];
  for (const [mapId, rt] of runtime.mapStates) {
    for (const trail of [...rt.trails.values()]) {
      if (!trail.fade || trail.kind !== 'tracks') continue;
      const horizon = nowMinutes - trail.fade.expireDays * MINUTES_PER_DAY;
      let drop = 0;
      while (drop < trail.cells.length) {
        const at = trail.cells[drop]!.at;
        if (at !== undefined && at < horizon) drop++;
        else break;
      }
      if (drop === 0) continue;
      const discoveries = [...runtime.trailDiscoveries.values()].filter((d) => d.trailId === trail.id);
      prunes.push({ trail: structuredClone(trail), discoveries: structuredClone(discoveries) });
      for (const d of discoveries) runtime.deleteTrailDiscovery(d.id);
      if (drop >= trail.cells.length) {
        runtime.deleteTrail(mapId, trail.id);
        continue;
      }
      runtime.upsertTrail({ ...trail, cells: trail.cells.slice(drop) });
      for (const d of discoveries) {
        if (d.cellIndex < drop) continue;
        runtime.addTrailDiscovery({ ...d, id: nanoid(12), cellIndex: d.cellIndex - drop });
      }
    }
  }
  return prunes;
}

/** Put travellers, their tracks and their presence back where an advance found them (undo). */
export function restoreTravellers(runtime: CampaignRuntime, tick: TravellerTick): void {
  for (const m of tick.moves) {
    if (runtime.findToken(m.tokenId)) {
      runtime.updateToken(m.mapId, m.tokenId, {
        q: m.from.q,
        r: m.from.r,
        route: m.routeBefore,
        travelCredit: m.creditBefore,
        encounterMiles: m.encounterMilesBefore,
      });
    }
    if (m.laidTracks) {
      const id = tracksTrailId(m.tokenId);
      if (m.trailBefore) runtime.upsertTrail(m.trailBefore);
      else if (runtime.findTrail(id)) runtime.deleteTrail(m.mapId, id);
    }
    if (m.contentBefore && runtime.mapStates.get(m.mapId)?.contents.has(m.contentBefore.id)) {
      runtime.upsertContent(m.contentBefore);
    }
  }
  for (const p of tick.prunes) {
    runtime.upsertTrail(p.trail);
    for (const d of [...runtime.trailDiscoveries.values()]) {
      if (d.trailId === p.trail.id) runtime.deleteTrailDiscovery(d.id);
    }
    for (const d of p.discoveries) runtime.addTrailDiscovery(d);
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
 * String waypoints into the hexes an NPC will walk: the cheapest legal route
 * for its travel mode, preferring roads and then known ground (see shared
 * `rules/journey.ts`). The token's current hex is not part of the result.
 */
export function planRoute(
  runtime: CampaignRuntime,
  map: MapInfo,
  token: Token,
  waypoints: HexCoord[],
): HexCoord[] {
  const rt = runtime.mapStates.get(map.id);
  if (!rt) return [];
  const roads = roadIndex(rt.trails.values());
  const { mode } = travellerMode(runtime, token);
  return planJourney(
    {
      terrainAt: (h) => rt.hexes.get(hexKey(h.q, h.r)),
      fogAt: (h) => rt.fog.get(hexKey(h.q, h.r)),
      roadAt: (h) => roads.has(hexKey(h.q, h.r)),
      edges: rt.edges,
    },
    mode.medium,
    token,
    waypoints,
  );
}
