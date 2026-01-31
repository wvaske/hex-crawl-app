import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import campaigns from "./routes/campaigns.js";
import invitations from "./routes/invitations.js";
import mapRoutes from "./routes/map.js";

export type AppVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const app = new Hono<{ Variables: AppVariables }>();

// CORS must come before routes
const corsOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  "/api/*",
  cors({
    origin:
      process.env.NODE_ENV !== "production"
        ? (origin) => origin // allow any origin in dev
        : corsOrigins.length > 0
          ? corsOrigins
          : ["http://localhost:5173"],
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

// Map data routes
app.route("/api/campaigns", mapRoutes);

export default app;
export type AppType = typeof app;
