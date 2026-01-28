import type { WSContext } from "hono/ws";
import { ClientMessageSchema } from "@hex-crawl/shared";
import type { ClientMessage } from "@hex-crawl/shared";
import { sessionManager } from "./session-manager.js";
import type { StagedChange } from "./session-manager.js";
import { db } from "../db/index.js";
import { gameSession, sessionEvent } from "../db/schema/index.js";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logSessionEvent(
  sessionId: string,
  eventType:
    | "session_start"
    | "session_pause"
    | "session_resume"
    | "session_end"
    | "hex_reveal"
    | "hex_update"
    | "player_join"
    | "player_leave",
  userId: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(sessionEvent).values({
      id: crypto.randomUUID(),
      sessionId,
      eventType,
      userId,
      payload: payload ?? null,
    });
  } catch (err) {
    console.error("[WS] Failed to log session event:", err);
  }
}

function sendError(ws: WSContext, message: string): void {
  try {
    ws.send(JSON.stringify({ type: "error", message }));
  } catch {
    // Client may have disconnected
  }
}

function isDmOnly(messageType: string): boolean {
  const dmOnlyTypes = new Set([
    "session:start",
    "session:pause",
    "session:resume",
    "session:end",
    "broadcast:mode",
    "broadcast:publish",
    "staged:undo",
    "hex:reveal",
    "hex:update",
  ]);
  return dmOnlyTypes.has(messageType);
}

// ---------------------------------------------------------------------------
// Main message dispatcher
// ---------------------------------------------------------------------------

