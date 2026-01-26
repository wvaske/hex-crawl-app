import type { TerrainType } from '@hex-crawl/shared';
import { TERRAIN_COLORS } from '@hex-crawl/shared';

/** Number of visual variants available for each terrain type */
export const TERRAIN_VARIANTS_COUNT: Record<TerrainType, number> = {
  forest: 3,
  desert: 3,
  grassland: 3,
  mountain: 3,
  water: 3,
  swamp: 3,
  arctic: 3,
  coast: 3,
  underdark: 3,
  urban: 3,
};

/** Assign a random terrain variant index (0-2) */
export function assignRandomVariant(_terrain: TerrainType): number {
  return Math.floor(Math.random() * 3);
}

// Re-export terrain colors from shared for easy access
export { TERRAIN_COLORS };
