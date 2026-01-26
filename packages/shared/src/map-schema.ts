import { z } from 'zod';
import { TERRAIN_TYPES } from './hex-types.js';

/** Zod schema for validating a single hex data object */
export const HexDataSchema = z.object({
  q: z.int(),
  r: z.int(),
  terrain: z.enum(TERRAIN_TYPES as unknown as [string, ...string[]]),
  terrainVariant: z.int().nonnegative(),
});

/** Zod schema for validating a full map export */
export const MapExportSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  gridWidth: z.int().positive(),
  gridHeight: z.int().positive(),
  hexSize: z.number().positive(),
  orientation: z.enum(['flat', 'pointy']),
  hexes: z.array(HexDataSchema),
});

/** TypeScript type inferred from MapExportSchema */
export type MapExport = z.infer<typeof MapExportSchema>;
