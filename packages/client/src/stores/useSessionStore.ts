import { create } from 'zustand';
import type {
  ServerMessage,
  ClientMessage,
  ConnectionStatus,
  SessionStatus,
  BroadcastMode,
  PlayerPresence,
  StagedChange,
  TerrainType,
} from '@hex-crawl/shared';
import { useMapStore } from './useMapStore';
import { useTokenStore } from './useTokenStore';
import { useImageLayerStore } from './useImageLayerStore';
import { clearPendingMove } from '../canvas/HexInteraction';

interface SessionState {
  /** WebSocket connection status */
  connectionStatus: ConnectionStatus;

  /** Current session lifecycle status */
  sessionStatus: SessionStatus;

  /** DM broadcast mode -- immediate pushes changes live, staged queues them */
  broadcastMode: BroadcastMode;

  /** Current user's role in this campaign */
  userRole: 'dm' | 'player' | null;

  /** Current user's ID */
  userId: string | null;

  /** Connected players keyed by userId */
  connectedPlayers: Map<string, PlayerPresence>;

  /** Staged changes waiting for DM to publish (DM only) */
  stagedChanges: StagedChange[];

  /** Whether the DM is currently preparing (shown to players) */
  dmPreparing: boolean;

  /** Hex keys revealed to this client (Phase 4 will populate) */
  revealedHexKeys: Set<string>;

  /** Hex keys adjacent to revealed hexes (tier-1 fog for players) */
  adjacentHexKeys: Set<string>;

  /** Current campaign ID (set when WebSocket connects) */
  campaignId: string | null;
}

interface SessionActions {
  /** Update the WebSocket connection status */
  setConnectionStatus: (status: ConnectionStatus) => void;

  /** Dispatch a server message into the store (switch on message.type) */
  dispatch: (message: ServerMessage) => void;

  /** Reset all session state to initial values */
  reset: () => void;

  /** Send a message over WebSocket (set by useWebSocket hook) */
  sendMessage: ((msg: ClientMessage) => void) | null;

  /** Set the sendMessage function (called by useWebSocket hook) */
  setSendMessage: (fn: ((msg: ClientMessage) => void) | null) => void;

  /** Set the current campaign ID */
  setCampaignId: (id: string | null) => void;
}

export type SessionStore = SessionState & SessionActions;

