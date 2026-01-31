/** Axial hex coordinates (q, r) */
export interface HexCoord {
  q: number;
  r: number;
}

/** Cube hex coordinates (q, r, s) where q + r + s = 0 */
export interface CubeCoord {
  q: number;
  r: number;
  s: number;
}

/** Built-in terrain types for hex tiles */
export type TerrainType =
  | 'forest'
  | 'desert'
  | 'grassland'
  | 'mountain'
  | 'water'
  | 'swamp'
  | 'arctic'
  | 'coast'
  | 'underdark'
  | 'urban';

/** All available terrain type strings */
export const TERRAIN_TYPES: readonly TerrainType[] = [
  'forest',
  'desert',
  'grassland',
  'mountain',
  'water',
  'swamp',
  'arctic',
  'coast',
  'underdark',
  'urban',
] as const;

/** Hex color values for each terrain type */
export const TERRAIN_COLORS: Record<TerrainType, string> = {
  forest: '#2d5a27',
  desert: '#c4a35a',
  grassland: '#7ec850',
  mountain: '#8b7355',
  water: '#3b7dd8',
  swamp: '#4a6741',
  arctic: '#e8f0f2',
  coast: '#d4bc65',
  underdark: '#2a1a3e',
  urban: '#8a8a8a',
};

/** Fog of war visibility tier for a hex */
export type FogTier = "revealed" | "adjacent" | "hidden";

/** Data stored for each hex tile */
export interface HexData {
  q: number;
  r: number;
  terrain: TerrainType;
  terrainVariant: number;
}

/** Create a string key from axial coordinates for Map lookups */
export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

/** Parse a hex key string back to axial coordinates */
export function parseHexKey(key: string): HexCoord {
  const [qStr, rStr] = key.split(',');
  return { q: Number(qStr), r: Number(rStr) };
}
