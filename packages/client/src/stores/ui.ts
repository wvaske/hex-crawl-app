import { create } from 'zustand';
import type { FogState, HexCoord, TerrainId } from '@hexcrawl/shared';

export type Tool = 'select' | 'paint' | 'fog' | 'marker' | 'content' | 'measure';

export type PanelTab =
  | 'inspect'
  | 'maps'
  | 'characters'
  | 'tokens'
  | 'encounters'
  | 'log'
  | 'journal'
  | 'settings';

interface UiStore {
  tool: Tool;
  paintTerrain: TerrainId | null; // null = eraser
  brushRadius: 0 | 1 | 2;
  fogTarget: FogState;
  markerGlyph: string;
  markerDmOnly: boolean;
  selectedHex: HexCoord | null;
  hoverHex: HexCoord | null;
  selectedTokenId: string | null;
  contentDialogHex: HexCoord | null;
  editingContentId: string | null;
  panelTab: PanelTab;
  panelOpen: boolean;
  measureStart: HexCoord | null;
  /** Held spacebar: pan with left-drag regardless of the active tool. */
  spacePan: boolean;

  set<K extends keyof UiStore>(key: K, value: UiStore[K]): void;
  setTool(tool: Tool): void;
  selectHex(hex: HexCoord | null): void;
}

export const useUi = create<UiStore>((set) => ({
  tool: 'select',
  paintTerrain: 'plains',
  brushRadius: 0,
  fogTarget: 'visible',
  markerGlyph: '⭐',
  markerDmOnly: false,
  selectedHex: null,
  hoverHex: null,
  selectedTokenId: null,
  contentDialogHex: null,
  editingContentId: null,
  panelTab: 'inspect',
  panelOpen: true,
  measureStart: null,
  spacePan: false,

  set: (key, value) => set({ [key]: value } as Partial<UiStore>),
  setTool: (tool) => set({ tool, measureStart: null }),
  selectHex: (hex) =>
    set({ selectedHex: hex, selectedTokenId: null, panelTab: hex ? 'inspect' : 'inspect' }),
}));
