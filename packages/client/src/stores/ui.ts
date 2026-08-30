import { create } from 'zustand';
import type { FogState, HexCoord, TerrainId } from '@hexcrawl/shared';

export type Tool = 'select' | 'paint' | 'fog' | 'marker' | 'content' | 'trail' | 'measure';

export type PanelTab =
  | 'inspect'
  | 'maps'
  | 'characters'
  | 'tokens'
  | 'encounters'
  | 'senses'
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
  /** Hex scale: 'auto' derives from zoom; 0/1/2 locks fine/mid/coarse. */
  scaleLock: 'auto' | 0 | 1 | 2;
  /** Current scale level, written by the engine for UI display. */
  currentScale: 0 | 1 | 2;
  /** DM armed "click to move this content" mode. */
  movingContentId: string | null;
  /** Armed "click a destination hex to send this token there" mode. */
  movingTokenId: string | null;
  /** Sense triangulation: visited hexes a clicked clue is observable from. */
  senseHighlight: { clueId: string; cells: HexCoord[] } | null;
  /** DM trail tool: cells of the trail being drawn, in click order. */
  trailDraft: HexCoord[];
  /** DM box-select: content ids selected for bulk enable/disable/quest. */
  contentSelection: string[] | null;
  /** Screen position (canvas coords) of the selected hex, for the pin popup. */
  pinPopup: { x: number; y: number } | null;
  /** Player-chosen map for this session (null = follow the DM default). */
  viewedMapId: string | null;
  /** DM view aid: dim location pins on hexes the party hasn't explored. */
  dimUnexplored: boolean;
  /** Held Alt/Option: a DM token drop teleports (no explored trail). */
  altTeleport: boolean;

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
  scaleLock: 'auto',
  currentScale: 0,
  movingContentId: null,
  movingTokenId: null,
  senseHighlight: null,
  trailDraft: [],
  contentSelection: null,
  pinPopup: null,
  viewedMapId: null,
  dimUnexplored: false,
  altTeleport: false,

  set: (key, value) => set({ [key]: value } as Partial<UiStore>),
  setTool: (tool) => set({ tool, measureStart: null }),
  selectHex: (hex) =>
    set({ selectedHex: hex, selectedTokenId: null, panelTab: hex ? 'inspect' : 'inspect' }),
}));
