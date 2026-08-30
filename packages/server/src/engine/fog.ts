import type { FogState, MapInfo } from '@hexcrawl/shared';
import { hexKey, hexRange, parseHexKey } from '@hexcrawl/shared';
import type { CampaignRuntime } from '../state/runtime.js';

/**
 * Recompute auto-reveal fog after PC token movement.
 *
 * Every hex within `sightRadius` of any PC token becomes `visible`.
 * If the map decays fog, previously-visible hexes that no PC currently
 * sees drop to `explored`.
 *
 * Returns the fog cells that changed.
 */
export function applyAutoReveal(
  runtime: CampaignRuntime,
  map: MapInfo,
): { q: number; r: number; state: FogState; prev: FogState }[] {
  if (map.fogMode !== 'auto') return [];
  const rt = runtime.requireMap(map.id);

  const inSight = new Set<string>();
  for (const token of rt.tokens.values()) {
    if (token.kind !== 'pc') continue;
    for (const cell of hexRange({ q: token.q, r: token.r }, map.sightRadius)) {
      inSight.add(hexKey(cell.q, cell.r));
    }
  }

  const toVisible: { q: number; r: number }[] = [];
  for (const key of inSight) {
    // Only lift hidden cells; the explored trail keeps its state.
    if ((rt.fog.get(key) ?? 'hidden') === 'hidden') toVisible.push(parseHexKey(key));
  }

  const toExplored: { q: number; r: number }[] = [];
  if (map.fogDecay) {
    for (const [key, state] of rt.fog) {
      if (state === 'visible' && !inSight.has(key)) toExplored.push(parseHexKey(key));
    }
  }

  return [
    ...runtime.setFog(map.id, toVisible.length ? toVisible : [], 'visible'),
    ...runtime.setFog(map.id, toExplored.length ? toExplored : [], 'explored'),
  ];
}
