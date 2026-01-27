import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import campaigns from "./routes/campaigns.js";
import invitations from "./routes/invitations.js";

export type AppVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const app = new Hono<{ Variables: AppVariables }>();

// CORS must come before routes
app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173", "http://10.241.120.98:5173"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Health check (before auth-protected routers)
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Mount Better Auth handler
app.on(["POST", "GET"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

// Campaign routes
app.route("/api/campaigns", campaigns);

// Invitation routes (mounted at /api with full paths inside router)
app.route("/api", invitations);

export default app;
export type AppType = typeof app;
