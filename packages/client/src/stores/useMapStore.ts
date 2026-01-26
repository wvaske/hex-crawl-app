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
  /** Clear all map data */
  clearMap: () => void;
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
        }
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
}));
