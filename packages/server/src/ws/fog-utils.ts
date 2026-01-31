import { db } from "../db/index.js";
import { hexVisibility, campaignHex } from "../db/schema/index.js";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Flat-top hex neighbor directions (axial coordinates)
// ---------------------------------------------------------------------------

const FLAT_TOP_DIRECTIONS = [
  { q: 1, r: 0 },   // East
  { q: 1, r: -1 },  // Northeast
  { q: 0, r: -1 },  // Northwest
  { q: -1, r: 0 },  // West
  { q: -1, r: 1 },  // Southwest
  { q: 0, r: 1 },   // Southeast
] as const;

// ---------------------------------------------------------------------------
// Adjacency computation
// ---------------------------------------------------------------------------

/**
 * Parse a "q,r" key and return the 6 flat-top neighbor keys.
 */
export function getNeighborKeys(key: string): string[] {
  const [qStr, rStr] = key.split(",");
  const q = Number(qStr);
  const r = Number(rStr);
  return FLAT_TOP_DIRECTIONS.map((d) => `${q + d.q},${r + d.r}`);
}

/**
 * Compute the set of hex keys that are adjacent to revealed hexes
 * but not themselves revealed. Only includes keys present in allHexKeys.
 */
export function computeAdjacentHexes(
  revealedKeys: Set<string>,
  allHexKeys: Set<string>
): Set<string> {
  const adjacent = new Set<string>();
  for (const key of revealedKeys) {
    for (const neighbor of getNeighborKeys(key)) {
      if (!revealedKeys.has(neighbor) && allHexKeys.has(neighbor)) {
        adjacent.add(neighbor);
      }
    }
  }
  return adjacent;
}

// ---------------------------------------------------------------------------
// Player fog payload builder
// ---------------------------------------------------------------------------

/**
 * Build the filtered fog payload for a player.
 * Returns only revealed hex keys and adjacent hexes with terrain-only data.
 */
export function buildPlayerFogPayload(
  playerRevealedKeys: Set<string>,
  allHexData: Map<string, { terrain: string; terrainVariant: number }>
): {
  revealedHexes: string[];
  adjacentHexes: Array<{ key: string; terrain: string }>;
} {
  const allHexKeys = new Set(allHexData.keys());
  const adjacentKeys = computeAdjacentHexes(playerRevealedKeys, allHexKeys);

  const adjacentHexes: Array<{ key: string; terrain: string }> = [];
  for (const key of adjacentKeys) {
    const data = allHexData.get(key);
    if (data) {
      adjacentHexes.push({ key, terrain: data.terrain });
    }
  }

  return {
    revealedHexes: Array.from(playerRevealedKeys),
    adjacentHexes,
  };
}

// ---------------------------------------------------------------------------
// DB loading functions
// ---------------------------------------------------------------------------

/**
 * Load fog state from hex_visibility table.
 * Returns Map<hexKey, Set<userId>> where "__all__" sentinel means all players.
 */
export async function loadFogState(
  campaignId: string
): Promise<Map<string, Set<string>>> {
  const rows = await db
    .select({
      hexKey: hexVisibility.hexKey,
      userId: hexVisibility.userId,
    })
    .from(hexVisibility)
    .where(eq(hexVisibility.campaignId, campaignId));

  const fogMap = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!fogMap.has(row.hexKey)) {
      fogMap.set(row.hexKey, new Set());
    }
    fogMap.get(row.hexKey)!.add(row.userId);
  }
  return fogMap;
}

/**
 * Load map hex data from campaign_hex table.
 * Returns Map<hexKey, { terrain, terrainVariant }>.
 */
export async function loadMapData(
  campaignId: string
): Promise<Map<string, { terrain: string; terrainVariant: number }>> {
  const rows = await db
    .select({
      hexKey: campaignHex.hexKey,
      terrain: campaignHex.terrain,
      terrainVariant: campaignHex.terrainVariant,
    })
    .from(campaignHex)
    .where(eq(campaignHex.campaignId, campaignId));

  const mapData = new Map<string, { terrain: string; terrainVariant: number }>();
  for (const row of rows) {
    mapData.set(row.hexKey, {
      terrain: row.terrain,
      terrainVariant: row.terrainVariant,
    });
  }
  return mapData;
}