const initialState: SessionState = {
  connectionStatus: 'disconnected',
  sessionStatus: 'waiting',
  broadcastMode: 'immediate',
  userRole: null,
  userId: null,
  connectedPlayers: new Map(),
  stagedChanges: [],
  dmPreparing: false,
  revealedHexKeys: new Set(),
  adjacentHexKeys: new Set(),
  campaignId: null,
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initialState,

  // Actions
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  dispatch: (message) => {
    switch (message.type) {
      case 'connected':
        set({ userRole: message.role, userId: message.userId });
        break;

      case 'session:state': {
        // Build new Map from player array -- always new instance (PITFALL 6)
        const players = new Map<string, PlayerPresence>();
        for (const p of message.connectedPlayers) {
          players.set(p.userId, p);
        }
        // Build new Set from revealed hex keys -- always new instance (PITFALL 6)
        const revealed = new Set(message.revealedHexes);
        const adjacent = message.adjacentHexes
          ? new Set(message.adjacentHexes.map((h) => h.key))
          : new Set<string>();
        set({
          sessionStatus: message.status,
          broadcastMode: message.broadcastMode,
          connectedPlayers: players,
          revealedHexKeys: revealed,
          adjacentHexKeys: adjacent,
        });
        // For players: seed map store with terrain from adjacentHexes
        if (get().userRole === 'player' && message.adjacentHexes) {
          const mapState = useMapStore.getState();
          const hexes = new Map(mapState.hexes);
          for (const a of message.adjacentHexes) {
            if (!hexes.has(a.key)) {
              const [qStr, rStr] = a.key.split(',');
              hexes.set(a.key, { q: Number(qStr), r: Number(rStr), terrain: a.terrain as TerrainType, terrainVariant: 0 });
            }
          }
          useMapStore.setState({ hexes });
        }
        break;
      }

      case 'session:statusChanged':
        set({ sessionStatus: message.status });
        break;

      case 'player:joined':
        set((state) => {
          // New Map from existing + new entry (PITFALL 6)
          const players = new Map(state.connectedPlayers);
          players.set(message.userId, {
            userId: message.userId,
            name: message.name,
            online: true,
          });
          return { connectedPlayers: players };
        });
        break;

      case 'player:left':
        set((state) => {
          // New Map without the leaving player (PITFALL 6)
          const players = new Map(state.connectedPlayers);
          players.delete(message.userId);
          return { connectedPlayers: players };
        });
        break;

      case 'player:presence': {
        // Replace entire player list -- new Map (PITFALL 6)
        const players = new Map<string, PlayerPresence>();
        for (const p of message.players) {
          players.set(p.userId, p);
        }
        set({ connectedPlayers: players });
        break;
      }

      case 'dm:preparing':
        set({ dmPreparing: message.preparing });
        break;

      case 'staged:changes':
        set({ stagedChanges: message.changes });
        break;

      case 'hex:revealed': {
        // Update fog state
        set((state) => {
          const revealed = new Set(state.revealedHexKeys);
          for (const key of message.hexKeys) {
            revealed.add(key);
          }
          const adjacent = message.adjacentHexes
            ? new Set(message.adjacentHexes.map((h) => h.key))
            : new Set(state.adjacentHexKeys);
          for (const key of revealed) {
            adjacent.delete(key);
          }
          return { revealedHexKeys: revealed, adjacentHexKeys: adjacent };
        });
        // Add revealed terrain data to map store (players only — DM already has all terrain)
        if (get().userRole === 'player' && message.terrain) {
          const mapState = useMapStore.getState();
          const hexes = new Map(mapState.hexes);
          for (const t of message.terrain) {
            if (!hexes.has(t.key)) {
              const [qStr, rStr] = t.key.split(',');
              hexes.set(t.key, { q: Number(qStr), r: Number(rStr), terrain: t.terrain as TerrainType, terrainVariant: 0 });
            }
          }
          if (message.adjacentHexes) {
            for (const a of message.adjacentHexes) {
              if (!hexes.has(a.key)) {
                const [qStr, rStr] = a.key.split(',');
                hexes.set(a.key, { q: Number(qStr), r: Number(rStr), terrain: a.terrain as TerrainType, terrainVariant: 0 });
              }
            }
          }
          useMapStore.setState({ hexes });
        }
        break;
      }

      case 'hex:hidden': {
        set((state) => {
          const revealed = new Set(state.revealedHexKeys);
          for (const key of message.hexKeys) {
            revealed.delete(key);
          }
          const adjacent = message.adjacentHexes
            ? new Set(message.adjacentHexes.map((h) => h.key))
            : new Set<string>();
          for (const key of revealed) {
            adjacent.delete(key);
          }
          return { revealedHexKeys: revealed, adjacentHexKeys: adjacent };
        });
        // Remove hidden hex terrain from map store (players only — DM keeps all hex data)
        if (get().userRole === 'player') {
          const mapState = useMapStore.getState();
          const hexes = new Map(mapState.hexes);
          for (const key of message.hexKeys) {
            hexes.delete(key);
          }
          useMapStore.setState({ hexes });
        }
        break;
      }

      case 'hex:updated':
        // Phase 4 will handle hex terrain updates on the map store
        break;

      case 'token:moved': {
        const currentUserId = get().userId;
        // Only update store for remote moves (local was already optimistically applied)
        if (message.movedBy !== currentUserId) {
          useTokenStore.getState().moveToken(message.tokenId, message.toHexKey);
        }
        clearPendingMove(message.tokenId);
        break;
      }

      case 'token:created':
        useTokenStore.getState().addToken(message.token);
        break;

      case 'token:updated':
        useTokenStore.getState().updateToken(message.tokenId, message.updates);
        break;

      case 'token:deleted':
        useTokenStore.getState().removeToken(message.tokenId);
        break;

      case 'token:state':
        useTokenStore.getState().setTokens(message.tokens);
        break;

      case 'layer:added':
        useImageLayerStore.getState().addLayer(message.layer);
        break;

      case 'layer:updated':
        useImageLayerStore.getState().updateLayer(message.layerId, message.updates as Record<string, unknown>);
        break;

      case 'layer:removed':
        useImageLayerStore.getState().removeLayer(message.layerId);
        break;

      case 'map:updated':
        useImageLayerStore.getState().setGridSettings(message.updates as Record<string, unknown>);
        break;

      case 'error':
        console.error('[WS Error]', message.message);
        break;
    }
  },

  reset: () => set({ ...initialState }),

  sendMessage: null,

  setSendMessage: (fn) => set({ sendMessage: fn }),

  setCampaignId: (id) => set({ campaignId: id }),
}));
