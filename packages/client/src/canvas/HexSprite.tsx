import { Sprite } from 'pixi.js';
import type { TerrainType } from '@hex-crawl/shared';
import { getTerrainTexture } from '../hex/textures';

/**
 * Factory function to create a positioned hex terrain Sprite.
 * Used for imperative sprite creation in TerrainLayer.
 *
 * Note: This is a helper function, not a React component, because
 * rendering 500+ JSX elements is slower than imperative sprite creation.
 * The TerrainLayer manages sprite lifecycle imperatively for performance.
 *
 * @param x - Pixel x position (top-left origin)
 * @param y - Pixel y position (top-left origin)
 * @param terrain - Terrain type for texture lookup
 * @param variant - Terrain variant index (0-2)
 * @returns A configured PixiJS Sprite
 */
export function createHexSprite(
  x: number,
  y: number,
  terrain: TerrainType,
  variant: number,
): Sprite {
  const texture = getTerrainTexture(terrain, variant);
  const sprite = new Sprite(texture);
  sprite.position.set(x, y);
  sprite.anchor.set(0, 0);
  return sprite;
}

/**
 * Update an existing hex sprite's texture (e.g., when terrain is repainted).
 */
export function updateHexSpriteTexture(
  sprite: Sprite,
  terrain: TerrainType,
  variant: number,
): void {
  sprite.texture = getTerrainTexture(terrain, variant);
}
