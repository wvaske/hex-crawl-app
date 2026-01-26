// Shared types and schemas - barrel export
export type { HexCoord, CubeCoord, HexData } from './hex-types.js';
export { TERRAIN_TYPES, TERRAIN_COLORS, hexKey, parseHexKey } from './hex-types.js';
export type { TerrainType } from './hex-types.js';

export { HexDataSchema, MapExportSchema } from './map-schema.js';
export type { MapExport } from './map-schema.js';
