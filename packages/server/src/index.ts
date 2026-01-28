import "dotenv/config";
import { serve } from "@hono/node-server";
import app from "./app.js";
import { setupWebSocket } from "./ws/setup.js";
import { createWsRoute } from "./ws/handler.js";

const { injectWebSocket, upgradeWebSocket } = setupWebSocket(app);
createWsRoute(app, upgradeWebSocket);

const port = Number(process.env.PORT) || 3000;

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`Server running at http://0.0.0.0:${info.port}`);
  }
);

injectWebSocket(server);
