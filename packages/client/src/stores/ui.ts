import { create } from 'zustand';
import type { FogState, HexCoord, LogEntry, TerrainId } from '@hexcrawl/shared';

export type Tool =
  | 'select'
  | 'paint'
  | 'fog'
  | 'marker'
  | 'content'
  | 'trail'
  | 'region'
  | 'measure';

/**
 * Side pop-out panels (issue #61). Three player-facing headings plus two
 * DM-only ones; each is a task, not a data type:
 *
 * - `information` — the inspected hex + (players) what your character senses
 * - `character`   — your sheet and the rest of the party
 * - `history`     — the journal of what you've learned + the session log
 * - `build`       — DM prep: maps, tokens, encounter tables
 * - `setup`       — DM campaign settings
 *
 * Exactly one is open at a time; clicking another heading swaps it, and
 * clicking the open one closes it (`null` = map only).
 */
export type PanelId = 'information' | 'character' | 'history' | 'build' | 'setup';

/** What a content-dialog paint session is painting (issue #123). */
export type AreaPaintTarget =
  | { kind: 'area' }
  | { kind: 'observe' }
  | { kind: 'clue'; index: number };

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
  /** DM map manager dialog (opened from the top bar or Build → Maps). */
  mapManagerOpen: boolean;
  /** Which side pop-out panel is open (null = none). */
  openPanel: PanelId | null;
  /** Pop-out panel width in px (drag the left edge to resize). */
  panelWidth: number;
  /**
   * Text size for all UI chrome (issue #126), as a percentage of the base
   * size. Applied as the root font-size, so every rem-based utility scales
   * with it; the map canvas is untouched. Per browser, in localStorage.
   */
  uiScale: number;
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
  /** Token the "Travel to…" settlement picker is open for (issue #130). */
  travelToTokenId: string | null;
  /**
   * Route preview while a token is being dragged or sent (issue #130): the
   * explored route the server would walk, or `null` cells when the map has
   * no such route and the move would be a straight line. Written by the
   * engine, read by the hex readout.
   */
  routePreview: { cells: HexCoord[] | null; target: HexCoord } | null;
  /** Sense triangulation: visited hexes a clicked clue is observable from. */
  senseHighlight: { clueId: string; cells: HexCoord[] } | null;
  /** DM: the encounter log entry shown in the run-this-encounter popup. */
  encounterDialogEntry: LogEntry | null;
  /** Trail highlight: the full path (DM) or discovered cells (player) of a clicked trail. */
  trailHighlight: { trailId: string; cells: HexCoord[] } | null;
  /**
   * Region footprint highlight: the hexes of a clicked multi-hex content
   * (issue #69). `proposal` marks an auto-detect recommendation that has not
   * been applied yet (issue #113) — the engine tints it differently so a
   * suggestion never looks like the stored footprint.
   */
  areaHighlight: { contentId: string; cells: HexCoord[]; proposal?: boolean } | null;
  /**
   * Auto-detect result awaiting Accept/Cancel (issue #113). Set alongside a
   * `proposal` highlight; while it's up the region manager collapses to a
   * floating bar so the DM can see the map underneath.
   */
  areaProposal: { contentId: string; cells: HexCoord[] } | null;
  /** DM region manager dialog (opened from the Region tool panel). */
  regionManagerOpen: boolean;
  /**
   * DM "paint area" mode (armed from the content dialog): while set, dragging
   * the map brushes hexes into (or out of) `cells` instead of running the
   * active tool. The dialog owns the draft until it's saved, so this holds
   * live cells, not an id — a brand-new content item has no id yet.
   * `target` says which draft the cells belong to (issue #123): the content's
   * footprint, its vantage set, or one clue's vantage set.
   */
  areaPaint: { cells: HexCoord[]; target?: AreaPaintTarget } | null;
  /**
   * Region tool (issue #108): which existing content the brush paints into.
   * Unlike `areaPaint`, strokes here go straight to the server as
   * `content.area` deltas — no dialog, no save step.
   */
  regionTargetId: string | null;
  /** Region brush polarity: true removes hexes from the footprint. */
  regionErase: boolean;
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

/** Text size presets (issue #126): percent of the base size. */
export const UI_SCALES = [90, 100, 115, 130, 150, 175] as const;
const UI_SCALE_KEY = 'hexcrawl.uiScale';

function initialUiScale(): number {
  try {
    const stored = Number(localStorage.getItem(UI_SCALE_KEY));
    if ((UI_SCALES as readonly number[]).includes(stored)) return stored;
  } catch {
    // Storage unavailable — default size.
  }
  return 100;
}

/** Apply a text-size preset to the document and remember it for next time. */
export function applyUiScale(scale: number): void {
  document.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`;
  try {
    localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // Best-effort convenience only.
  }
}

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
  mapManagerOpen: false,
  openPanel: 'information',
  panelWidth: initialPanelWidth(),
  uiScale: initialUiScale(),
  measureStart: null,
  spacePan: false,
  scaleLock: 'auto',
  currentScale: 0,
  movingContentId: null,
  movingTokenId: null,
  travelToTokenId: null,
  routePreview: null,
  senseHighlight: null,
  encounterDialogEntry: null,
  trailHighlight: null,
  areaHighlight: null,
  areaProposal: null,
  regionManagerOpen: false,
  areaPaint: null,
  regionTargetId: null,
  regionErase: false,
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
  // Selecting a hex is the deep link into the Information panel: a map click
  // (or a journal row) pops it open. Clearing the selection — Escape, mostly —
  // deliberately leaves the panels as they were, so Escape never opens one.
  selectHex: (hex) =>
    set((s) => ({
      selectedHex: hex,
      selectedTokenId: null,
      openPanel: hex ? 'information' : s.openPanel,
    })),
}));
