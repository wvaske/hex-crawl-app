import { nanoid } from 'nanoid';
import type { Character, Discovery } from '@hexcrawl/shared';
import { compassDirection, gateOpensPassively, hexDistance } from '@hexcrawl/shared';
import type { CampaignRuntime } from '../state/runtime.js';

export interface NewDiscovery {
  discovery: Discovery;
  contentId: string;
  contentTitle: string;
  clueText: string;
  characterName: string;
}

/**
 * The knowledge engine: evaluate passive clue gates for characters on a map
 * and record any newly-opened gates as discoveries.
 *
 * `characterIds` limits evaluation (e.g. only the character whose token
 * moved); null evaluates everyone with a PC token on the map.
 */
export function evaluateKnowledge(
  runtime: CampaignRuntime,
  mapId: string,
  characterIds: string[] | null = null,
): NewDiscovery[] {
  const rt = runtime.mapStates.get(mapId);
  if (!rt) return [];
  const orientation = runtime.maps.get(mapId)?.orientation ?? 'flat';

  // Character -> position of their PC token on this map.
  const positions = new Map<string, { q: number; r: number }>();
  for (const token of rt.tokens.values()) {
    if (token.kind === 'pc' && token.characterId) {
      positions.set(token.characterId, { q: token.q, r: token.r });
    }
  }

  const results: NewDiscovery[] = [];
  for (const [characterId, pos] of positions) {
    if (characterIds && !characterIds.includes(characterId)) continue;
    const character = runtime.characters.get(characterId);
    if (!character) continue;
    for (const content of rt.contents.values()) {
      if (!content.enabled) continue;
      const distance = hexDistance(pos, { q: content.q, r: content.r });
      for (const clue of content.clues) {
        if (runtime.hasDiscovery(clue.id, characterId)) {
          // Reaching the source upgrades an earlier at-a-distance discovery:
          // the character now knows exactly where it came from. Info-only
          // clues never reveal the pin.
          if (distance === 0 && clue.revealsLocation) {
            runtime.markDiscoveryLocated(clue.id, characterId);
          }
          continue;
        }
        const evaluation = gateOpensPassively(clue.gate, character, distance);
        if (!evaluation.opens) continue;
        const direction = clue.indicatesDirection
          ? compassDirection(pos, { q: content.q, r: content.r }, orientation)
          : null;
        const discovery = buildDiscovery(
          clue.id,
          character,
          clue.gate,
          distance,
          evaluation.passive,
          direction,
          clue.revealsLocation,
        );
        if (runtime.addDiscovery(discovery)) {
          results.push({
            discovery,
            contentId: content.id,
            contentTitle: content.title,
            clueText: clue.text,
            characterName: character.name,
          });
        }
      }
    }
  }
  return results;
}

function buildDiscovery(
  clueId: string,
  character: Character,
  gate: { kind: string; skill?: string; dc?: number },
  distance: number,
  passive: number | undefined,
  direction: string | null,
  revealsLocation: boolean,
): Discovery {
  const how: Discovery['how'] =
    gate.kind === 'skill'
      ? {
          kind: 'passive',
          skill: gate.skill!,
          passive: passive ?? 0,
          dc: gate.dc!,
          distance,
        }
      : { kind: 'auto' };
  return {
    id: nanoid(12),
    clueId,
    characterId: character.id,
    at: Date.now(),
    how,
    direction,
    locates: distance === 0 && revealsLocation,
  };
}
