import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { campaignMember } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";

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
          ws.send(
            JSON.stringify({ type: "connected", userId, role })
          );
        },
        onMessage(event, _ws) {
          // Placeholder -- message handling will be implemented in later plans
          console.log(
            `[WS] Message from userId=${userId}: ${typeof event.data === "string" ? event.data : "[binary]"}`
          );
        },
        onClose() {
          console.log(
            `[WS] Disconnected: userId=${userId}, campaignId=${campaignId}`
          );
        },
      };
    })
  );
}
