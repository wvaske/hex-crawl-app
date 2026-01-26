import { pointToCube, round } from 'honeycomb-grid';
import { GameHex } from './grid';

/** Convert a GameHex instance to pixel coordinates */
export function hexToPixel(hex: GameHex): { x: number; y: number } {
  return { x: hex.x, y: hex.y };
}

/**
 * Convert world pixel coordinates to the nearest hex axial coordinates.
 * Uses honeycomb-grid's pointToCube with cube rounding.
 */
export function pixelToHex(
  worldX: number,
  worldY: number,
): { q: number; r: number } {
  const hexPrototype = new GameHex();
  const cubeCoords = pointToCube(hexPrototype, { x: worldX, y: worldY });
  const rounded = round(cubeCoords);
  return { q: rounded.q, r: rounded.r };
}

/** Create a string key from a hex's axial coordinates */
export function hexToKey(hex: GameHex): string {
  return `${hex.q},${hex.r}`;
}
