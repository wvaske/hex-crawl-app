import type { HexCoord } from './coords.js';
import { hexToPixel, type HexOrientation } from './layout.js';

export const COMPASS_DIRECTIONS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const;
export type CompassDirection = (typeof COMPASS_DIRECTIONS)[number];

/**
 * Compass bearing from one hex toward another as seen on the rendered map
 * (screen up = north). Null when the hexes coincide.
 */
export function compassDirection(
  from: HexCoord,
  to: HexCoord,
  orientation: HexOrientation = 'flat',
): CompassDirection | null {
  if (from.q === to.q && from.r === to.r) return null;
  const layout = { orientation, size: 1, origin: { x: 0, y: 0 } };
  const a = hexToPixel(layout, from);
  const b = hexToPixel(layout, to);
  // Screen y grows south; 0° = north, clockwise.
  const deg = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
  const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
  return COMPASS_DIRECTIONS[idx]!;
}

/** Player-facing clue text with its sensed bearing appended, when known. */
export function withDirection(text: string, direction: string | null | undefined): string {
  return direction ? `${text} — to the ${direction}` : text;
}
