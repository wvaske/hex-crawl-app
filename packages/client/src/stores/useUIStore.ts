import { create } from 'zustand';

export type SidePanelTab = 'info' | 'terrain' | 'create' | 'import-export' | 'fog';

export interface DragRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface UIState {
  /** Currently selected hex keys */
  selectedHexes: Set<string>;
  /** Currently hovered hex key */
  hoveredHex: string | null;
  /** Active side panel tab */
  sidePanel: SidePanelTab;
  /** Whether the map creation dialog is showing */
  showCreationDialog: boolean;
  /** Current shift+drag selection rectangle in world coords (null when not dragging) */
  dragRect: DragRect | null;
}

interface UIActions {
  /** Select a single hex (clears other selections) */
  selectHex: (key: string) => void;
  /** Toggle a hex in the selection (shift-click add/remove) */
  toggleSelectHex: (key: string) => void;
  /** Clear all hex selections */
  clearSelection: () => void;
  /** Set the hovered hex */
  setHoveredHex: (key: string | null) => void;
  /** Set the active side panel tab */
  setSidePanel: (panel: SidePanelTab) => void;
  /** Show or hide the creation dialog */
  setShowCreationDialog: (show: boolean) => void;
  /** Set the drag selection rectangle (world coords) */
  setDragRect: (rect: DragRect | null) => void;
}

export type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>((set) => ({
  // State
  selectedHexes: new Set(),
  hoveredHex: null,
  sidePanel: 'info',
  showCreationDialog: false,
  dragRect: null,

  // Actions
  selectHex: (key) =>
    set({ selectedHexes: new Set([key]) }), // New Set (PITFALL 6)

  toggleSelectHex: (key) =>
    set((state) => {
      const selected = new Set(state.selectedHexes); // New Set (PITFALL 6)
      if (selected.has(key)) {
        selected.delete(key);
      } else {
        selected.add(key);
      }
      return { selectedHexes: selected };
    }),

  clearSelection: () =>
    set({ selectedHexes: new Set() }),

  setHoveredHex: (key) =>
    set({ hoveredHex: key }),

  setSidePanel: (panel) =>
    set({ sidePanel: panel }),

  setShowCreationDialog: (show) =>
    set({ showCreationDialog: show }),

  setDragRect: (rect) =>
    set({ dragRect: rect }),
}));
