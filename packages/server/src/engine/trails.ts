import { nanoid } from 'nanoid';
import type { Trail } from '@hexcrawl/shared';
import { compassDirection, gateOpensPassively, hexDistance } from '@hexcrawl/shared';
import type { CampaignRuntime } from '../state/runtime.js';

export interface TrailFind {
  trailId: string;
  characterId: string;
  characterName: string;
  q: number;
  r: number;
  forward: string | null;
  backward: string | null;
}

/** Compass bearings onward/back from a trail cell. */
export function trailBearings(
  trail: Trail,
  cellIndex: number,
  orientation: 'flat' | 'pointy',
): { forward: string | null; backward: string | null } {
  const cell = trail.cells[cellIndex]!;
  const next = trail.cells[cellIndex + 1];
  const prev = trail.cells[cellIndex - 1];
  return {
    forward: next ? compassDirection(cell, next, orientation) : null,
    backward: prev ? compassDirection(cell, prev, orientation) : null,
  };
}

/**
 * Evaluate trail gates for characters on a map: any trail cell within the
 * gate's reach of a PC becomes known to that character (passive/auto gates
 * only — active gates open via hex searches). Returns the new finds.
 */
export function evaluateTrails(
  runtime: CampaignRuntime,
  mapId: string,
  characterIds: string[] | null = null,
): TrailFind[] {
  const rt = runtime.mapStates.get(mapId);
  const map = runtime.maps.get(mapId);
  if (!rt || !map) return [];

  const positions = new Map<string, { q: number; r: number }>();
  for (const token of rt.tokens.values()) {
    if (token.kind === 'pc' && token.characterId) {
      positions.set(token.characterId, { q: token.q, r: token.r });
    }
  }

  const finds: TrailFind[] = [];
  for (const [characterId, pos] of positions) {
    if (characterIds && !characterIds.includes(characterId)) continue;
    const character = runtime.characters.get(characterId);
    if (!character) continue;
    for (const trail of rt.trails.values()) {
      for (let i = 0; i < trail.cells.length; i++) {
        if (runtime.hasTrailDiscovery(trail.id, i, characterId)) continue;
        const cell = trail.cells[i]!;
        const distance = hexDistance(pos, cell);
        if (!gateOpensPassively(trail.gate, character, distance).opens) continue;
        if (
          runtime.addTrailDiscovery({
            id: nanoid(12),
            trailId: trail.id,
            cellIndex: i,
            characterId,
            at: Date.now(),
          })
        ) {
          const bearings = trailBearings(trail, i, map.orientation);
          finds.push({
            trailId: trail.id,
            characterId,
            characterName: character.name,
            q: cell.q,
            r: cell.r,
            ...bearings,
          });
        }
      }
    }
  }
  return finds;
}