export async function handleClientMessage(
  campaignId: string,
  userId: string,
  role: "dm" | "player",
  rawData: string | ArrayBuffer,
  ws: WSContext
): Promise<void> {
  // Parse raw data to string
  const dataStr =
    typeof rawData === "string" ? rawData : new TextDecoder().decode(rawData);

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataStr);
  } catch {
    sendError(ws, "Invalid JSON");
    return;
  }

  // Validate with Zod schema
  const result = ClientMessageSchema.safeParse(parsed);
  if (!result.success) {
    sendError(ws, `Invalid message: ${result.error.issues[0]?.message ?? "unknown error"}`);
    return;
  }

  const message = result.data;

  // Enforce DM-only actions
  if (isDmOnly(message.type) && role !== "dm") {
    sendError(ws, `Action '${message.type}' is restricted to the DM`);
    return;
  }

  // Dispatch to handler
  switch (message.type) {
    case "session:start":
      await handleSessionStart(campaignId, userId);
      break;
    case "session:pause":
      await handleSessionPause(campaignId, userId);
      break;
    case "session:resume":
      await handleSessionResume(campaignId, userId);
      break;
    case "session:end":
      await handleSessionEnd(campaignId, userId);
      break;
    case "broadcast:mode":
      await handleBroadcastMode(campaignId, userId, message);
      break;
    case "broadcast:publish":
      await handleBroadcastPublish(campaignId, userId);
      break;
    case "staged:undo":
      handleStagedUndo(campaignId, message);
      break;
    case "hex:reveal":
      await handleHexReveal(campaignId, userId, message);
      break;
    case "hex:update":
      await handleHexUpdate(campaignId, userId, message);
      break;
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle handlers
// ---------------------------------------------------------------------------

async function handleSessionStart(
  campaignId: string,
  userId: string
): Promise<void> {
  const room = sessionManager.getOrCreateRoom(campaignId);

  if (room.status === "active") {
    sessionManager.broadcastToDM(campaignId, {
      type: "error",
      message: "Session is already active",
    });
    return;
  }

  // Create a new game_session record
  const sessionId = crypto.randomUUID();
  try {
    await db.insert(gameSession).values({
      id: sessionId,
      campaignId,
      startedBy: userId,
      status: "active",
    });
  } catch (err) {
    console.error("[WS] Failed to create game session:", err);
    sessionManager.broadcastToDM(campaignId, {
      type: "error",
      message: "Failed to start session",
    });
    return;
  }

  // Update in-memory state
  sessionManager.setSessionStatus(campaignId, "active", sessionId);

  // Log event
  await logSessionEvent(sessionId, "session_start", userId);

  // Broadcast status change to all
  sessionManager.broadcastToAll(campaignId, {
    type: "session:statusChanged",
    status: "active",
  });
}

async function handleSessionPause(
  campaignId: string,
  userId: string
): Promise<void> {
  const room = sessionManager.getRoom(campaignId);

  if (!room || room.status !== "active") {
    sessionManager.broadcastToDM(campaignId, {
      type: "error",
      message: "No active session to pause",
    });
    return;
  }

  // Update DB
  if (room.sessionId) {
    try {
      await db
        .update(gameSession)
        .set({ status: "paused" })
        .where(eq(gameSession.id, room.sessionId));
    } catch (err) {
      console.error("[WS] Failed to update session status:", err);
    }
  }

  // Update in-memory state
  sessionManager.setSessionStatus(campaignId, "paused");

  // Log event
  if (room.sessionId) {
    await logSessionEvent(room.sessionId, "session_pause", userId);
  }

  // Broadcast status change to all
  sessionManager.broadcastToAll(campaignId, {
    type: "session:statusChanged",
    status: "paused",
  });
}

async function handleSessionResume(
  campaignId: string,
  userId: string
): Promise<void> {
  const room = sessionManager.getRoom(campaignId);

  if (!room || room.status !== "paused") {
    sessionManager.broadcastToDM(campaignId, {
      type: "error",
      message: "No paused session to resume",
    });
    return;
  }

  // Update DB
  if (room.sessionId) {
    try {
      await db
        .update(gameSession)
        .set({ status: "active" })
        .where(eq(gameSession.id, room.sessionId));
    } catch (err) {
      console.error("[WS] Failed to update session status:", err);
    }
  }

  // Update in-memory state
  sessionManager.setSessionStatus(campaignId, "active");

  // Log event
  if (room.sessionId) {
    await logSessionEvent(room.sessionId, "session_resume", userId);
  }

  // Broadcast status change to all
  sessionManager.broadcastToAll(campaignId, {
    type: "session:statusChanged",
    status: "active",
  });
}

async function handleSessionEnd(
  campaignId: string,
  userId: string
): Promise<void> {
  const room = sessionManager.getRoom(campaignId);

  if (!room || (room.status !== "active" && room.status !== "paused")) {
    sessionManager.broadcastToDM(campaignId, {
      type: "error",
      message: "No active or paused session to end",
    });
    return;
  }

  // Update DB
  if (room.sessionId) {
    try {
      await db
        .update(gameSession)
        .set({ status: "ended", endedAt: new Date() })
        .where(eq(gameSession.id, room.sessionId));
    } catch (err) {
      console.error("[WS] Failed to update session status:", err);
    }
  }

  // Log event before clearing state
  if (room.sessionId) {
    await logSessionEvent(room.sessionId, "session_end", userId);
  }

  // Update in-memory state
  sessionManager.setSessionStatus(campaignId, "ended");

  // Clear staged changes on session end
  sessionManager.clearStagedChanges(campaignId);

  // Broadcast status change to all
  sessionManager.broadcastToAll(campaignId, {
    type: "session:statusChanged",
    status: "ended",
  });
}

// ---------------------------------------------------------------------------
// Broadcast mode handlers
// ---------------------------------------------------------------------------

function handleBroadcastMode(
  campaignId: string,
  _userId: string,
  message: Extract<ClientMessage, { type: "broadcast:mode" }>
): void {
  const room = sessionManager.getRoom(campaignId);
  if (!room) return;

  sessionManager.setBroadcastMode(campaignId, message.mode);

  // Notify all clients of the mode change
  sessionManager.broadcastToAll(campaignId, {
    type: "dm:preparing",
    preparing: message.mode === "staged",
  });
}

async function handleBroadcastPublish(
  campaignId: string,
  userId: string
): Promise<void> {
  const room = sessionManager.getRoom(campaignId);
  if (!room) return;

  const stagedChanges = sessionManager.clearStagedChanges(campaignId);

  if (stagedChanges.length === 0) {
    sessionManager.broadcastToDM(campaignId, {
      type: "error",
      message: "No staged changes to publish",
    });
    return;
  }

  // Process each staged change and broadcast to players
  for (const change of stagedChanges) {
    if (change.type === "hex:reveal") {
      const revealData = change.data as {
        hexKeys: string[];
        terrain: Array<{ key: string; terrain: string }>;
      };
      sessionManager.broadcastToPlayers(campaignId, {
        type: "hex:revealed",
        hexKeys: revealData.hexKeys,
        terrain: revealData.terrain,
      });
    } else if (change.type === "hex:update") {
      const updateData = change.data as {
        changes: Array<{ key: string; terrain: string }>;
      };
      sessionManager.broadcastToPlayers(campaignId, {
        type: "hex:updated",
        changes: updateData.changes,
      });
    }
  }

  // Log the publish event
  if (room.sessionId) {
    await logSessionEvent(room.sessionId, "hex_reveal", userId, {
      action: "broadcast_publish",
      changeCount: stagedChanges.length,
    });
  }

  // Notify DM that staged changes were published
  sessionManager.broadcastToDM(campaignId, {
    type: "staged:changes",
    changes: [],
  });
}

// ---------------------------------------------------------------------------
// Staged change handlers
// ---------------------------------------------------------------------------

function handleStagedUndo(
  campaignId: string,
  message: Extract<ClientMessage, { type: "staged:undo" }>
): void {
  const removed = sessionManager.undoStagedChange(campaignId, message.index);

  if (!removed) {
    sessionManager.broadcastToDM(campaignId, {
      type: "error",
      message: "Invalid staged change index",
    });
    return;
  }

  // Send updated staged changes list to DM
  const room = sessionManager.getRoom(campaignId);
  if (room) {
    sessionManager.broadcastToDM(campaignId, {
      type: "staged:changes",
      changes: room.stagedChanges,
    });
  }
}

// ---------------------------------------------------------------------------
// Hex handlers
// ---------------------------------------------------------------------------

async function handleHexReveal(
  campaignId: string,
  userId: string,
  message: Extract<ClientMessage, { type: "hex:reveal" }>
): Promise<void> {
  const room = sessionManager.getRoom(campaignId);
  if (!room) return;

  // Update in-memory reveal state
  const targetPlayerIds =
    message.targets === "all"
      ? undefined
      : message.targets.playerIds;

  // Track which hexes are revealed to which users
  for (const hexKey of message.hexKeys) {
    if (!room.revealedHexes.has(hexKey)) {
      room.revealedHexes.set(hexKey, new Set());
    }
    const viewers = room.revealedHexes.get(hexKey)!;
    if (targetPlayerIds) {
      for (const pid of targetPlayerIds) {
        viewers.add(pid);
      }
    } else {
      // "all" -- add all currently connected players
      for (const client of room.connectedClients.values()) {
        if (client.role === "player") {
          viewers.add(client.userId);
        }
      }
    }
  }

  // Build terrain data (placeholder -- actual terrain data comes from client message or DB)
  const terrain = message.hexKeys.map((key) => ({
    key,
    terrain: "revealed",
  }));

  const revealPayload = {
    type: "hex:revealed" as const,
    hexKeys: message.hexKeys,
    terrain,
  };

  if (room.broadcastMode === "staged") {
    // Stage the change instead of broadcasting
    const stagedChange: StagedChange = {
      id: crypto.randomUUID(),
      description: `Reveal ${message.hexKeys.length} hex(es)`,
      type: "hex:reveal",
      data: revealPayload,
    };
    sessionManager.addStagedChange(campaignId, stagedChange);

    // Notify DM of updated staged changes
    sessionManager.broadcastToDM(campaignId, {
      type: "staged:changes",
      changes: room.stagedChanges,
    });
  } else {
    // Immediate mode -- broadcast to target players
    sessionManager.broadcastToPlayers(
      campaignId,
      revealPayload,
      targetPlayerIds
    );
  }

  // Log event
  if (room.sessionId) {
    await logSessionEvent(room.sessionId, "hex_reveal", userId, {
      hexKeys: message.hexKeys,
      targets: message.targets,
    });
  }
}

async function handleHexUpdate(
  campaignId: string,
  userId: string,
  message: Extract<ClientMessage, { type: "hex:update" }>
): Promise<void> {
  const room = sessionManager.getRoom(campaignId);
  if (!room) return;

  const updatePayload = {
    type: "hex:updated" as const,
    changes: message.changes,
  };

  if (room.broadcastMode === "staged") {
    // Stage the change instead of broadcasting
    const stagedChange: StagedChange = {
      id: crypto.randomUUID(),
      description: `Update ${message.changes.length} hex(es)`,
      type: "hex:update",
      data: { changes: message.changes },
    };
    sessionManager.addStagedChange(campaignId, stagedChange);

    // Notify DM of updated staged changes
    sessionManager.broadcastToDM(campaignId, {
      type: "staged:changes",
      changes: room.stagedChanges,
    });
  } else {
    // Immediate mode -- broadcast to all players
    sessionManager.broadcastToPlayers(campaignId, updatePayload);
  }

  // Log event
  if (room.sessionId) {
    await logSessionEvent(room.sessionId, "hex_update", userId, {
      changes: message.changes,
    });
  }
}
