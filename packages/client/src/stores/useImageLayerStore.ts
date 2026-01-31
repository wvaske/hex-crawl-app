import { create } from 'zustand';

export interface ImageLayerData {
  id: string;
  mapId: string;
  fileName: string;
  storageKey: string;
  contentType: string;
  fileSize: number;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  sortOrder: number;
  visible: boolean;
  playerVisible: boolean;
  url: string;
}

export interface GridSettings {
  gridLineColor: string;
  gridLineThickness: number;
  gridLineOpacity: number;
  terrainOverlayEnabled: boolean;
  terrainOverlayOpacity: number;
  gridOffsetX: number;
  gridOffsetY: number;
  hexSizeX: number;
  hexSizeY: number;
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  gridLineColor: '#ffffff',
  gridLineThickness: 1,
  gridLineOpacity: 0.4,
  terrainOverlayEnabled: false,
  terrainOverlayOpacity: 0.3,
  gridOffsetX: 0,
  gridOffsetY: 0,
  hexSizeX: 40,
  hexSizeY: 40,
};

interface ImageLayerState {
  /** All image layers sorted by sortOrder */
  layers: ImageLayerData[];
  /** Whether alignment mode is active */
  alignmentMode: boolean;
  /** ID of layer currently being aligned */
  aligningLayerId: string | null;
  /** Current map's grid/overlay settings */
  gridSettings: GridSettings;
  /** Current map ID */
  currentMapId: string | null;
}

interface ImageLayerActions {
  /** Replace all layers (from REST fetch) */
  setLayers: (layers: ImageLayerData[]) => void;
  /** Add a layer (from WS layer:added) */
  addLayer: (layer: ImageLayerData) => void;
  /** Partial update (from WS layer:updated or local alignment) */
  updateLayer: (id: string, updates: Partial<ImageLayerData>) => void;
  /** Remove a layer (from WS layer:removed) */
  removeLayer: (id: string) => void;
  /** Enter alignment mode for a specific layer */
  enterAlignmentMode: (layerId: string) => void;
  /** Exit alignment mode */
  exitAlignmentMode: () => void;
  /** Reorder layers based on new ID ordering */
  reorderLayers: (orderedIds: string[]) => void;
  /** Update grid settings (from WS map:updated or REST fetch) */
  setGridSettings: (settings: Partial<GridSettings>) => void;
  /** Set the current map ID */
  setCurrentMapId: (mapId: string | null) => void;
}

export type ImageLayerStore = ImageLayerState & ImageLayerActions;

function sortByOrder(layers: ImageLayerData[]): ImageLayerData[] {
  return [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
}

export const useImageLayerStore = create<ImageLayerStore>((set) => ({
  layers: [],
  alignmentMode: false,
  aligningLayerId: null,
  gridSettings: { ...DEFAULT_GRID_SETTINGS },
  currentMapId: null,

  setLayers: (layers) => set({ layers: sortByOrder(layers) }),

  addLayer: (layer) =>
    set((state) => ({
      layers: sortByOrder([...state.layers, layer]),
    })),

  updateLayer: (id, updates) =>
    set((state) => ({
      layers: sortByOrder(
        state.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      ),
    })),

  removeLayer: (id) =>
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
    })),

  enterAlignmentMode: (layerId) =>
    set({ alignmentMode: true, aligningLayerId: layerId }),

  exitAlignmentMode: () =>
    set({ alignmentMode: false, aligningLayerId: null }),

  reorderLayers: (orderedIds) =>
    set((state) => {
      const byId = new Map(state.layers.map((l) => [l.id, l]));
      const reordered: ImageLayerData[] = [];
      for (let i = 0; i < orderedIds.length; i++) {
        const layer = byId.get(orderedIds[i]);
        if (layer) {
          reordered.push({ ...layer, sortOrder: i });
        }
      }
      return { layers: reordered };
    }),

  setGridSettings: (settings) =>
    set((state) => ({
      gridSettings: { ...state.gridSettings, ...settings },
    })),

  setCurrentMapId: (mapId) => set({ currentMapId: mapId }),
}));
