import { MapExportSchema, hexKey } from '@hex-crawl/shared';
import type { HexData, MapExport, TerrainType } from '@hex-crawl/shared';
import { ZodError } from 'zod';

/**
 * Result of importing a map JSON file.
 * Contains all data needed to call useMapStore.initializeMap().
 */
export interface ImportResult {
  name: string;
  gridWidth: number;
  gridHeight: number;
  hexSize: number;
  hexes: Map<string, HexData>;
}

/**
 * Export the current map state as a JSON string.
 *
 * Builds a MapExport object with version: 1, orientation: 'flat',
 * and serializes hex data as an array of { q, r, terrain, terrainVariant }.
 *
 * @param store - Current map store state (hexes, mapName, gridWidth, gridHeight, hexSize)
 * @returns Human-readable JSON string
 */
export function exportMap(store: {
  hexes: Map<string, HexData>;
  mapName: string;
  gridWidth: number;
  gridHeight: number;
  hexSize: number;
}): string {
  const hexArray: HexData[] = [];

  for (const [, hexData] of store.hexes) {
    hexArray.push({
      q: hexData.q,
      r: hexData.r,
      terrain: hexData.terrain,
      terrainVariant: hexData.terrainVariant,
    });
  }

  // Sort by q then r for consistent output
  hexArray.sort((a, b) => {
    if (a.q !== b.q) return a.q - b.q;
    return a.r - b.r;
  });

  const mapExport: MapExport = {
    version: 1,
    name: store.mapName,
    gridWidth: store.gridWidth,
    gridHeight: store.gridHeight,
    hexSize: store.hexSize,
    orientation: 'flat',
    hexes: hexArray,
  };

  return JSON.stringify(mapExport, null, 2);
}

/**
 * Import a map from a JSON string with Zod validation.
 *
 * Parses and validates the JSON against MapExportSchema.
 * On success, converts the hex array back to a Map<string, HexData>.
 * On failure, throws a descriptive error with field-level details.
 *
 * @param jsonString - Raw JSON string from an imported file
 * @returns ImportResult ready for useMapStore.initializeMap()
 * @throws Error with validation details if the JSON is invalid
 */
export function importMap(jsonString: string): ImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(
      `Invalid JSON: ${err instanceof Error ? err.message : 'Failed to parse'}`,
    );
  }

  try {
    const validated = MapExportSchema.parse(parsed);

    // Convert hex array to Map
    const hexes = new Map<string, HexData>();
    for (const hex of validated.hexes) {
      const key = hexKey(hex.q, hex.r);
      hexes.set(key, {
        q: hex.q,
        r: hex.r,
        terrain: hex.terrain as TerrainType,
        terrainVariant: hex.terrainVariant,
      });
    }

    return {
      name: validated.name,
      gridWidth: validated.gridWidth,
      gridHeight: validated.gridHeight,
      hexSize: validated.hexSize,
      hexes,
    };
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((issue) => {
          const path = issue.path.join('.');
          return `  - ${path || 'root'}: ${issue.message} (expected: ${issue.code})`;
        })
        .join('\n');
      throw new Error(`Map validation failed:\n${issues}`);
    }
    throw err;
  }
}
