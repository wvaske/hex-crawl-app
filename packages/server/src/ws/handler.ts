import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { campaignMember, sessionEvent } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { sessionManager } from "./session-manager.js";
import { handleClientMessage } from "./message-handlers.js";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://10.241.120.98:5173",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWsRoute(
  app: Hono<any>,
  upgradeWebSocket: UpgradeWebSocket<WebSocket>
) {
  app.get(
    "/ws",
    upgradeWebSocket(async (c) => {
      // 1. Validate Origin header (CSWSH protection)
      const origin = c.req.header("origin");
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return {
          onOpen(_evt, ws) {
            ws.close(4003, "Forbidden origin");
          },
        };
      }

      // 2. Authenticate via cookies
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      if (!session) {
        return {
          onOpen(_evt, ws) {
            ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
            ws.close(4001, "Unauthorized");
          },
        };
      }

      const userId = session.user.id;
      const userName = session.user.name;

      // 3. Extract campaignId from query params
      const url = new URL(c.req.url);
      const campaignId = url.searchParams.get("campaignId");

      if (!campaignId) {
        return {
          onOpen(_evt, ws) {
            ws.send(
              JSON.stringify({ type: "error", message: "Missing campaignId" })
            );
            ws.close(4002, "Missing campaignId");
          },
        };
      }

      // 4. Verify campaign membership
      const membership = await db
        .select()
        .from(campaignMember)
        .where(
          and(
            eq(campaignMember.userId, userId),
            eq(campaignMember.campaignId, campaignId)
          )
        )
        .limit(1);

      if (membership.length === 0) {
        return {
          onOpen(_evt, ws) {
            ws.send(
              JSON.stringify({ type: "error", message: "Not a member" })
            );
            ws.close(4003, "Not a member");
          },
        };
      }

      const role = membership[0]!.role as "dm" | "player";

      // 5. Return connection handlers
      return {
        onOpen(_evt, ws) {
          console.log(
            `[WS] Connected: userId=${userId}, campaignId=${campaignId}, role=${role}`
          );

          // Register connection in SessionManager
          sessionManager.addConnection(campaignId, userId, userName, role, ws);

          // Send initial connected confirmation
          ws.send(
            JSON.stringify({ type: "connected", userId, role })
          );

          // Send current session state
          const room = sessionManager.getRoom(campaignId);
          if (room) {
            // Build revealed hexes for this user
            const revealedHexes: string[] = [];
            for (const [hexKey, viewers] of room.revealedHexes) {
              if (role === "dm" || viewers.has(userId)) {
                revealedHexes.push(hexKey);
              }
            }

            ws.send(
              JSON.stringify({
                type: "session:state",
                status: room.status,
                broadcastMode: room.broadcastMode,
                connectedPlayers: sessionManager.getPresenceList(campaignId),
                revealedHexes,
              })
            );
          }

          // Broadcast player join to all others
          sessionManager.broadcastToAll(campaignId, {
            type: "player:joined",
            userId,
            name: userName,
          });

          // Broadcast updated presence list
          sessionManager.broadcastToAll(campaignId, {
            type: "player:presence",
            players: sessionManager.getPresenceList(campaignId),
          });

          // Log player_join event if there's an active session
          if (room?.sessionId && (room.status === "active" || room.status === "paused")) {
            // Fire and forget -- don't block onOpen
            void logPlayerEvent(room.sessionId, "player_join", userId);
          }
        },

        onMessage(event, _ws) {
          const data = typeof event.data === "string"
            ? event.data
            : event.data instanceof ArrayBuffer
              ? event.data
              : String(event.data);

          console.log(
            `[WS] Message from userId=${userId}: ${typeof data === "string" ? data : "[binary]"}`
          );

          // Dispatch to message handler (fire and forget -- errors handled internally)
          void handleClientMessage(campaignId, userId, role, data, ws);
        },

        onClose() {
          console.log(
            `[WS] Disconnected: userId=${userId}, campaignId=${campaignId}`
          );

          // Check for active session before removing connection
          const room = sessionManager.getRoom(campaignId);

          // Remove connection from SessionManager
          sessionManager.removeConnection(campaignId, userId);

          // Broadcast player left to remaining clients
          sessionManager.broadcastToAll(campaignId, {
            type: "player:left",
            userId,
          });

          // Broadcast updated presence list
          sessionManager.broadcastToAll(campaignId, {
            type: "player:presence",
            players: sessionManager.getPresenceList(campaignId),
          });

          // Log player_leave event if there was an active session
          if (room?.sessionId && (room.status === "active" || room.status === "paused")) {
            void logPlayerEvent(room.sessionId, "player_leave", userId);
          }
        },
      };
    })
  );
}

// ---------------------------------------------------------------------------
// Helper for logging player join/leave events
// ---------------------------------------------------------------------------

async function logPlayerEvent(
  sessionId: string,
  eventType: "player_join" | "player_leave",
  userId: string
): Promise<void> {
  try {
    await db.insert(sessionEvent).values({
      id: crypto.randomUUID(),
      sessionId,
      eventType,
      userId,
    });
  } catch (err) {
    console.error(`[WS] Failed to log ${eventType} event:`, err);
  }
}
