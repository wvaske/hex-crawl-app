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
  /** Sticker id (`<category>/<slug>`); empty means place the emoji glyph. */
  markerIcon: string;
  /** Size multiplier for newly placed markers (0.5–3). */
  markerScale: number;
  markerDmOnly: boolean;
  selectedHex: HexCoord | null;
  hoverHex: HexCoord | null;
  selectedTokenId: string | null;
  contentDialogHex: HexCoord | null;
  editingContentId: string | null;
  /** Content whose full detail dialog (app data + wiki) is open (#66). */
  locationDialogContentId: string | null;
  panelTab: PanelTab;
  panelOpen: boolean;
  /** Right sidebar width in px (drag the left edge to resize). */
  panelWidth: number;
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
  /** Trail highlight: the full path (DM) or discovered cells (player) of a clicked trail. */
  trailHighlight: { trailId: string; cells: HexCoord[] } | null;
  /** Region footprint highlight: the hexes of a clicked multi-hex content (issue #69). */
  areaHighlight: { contentId: string; cells: HexCoord[] } | null;
  /**
   * DM "paint area" mode (armed from the content dialog): while set, a map
   * click toggles the hex in `cells` instead of running the active tool. The
   * dialog owns the draft until it's saved, so this holds live cells, not an
   * id — a brand-new content item has no id yet.
   */
  areaPaint: { cells: HexCoord[] } | null;
  /** DM trail tool: cells of the trail being drawn, in click order. */
  trailDraft: HexCoord[];
  /** DM trail tool: id of the trail whose nodes are being edited (null = new). */
  editingTrailId: string | null;
  /** DM box-select: content ids selected for bulk enable/disable/quest. */
  contentSelection: string[] | null;
  /** Screen position (canvas coords) of the selected hex, for the pin popup. */
  pinPopup: { x: number; y: number } | null;
  /** Player-chosen map for this session (null = follow the DM default). */
  viewedMapId: string | null;
  /** DM view aid: dim location pins on hexes the party hasn't explored. */
  dimUnexplored: boolean;
  /** Tint the map to match the campaign clock's time of day. */
  dayNightTint: boolean;
  /** Held Alt/Option: a DM token drop teleports (no explored trail). */
  altTeleport: boolean;

  set<K extends keyof UiStore>(key: K, value: UiStore[K]): void;
  setTool(tool: Tool): void;
  selectHex(hex: HexCoord | null): void;
}

export const PANEL_WIDTH_MIN = 240;
export const PANEL_WIDTH_MAX = 640;
const PANEL_WIDTH_KEY = 'hexcrawl.panelWidth';

function initialPanelWidth(): number {
  try {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= PANEL_WIDTH_MIN && stored <= PANEL_WIDTH_MAX) {
      return stored;
    }
  } catch {
    // Storage unavailable (private mode etc.) — fall through to the default.
  }
  return 320;
}

export function persistPanelWidth(width: number): void {
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Best-effort convenience only.
  }
}

export const useUi = create<UiStore>((set) => ({
  tool: 'select',
  paintTerrain: 'plains',
  brushRadius: 0,
  fogTarget: 'visible',
  markerGlyph: '⭐',
  markerIcon: 'story/objective',
  markerScale: 1,
  markerDmOnly: false,
  selectedHex: null,
  hoverHex: null,
  selectedTokenId: null,
  contentDialogHex: null,
  editingContentId: null,
  locationDialogContentId: null,
  panelTab: 'inspect',
  panelOpen: true,
  panelWidth: initialPanelWidth(),
  measureStart: null,
  spacePan: false,
  scaleLock: 'auto',
  currentScale: 0,
  movingContentId: null,
  movingTokenId: null,
  senseHighlight: null,
  trailHighlight: null,
  areaHighlight: null,
  areaPaint: null,
  trailDraft: [],
  editingTrailId: null,
  contentSelection: null,
  pinPopup: null,
  viewedMapId: null,
  dimUnexplored: true,
  dayNightTint: true,
  altTeleport: false,

  set: (key, value) => set({ [key]: value } as Partial<UiStore>),
  setTool: (tool) => set({ tool, measureStart: null }),
  selectHex: (hex) =>
    set({ selectedHex: hex, selectedTokenId: null, panelTab: hex ? 'inspect' : 'inspect' }),
}));
