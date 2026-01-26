import type { TerrainType } from '@hex-crawl/shared';
import { hexKey } from '@hex-crawl/shared';
import { getNeighborCoords } from './neighbors';

/** Primary terrain types used for seed generation */
const PRIMARY_TERRAINS: readonly TerrainType[] = [
  'forest',
  'desert',
  'grassland',
  'mountain',
  'water',
  'swamp',
] as const;

/** Probability of a hex becoming a seed (~15%) */
const SEED_PROBABILITY = 0.15;

/** Base probability of neighbor adopting parent terrain */
const BASE_GROW_PROBABILITY = 0.70;

/** Maximum BFS growth distance from seed */
const MAX_GROW_DISTANCE = 4;

interface GeneratedHex {
  terrain: TerrainType;
  terrainVariant: number;
}

interface BFSEntry {
  q: number;
  r: number;
  terrain: TerrainType;
  distance: number;
}

/**
 * Get the grow probability based on distance from seed.
 * Decreases with distance: 70% at 1, 50% at 2, 30% at 3, 15% at 4+
 */
function growProbability(distance: number): number {
  if (distance <= 1) return BASE_GROW_PROBABILITY;
  if (distance === 2) return 0.50;
  if (distance === 3) return 0.30;
  return 0.15;
}

/**
 * Apply adjacency rules to determine actual terrain assignment.
 * Handles terrain transitions like water->coast and mountain->forest.
 */
function applyAdjacencyRules(
  parentTerrain: TerrainType,
  neighborKey: string,
  assigned: Map<string, GeneratedHex>,
): TerrainType {
  // Water adjacency: if a water seed grows into a neighbor that already has
  // water neighbors, create coast instead (natural coastlines)
  if (parentTerrain === 'water') {
    // Check if this neighbor already borders non-water terrain
    const neighborCoord = parseKey(neighborKey);
    const surroundingNeighbors = getNeighborCoords(neighborCoord.q, neighborCoord.r);
    let hasNonWater = false;
    for (const sn of surroundingNeighbors) {
      const snKey = hexKey(sn.q, sn.r);
      const snHex = assigned.get(snKey);
      if (snHex && snHex.terrain !== 'water' && snHex.terrain !== 'coast') {
        hasNonWater = true;
        break;
      }
    }
    // At edges of water bodies, produce coast with some probability
    if (hasNonWater && Math.random() < 0.6) {
      return 'coast';
    }
    return 'water';
  }

  // Mountain adjacency: sometimes produces forest neighbors (transition zones)
  if (parentTerrain === 'mountain' && Math.random() < 0.25) {
    return 'forest';
  }

  // Desert adjacency: sometimes transitions through grassland
  if (parentTerrain === 'desert' && Math.random() < 0.20) {
    return 'grassland';
  }

  return parentTerrain;
}

/** Parse a "q,r" key into coordinates */
function parseKey(key: string): { q: number; r: number } {
  const parts = key.split(',');
  return { q: Number(parts[0]), r: Number(parts[1]) };
}

/**
 * Generate all valid hex coordinates for a rectangular grid.
 * Uses offset coordinates internally but returns axial (q, r) pairs.
 */
function generateGridCoords(
  gridWidth: number,
  gridHeight: number,
): { q: number; r: number }[] {
  const coords: { q: number; r: number }[] = [];
  for (let r = 0; r < gridHeight; r++) {
    for (let q = 0; q < gridWidth; q++) {
      coords.push({ q, r });
    }
  }
  return coords;
}

/**
 * Seed-and-grow BFS terrain generation algorithm.
 *
 * Produces natural-looking clustered terrain regions:
 * - Water forms bodies with coast borders
 * - Mountains cluster together with forest transitions
 * - Desert transitions through grassland
 * - Each hex gets a random variant (0-2) for texture variety
 *
 * @param gridWidth  Number of hex columns
 * @param gridHeight Number of hex rows
 * @returns Map keyed by "q,r" with terrain type and variant
 */
