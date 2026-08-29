import type { Character, Gate } from '../domain.js';
import { passiveScore } from '../domain.js';

/**
 * Passive gate evaluation: given a character and their token's distance (in
 * hexes) to the content hex, does this gate open automatically?
 *
 * - auto: opens when the character is ON the hex (distance 0).
 * - skill/passive: opens when within maxDistance and passive score >= dc.
 * - skill/active and manual: never open passively.
 */
export function gateOpensPassively(
  gate: Gate,
  character: Character,
  distance: number,
): { opens: boolean; passive?: number } {
  switch (gate.kind) {
    case 'auto':
      return { opens: distance === 0 };
    case 'skill': {
      if (gate.mode !== 'passive') return { opens: false };
      const passive = passiveScore(character.skills, gate.skill);
      return { opens: distance <= gate.maxDistance && passive >= gate.dc, passive };
    }
    case 'manual':
      return { opens: false };
  }
}

/** Human-readable gate description for DM UI. */
export function describeGate(gate: Gate): string {
  switch (gate.kind) {
    case 'auto':
      return 'Auto — revealed on entering the hex';
    case 'skill': {
      const mode = gate.mode === 'passive' ? 'passive' : 'active roll';
      const dist =
        gate.maxDistance === 0 ? 'on the hex' : `within ${gate.maxDistance} hex${gate.maxDistance === 1 ? '' : 'es'}`;
      return `DC ${gate.dc} ${capitalize(gate.skill)} (${mode}) ${dist}`;
    }
    case 'manual':
      return 'Manual — DM reveals';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
