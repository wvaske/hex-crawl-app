import { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupWebSocket(app: Hono<any>) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  return { injectWebSocket, upgradeWebSocket };
}
