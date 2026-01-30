import type { WSContext } from "hono/ws";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectedClient {
  userId: string;
  name: string;
  role: "dm" | "player";
  ws: WSContext;
}

export interface StagedChange {
  id: string;
  description: string;
  type: string;
  data: unknown;
}

export interface SessionRoom {
  campaignId: string;
  sessionId: string | null;
  status: "waiting" | "active" | "paused" | "ended";
  broadcastMode: "immediate" | "staged";
  stagedChanges: StagedChange[];
  connectedClients: Map<string, ConnectedClient>;
  /** hexKey -> Set of userIds who can see that hex */
  revealedHexes: Map<string, Set<string>>;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private rooms = new Map<string, SessionRoom>();

  /**
   * Get an existing room or create a new one in "waiting" state.
   */
  getOrCreateRoom(campaignId: string): SessionRoom {
    let room = this.rooms.get(campaignId);
    if (!room) {
      room = {
        campaignId,
        sessionId: null,
        status: "waiting",
        broadcastMode: "immediate",
        stagedChanges: [],
        connectedClients: new Map(),
        revealedHexes: new Map(),
      };
      this.rooms.set(campaignId, room);
    }
    return room;
  }

  /**
   * Register a client connection in a campaign room.
   */
  addConnection(
    campaignId: string,
    userId: string,
    name: string,
    role: "dm" | "player",
    ws: WSContext
  ): void {
    const room = this.getOrCreateRoom(campaignId);
    const existing = room.connectedClients.get(userId);
    if (existing && existing.ws !== ws) {
      console.log(
        `[WS] Replacing existing connection for userId=${userId} in campaign=${campaignId}`
      );
      try {
        existing.ws.close(4000, "Replaced by new connection");
      } catch {
        // already closed
      }
    }
    room.connectedClients.set(userId, { userId, name, role, ws });
  }

  /**
   * Remove a client connection from a campaign room.
   * If the room is empty and not active, clean it up.
   */
  removeConnection(campaignId: string, userId: string): void {
    const room = this.rooms.get(campaignId);
    if (!room) return;

    room.connectedClients.delete(userId);

    // Clean up empty rooms that are not in an active/paused session
    if (
      room.connectedClients.size === 0 &&
      (room.status === "waiting" || room.status === "ended")
    ) {
      this.rooms.delete(campaignId);
    }
  }

  /**
   * Send a message to all clients in a room that pass the optional filter.
   */
  broadcastToRoom(
    campaignId: string,
    message: object,
    filter?: (client: ConnectedClient) => boolean
  ): void {
    const room = this.rooms.get(campaignId);
    if (!room) return;

    const payload = JSON.stringify(message);
    for (const client of room.connectedClients.values()) {
      if (!filter || filter(client)) {
        try {
          client.ws.send(payload);
        } catch {
          // Client may have disconnected; ignore send errors
        }
      }
    }
  }

  /**
   * Send a message to only the DM in a room.
   */
  broadcastToDM(campaignId: string, message: object): void {
    this.broadcastToRoom(campaignId, message, (c) => c.role === "dm");
  }

  /**
   * Send a message to players in a room, optionally filtered to specific player IDs.
   */
  broadcastToPlayers(
    campaignId: string,
    message: object,
    playerIds?: string[]
  ): void {
    this.broadcastToRoom(campaignId, message, (c) => {
      if (c.role !== "player") return false;
      return !playerIds || playerIds.includes(c.userId);
    });
  }

  /**
   * Send a message to all connected clients in a room (DM and players).
   */
  broadcastToAll(campaignId: string, message: object): void {
    this.broadcastToRoom(campaignId, message);
  }

  /**
   * Get a room without creating it.
   */
  getRoom(campaignId: string): SessionRoom | undefined {
    return this.rooms.get(campaignId);
  }

  /**
   * Get the presence list for a campaign room.
   */
  getPresenceList(
    campaignId: string
  ): Array<{ userId: string; name: string; online: boolean }> {
    const room = this.rooms.get(campaignId);
    if (!room) return [];

    return Array.from(room.connectedClients.values()).map((client) => ({
      userId: client.userId,
      name: client.name,
      online: true,
    }));
  }

  /**
   * Set the session status for a room.
   * Optionally set the sessionId (e.g., when starting a session).
   */
  setSessionStatus(
    campaignId: string,
    status: SessionRoom["status"],
    sessionId?: string
  ): void {
    const room = this.getOrCreateRoom(campaignId);
    room.status = status;
    if (sessionId !== undefined) {
      room.sessionId = sessionId;
    }
  }

  /**
   * Set the broadcast mode for a room (immediate or staged).
   */
  setBroadcastMode(campaignId: string, mode: "immediate" | "staged"): void {
    const room = this.getOrCreateRoom(campaignId);
    room.broadcastMode = mode;

    // Clear staged changes when switching to immediate mode
    if (mode === "immediate") {
      room.stagedChanges = [];
    }
  }

  /**
   * Add a staged change to a room's queue.
   */
  addStagedChange(campaignId: string, change: StagedChange): void {
    const room = this.getOrCreateRoom(campaignId);
    room.stagedChanges.push(change);
  }

  /**
   * Remove a staged change by index. Returns the removed change or null.
   */
  undoStagedChange(campaignId: string, index: number): StagedChange | null {
    const room = this.rooms.get(campaignId);
    if (!room) return null;

    if (index < 0 || index >= room.stagedChanges.length) return null;

    const [removed] = room.stagedChanges.splice(index, 1);
    return removed ?? null;
  }

  /**
   * Clear all staged changes from a room. Returns the cleared changes.
   */
  clearStagedChanges(campaignId: string): StagedChange[] {
    const room = this.rooms.get(campaignId);
    if (!room) return [];

    const cleared = room.stagedChanges;
    room.stagedChanges = [];
    return cleared;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const sessionManager = new SessionManager();
