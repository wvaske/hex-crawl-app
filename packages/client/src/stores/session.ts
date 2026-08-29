import { create } from 'zustand';
import type {
  CampaignState,
  FogState,
  SeatRole,
  TerrainId,
} from '@hexcrawl/shared';
import { hexKey } from '@hexcrawl/shared';

export interface Toast {
  id: number;
  kind: 'discovery' | 'narration' | 'info' | 'error';
  title: string;
  text: string;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface SessionStore {
  status: ConnectionStatus;
  seatId: string | null;
  role: SeatRole | null;
  state: CampaignState | null;
  /** Bumped on every snapshot so imperative consumers can subscribe cheaply. */
  version: number;
  toasts: Toast[];

  setStatus(status: ConnectionStatus): void;
  applySnapshot(seatId: string, role: SeatRole, state: CampaignState): void;
  pushToast(toast: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;

  // Optimistic local edits (server snapshot supersedes them shortly after).
  optimisticPaint(mapId: string, cells: { q: number; r: number }[], terrain: TerrainId | null): void;
  optimisticFog(mapId: string, cells: { q: number; r: number }[], fogState: FogState): void;
  optimisticTokenMove(tokenId: string, q: number, r: number): void;
}

let toastCounter = 1;

export const useSession = create<SessionStore>((set, get) => ({
  status: 'connecting',
  seatId: null,
  role: null,
  state: null,
  version: 0,
  toasts: [],

  setStatus: (status) => set({ status }),

  applySnapshot: (seatId, role, state) =>
    set((s) => ({ seatId, role, state, version: s.version + 1 })),

  pushToast: (toast) => {
    const id = toastCounter++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => get().dismissToast(id), toast.kind === 'discovery' ? 12000 : 6000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  optimisticPaint: (mapId, cells, terrain) =>
    set((s) => {
      if (!s.state?.mapState || s.state.campaign.activeMapId !== mapId) return s;
      const keys = new Set(cells.map((c) => hexKey(c.q, c.r)));
      let hexes = s.state.mapState.hexes.filter((h) => !keys.has(hexKey(h.q, h.r)));
      if (terrain !== null) {
        hexes = [...hexes, ...cells.map((c) => ({ q: c.q, r: c.r, terrain }))];
      }
      return {
        state: { ...s.state, mapState: { ...s.state.mapState, hexes } },
        version: s.version + 1,
      };
    }),

  optimisticFog: (mapId, cells, fogState) =>
    set((s) => {
      if (!s.state?.mapState || s.state.campaign.activeMapId !== mapId) return s;
      const keys = new Set(cells.map((c) => hexKey(c.q, c.r)));
      let fog = s.state.mapState.fog.filter((f) => !keys.has(hexKey(f.q, f.r)));
      if (fogState !== 'hidden') {
        fog = [...fog, ...cells.map((c) => ({ q: c.q, r: c.r, state: fogState }))];
      }
      return {
        state: { ...s.state, mapState: { ...s.state.mapState, fog } },
        version: s.version + 1,
      };
    }),

  optimisticTokenMove: (tokenId, q, r) =>
    set((s) => {
      if (!s.state?.mapState) return s;
      const tokens = s.state.mapState.tokens.map((t) => (t.id === tokenId ? { ...t, q, r } : t));
      return {
        state: { ...s.state, mapState: { ...s.state.mapState, tokens } },
        version: s.version + 1,
      };
    }),
}));

/** Convenience selectors. */
export function activeMap(state: CampaignState | null) {
  if (!state?.campaign.activeMapId) return null;
  return state.maps.find((m) => m.id === state.campaign.activeMapId) ?? null;
}

export function myCharacterId(): string | null {
  const s = useSession.getState();
  const seat = s.state?.seats.find((seat) => seat.id === s.seatId);
  return seat?.characterId ?? null;
}
