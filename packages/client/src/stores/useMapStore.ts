import { create } from 'zustand';
import type { HexData, TerrainType } from '@hex-crawl/shared';

interface MapState {
  /** Hex data keyed by "q,r" string */
  hexes: Map<string, HexData>;
  /** Name of the current map */
  mapName: string;
  /** Grid width in hexes */
  gridWidth: number;
  /** Grid height in hexes */
  gridHeight: number;
  /** Hex size (circumradius in pixels) */
  hexSize: number;
}

interface MapActions {
  /** Initialize the map with hex data */
  initializeMap: (
    name: string,
    width: number,
    height: number,
    hexes: Map<string, HexData>,
  ) => void;
  /** Set terrain for a single hex */
  setTerrain: (key: string, terrain: TerrainType) => void;
  /** Set terrain for multiple hexes at once (batch painting) */
  setTerrainBatch: (keys: string[], terrain: TerrainType) => void;
  /** Remove hexes from the map (delete terrain data) */
  removeHexes: (keys: string[]) => void;
  /** Clear all map data */
  clearMap: () => void;
  /** Load hex data fetched from the server API */
  loadFromServer: (hexes: Array<{ key: string; terrain: string; terrainVariant: number }>) => void;
}

export type MapStore = MapState & MapActions;

export const useMapStore = create<MapStore>((set) => ({
  // State
  hexes: new Map(),
  mapName: '',
  gridWidth: 15,
  gridHeight: 15,
  hexSize: 40,

  // Actions
  initializeMap: (name, width, height, hexes) =>
    set({
      mapName: name,
      gridWidth: width,
      gridHeight: height,
      hexes: new Map(hexes), // Always new reference (PITFALL 6)
    }),

  setTerrain: (key, terrain) =>
    set((state) => {
      const hexes = new Map(state.hexes); // New reference (PITFALL 6)
      const hex = hexes.get(key);
      if (hex) {
        hexes.set(key, { ...hex, terrain });
      }
      return { hexes };
    }),

  setTerrainBatch: (keys, terrain) =>
    set((state) => {
      const hexes = new Map(state.hexes); // New reference (PITFALL 6)
      for (const key of keys) {
        const hex = hexes.get(key);
        if (hex) {
          hexes.set(key, { ...hex, terrain });
        } else {
          // Create a new HexData entry for an empty grid position
          const [qStr, rStr] = key.split(',');
          hexes.set(key, {
            q: Number(qStr),
            r: Number(rStr),
            terrain,
            terrainVariant: 0,
          });
        }
      }
      return { hexes };
    }),

  removeHexes: (keys) =>
    set((state) => {
      const hexes = new Map(state.hexes); // New reference (PITFALL 6)
      for (const key of keys) {
        hexes.delete(key);
      }
      return { hexes };
    }),

  clearMap: () =>
    set({
      hexes: new Map(),
      mapName: '',
      gridWidth: 15,
      gridHeight: 15,
    }),

  loadFromServer: (serverHexes) => {
    const hexes = new Map<string, HexData>();
    let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const h of serverHexes) {
      const [qStr, rStr] = h.key.split(',');
      const q = Number(qStr);
      const r = Number(rStr);
      hexes.set(h.key, {
        q,
        r,
        terrain: h.terrain as TerrainType,
        terrainVariant: h.terrainVariant,
      });
      if (q < minQ) minQ = q;
      if (q > maxQ) maxQ = q;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    if (hexes.size === 0) return;
    const gridWidth = maxQ - minQ + 1;
    const gridHeight = maxR - minR + 1;
    set({
      hexes,
      mapName: 'Server Map',
      gridWidth: Math.max(gridWidth, 1),
      gridHeight: Math.max(gridHeight, 1),
    });
  },
}));