export function generateTerrain(
  gridWidth: number,
  gridHeight: number,
): Map<string, GeneratedHex> {
  const allCoords = generateGridCoords(gridWidth, gridHeight);
  const validKeys = new Set(allCoords.map((c) => hexKey(c.q, c.r)));
  const assigned = new Map<string, GeneratedHex>();

  // Phase 1: Seed generation
  const seeds: BFSEntry[] = [];

  // Ensure we always get at least a few seeds for small grids
  const minSeeds = Math.max(2, Math.floor(allCoords.length * 0.05));

  for (const coord of allCoords) {
    if (Math.random() < SEED_PROBABILITY) {
      const terrain =
        PRIMARY_TERRAINS[Math.floor(Math.random() * PRIMARY_TERRAINS.length)]!;
      const key = hexKey(coord.q, coord.r);
      assigned.set(key, {
        terrain,
        terrainVariant: Math.floor(Math.random() * 3),
      });
      seeds.push({ q: coord.q, r: coord.r, terrain, distance: 0 });
    }
  }

  // If too few seeds were generated (small grids or bad luck), add more
  if (seeds.length < minSeeds) {
    const unassigned = allCoords.filter(
      (c) => !assigned.has(hexKey(c.q, c.r)),
    );
    while (seeds.length < minSeeds && unassigned.length > 0) {
      const idx = Math.floor(Math.random() * unassigned.length);
      const coord = unassigned[idx]!;
      unassigned.splice(idx, 1);
      const terrain =
        PRIMARY_TERRAINS[Math.floor(Math.random() * PRIMARY_TERRAINS.length)]!;
      const key = hexKey(coord.q, coord.r);
      assigned.set(key, {
        terrain,
        terrainVariant: Math.floor(Math.random() * 3),
      });
      seeds.push({ q: coord.q, r: coord.r, terrain, distance: 0 });
    }
  }

  // Phase 2: BFS growth from seeds
  const queue: BFSEntry[] = [...seeds];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.distance >= MAX_GROW_DISTANCE) {
      continue;
    }

    const neighbors = getNeighborCoords(current.q, current.r);

    for (const neighbor of neighbors) {
      const neighborKey = hexKey(neighbor.q, neighbor.r);

      // Skip if outside grid or already assigned
      if (!validKeys.has(neighborKey) || assigned.has(neighborKey)) {
        continue;
      }

      const nextDistance = current.distance + 1;
      const prob = growProbability(nextDistance);

      if (Math.random() < prob) {
        // Apply adjacency rules to determine actual terrain
        const terrain = applyAdjacencyRules(
          current.terrain,
          neighborKey,
          assigned,
        );

        assigned.set(neighborKey, {
          terrain,
          terrainVariant: Math.floor(Math.random() * 3),
        });

        queue.push({
          q: neighbor.q,
          r: neighbor.r,
          terrain,
          distance: nextDistance,
        });
      }
    }
  }

  // Phase 3: Fill remaining unassigned hexes
  // Use multiple passes to fill from nearest assigned neighbors
  let unassignedKeys = allCoords
    .map((c) => hexKey(c.q, c.r))
    .filter((k) => !assigned.has(k));

  let maxPasses = 20; // Safety limit
  while (unassignedKeys.length > 0 && maxPasses > 0) {
    maxPasses--;
    const stillUnassigned: string[] = [];

    for (const key of unassignedKeys) {
      const coord = parseKey(key);
      const neighbors = getNeighborCoords(coord.q, coord.r);

      // Collect assigned neighbors
      const assignedNeighbors: GeneratedHex[] = [];
      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        const nHex = assigned.get(nKey);
        if (nHex) {
          assignedNeighbors.push(nHex);
        }
      }

      if (assignedNeighbors.length > 0) {
        // Pick a random assigned neighbor's terrain
        const donor =
          assignedNeighbors[
            Math.floor(Math.random() * assignedNeighbors.length)
          ]!;
        assigned.set(key, {
          terrain: donor.terrain,
          terrainVariant: Math.floor(Math.random() * 3),
        });
      } else {
        stillUnassigned.push(key);
      }
    }

    unassignedKeys = stillUnassigned;
  }

  // Final fallback: if any hexes are still unassigned (isolated), default to grassland
  for (const key of unassignedKeys) {
    assigned.set(key, {
      terrain: 'grassland',
      terrainVariant: Math.floor(Math.random() * 3),
    });
  }

  // Phase 4: Post-process water/coast adjacency
  // Ensure water hexes that border non-water have coast neighbors
  for (const [key, hex] of assigned) {
    if (hex.terrain === 'water') {
      const coord = parseKey(key);
      const neighbors = getNeighborCoords(coord.q, coord.r);
      for (const n of neighbors) {
        const nKey = hexKey(n.q, n.r);
        const nHex = assigned.get(nKey);
        if (
          nHex &&
          nHex.terrain !== 'water' &&
          nHex.terrain !== 'coast'
        ) {
          // Check if this neighbor borders water but isn't coast yet
          // Convert it to coast with some probability to create coastlines
          if (Math.random() < 0.5) {
            assigned.set(nKey, {
              terrain: 'coast',
              terrainVariant: nHex.terrainVariant,
            });
          }
        }
      }
    }
  }

  return assigned;
}
