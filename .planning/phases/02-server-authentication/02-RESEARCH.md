# Phase 2: Server & Authentication - Research

**Researched:** 2026-01-27
**Domain:** Node.js server setup, authentication, PostgreSQL persistence, campaign/invite CRUD
**Confidence:** HIGH

## Summary

Phase 2 transforms the client-only hex crawl SPA into a full-stack application with user accounts, campaigns, and persistent data. The server package (`packages/server`) will be built on Hono with `@hono/node-server`, using Better Auth for email/password authentication and session management, Drizzle ORM for PostgreSQL persistence, and Zod for request validation. The existing pnpm monorepo already has a placeholder `packages/server` directory.

The established stack (Hono + Better Auth + Drizzle + PostgreSQL) is well-documented and has first-class integrations between components. Better Auth has an official Hono integration guide and a Drizzle adapter. Drizzle has native PostgreSQL support with type-safe schema definitions. The main complexity lies in wiring these together correctly: mounting Better Auth on Hono, configuring CORS for the separate Vite dev server, and defining the database schema that covers both auth tables (managed by Better Auth) and application tables (campaigns, invitations).

**Primary recommendation:** Use Better Auth with its Drizzle adapter for authentication, mount it on Hono at `/api/auth/*`, define application schema alongside Better Auth's generated schema in Drizzle, and use `drizzle-kit` for migrations. Run PostgreSQL 16 locally via `apt install` (Docker is not available in this environment).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hono` | ^4.11 | HTTP framework | Prior decision from stack research. TypeScript-first, 14KB, built-in CORS/JWT middleware. Official Better Auth integration. |
| `@hono/node-server` | latest | Node.js adapter for Hono | Required to run Hono on Node.js. Uses web standard APIs from Node.js 18+. |
| `better-auth` | ^1.4 | Authentication | Prior decision. Framework-agnostic, email/password built-in, session-based auth with cookie management, Drizzle adapter. |
| `drizzle-orm` | ^0.45 | ORM / query builder | Prior decision. SQL-transparent, TypeScript schema definitions, zero binary dependencies, native PostgreSQL support. |
| `pg` | ^8.x | PostgreSQL driver (node-postgres) | Most stable Node.js PostgreSQL driver. Pool-based connection management. Works with Drizzle's `drizzle-orm/node-postgres` adapter. |
| `drizzle-kit` | latest (dev) | Schema migrations | Companion CLI for Drizzle ORM. Generates and applies SQL migrations from TypeScript schema changes. |
| `zod` | ^4.0 | Request validation | Already used in `@hex-crawl/shared`. Used with `@hono/zod-validator` for type-safe API validation. |
| `@hono/zod-validator` | latest | Hono validation middleware | Connects Zod schemas to Hono route handlers. Validates `json`, `query`, `param`, `header`, `cookie`, and `form` targets. |
| `tsx` | latest (dev) | TypeScript runner | Fast TypeScript execution via esbuild. `tsx watch` for development with auto-restart on file changes. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/pg` | latest (dev) | TypeScript types for node-postgres | Always -- needed for type checking with the `pg` driver |
| `dotenv` | latest | Environment variable loading | Load `.env` file for local development (DATABASE_URL, BETTER_AUTH_SECRET, etc.) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg` (node-postgres) | `postgres` (postgres.js) | postgres.js uses prepared statements by default (can cause issues in some environments). node-postgres is more battle-tested with connection pooling and has optional `pg-native` for 10% speed boost. Both work with Drizzle. |
| `tsx watch` | `node --watch --experimental-strip-types` | Native Node.js 24 supports TypeScript stripping natively, but `tsx` is more robust for watch mode and handles edge cases better. |
| `@hono/zod-validator` | Hono built-in validator | Zod validator provides richer error messages and integrates with existing Zod schemas from `@hex-crawl/shared`. |

**Installation (packages/server):**
```bash
pnpm add hono @hono/node-server better-auth drizzle-orm pg zod @hono/zod-validator dotenv
pnpm add -D drizzle-kit @types/pg tsx typescript @types/node
```

**Installation (packages/client -- auth client):**
```bash
pnpm add better-auth
```

## Architecture Patterns

### Recommended Project Structure

```
packages/server/
├── src/
│   ├── index.ts              # Server entry point (Hono app + serve)
│   ├── app.ts                # Hono app definition (routes, middleware)
│   ├── auth.ts               # Better Auth instance configuration
│   ├── db/
│   │   ├── index.ts          # Drizzle database connection (Pool + drizzle)
│   │   ├── schema/
│   │   │   ├── auth.ts       # Better Auth generated schema (user, session, account, verification)
│   │   │   ├── campaign.ts   # Campaign, campaign_member tables
│   │   │   ├── invitation.ts # Invitation table
│   │   │   └── index.ts      # Barrel export of all schema
│   │   └── seed.ts           # Optional dev seed data
│   ├── routes/
│   │   ├── campaigns.ts      # Campaign CRUD routes
│   │   └── invitations.ts    # Invitation routes
│   └── middleware/
│       └── auth.ts           # Session middleware (extracts user/session from context)
├── drizzle/                   # Generated migration SQL files
├── drizzle.config.ts          # Drizzle Kit configuration
├── package.json
└── tsconfig.json
```

### Pattern 1: Better Auth + Hono Mount

**What:** Mount Better Auth's handler on Hono at `/api/auth/*` to handle all auth routes automatically.
**When to use:** Always -- this is the only supported way to integrate Better Auth with Hono.
**Confidence:** HIGH (verified from official Better Auth Hono integration docs)

```typescript
// src/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/index.js";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true, // auto sign in after sign up
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,  // 7 days
    updateAge: 60 * 60 * 24,       // refresh every 24h
  },
  trustedOrigins: [
    "http://localhost:5173", // Vite dev server
  ],
});

// src/app.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.js";

type AppVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const app = new Hono<{ Variables: AppVariables }>();

// CORS must come before routes
app.use("/api/*", cors({
  origin: "http://localhost:5173",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["POST", "GET", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}));

// Mount Better Auth handler
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

export default app;
export type AppType = typeof app;
```

### Pattern 2: Session Middleware for Protected Routes

**What:** Middleware that extracts the authenticated user/session from the request cookie and attaches it to Hono's context.
**When to use:** All routes that need authentication.
**Confidence:** HIGH (from Better Auth Hono docs)

```typescript
// src/middleware/auth.ts
import { createMiddleware } from "hono/factory";
import { auth } from "../auth.js";

export const authMiddleware = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);
  await next();
});

export const requireAuth = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});
```

### Pattern 3: Drizzle Schema with Better Auth Tables

**What:** Define both Better Auth's required tables and application tables in Drizzle, with proper foreign key relationships.
**When to use:** Always -- both auth and application data live in the same PostgreSQL database.
**Confidence:** HIGH (verified from Better Auth database docs + Drizzle docs)

```typescript
// src/db/schema/auth.ts -- generated by: npx @better-auth/cli generate
// Better Auth creates: user, session, account, verification tables
// These are generated by the CLI and should not be manually edited.

// src/db/schema/campaign.ts -- application schema
import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const campaign = pgTable("campaign", {
  id: text("id").primaryKey(), // UUID or nanoid
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const campaignMember = pgTable("campaign_member", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["dm", "player"] }).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  invitedBy: text("invited_by").notNull().references(() => user.id),
  status: text("status", { enum: ["pending", "accepted", "declined"] }).notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});
```

### Pattern 4: Hono Route Organization with `app.route()`

**What:** Split routes into separate files using `app.route()` for organization while maintaining type inference.
**When to use:** When the app has more than a handful of routes.
**Confidence:** HIGH (from official Hono best practices)

```typescript
// src/routes/campaigns.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";

const campaigns = new Hono()
  .use("*", requireAuth)
  .post("/", zValidator("json", z.object({
    name: z.string().min(1).max(100),
  })), async (c) => {
    const user = c.get("user")!;
    const { name } = c.req.valid("json");
    // Create campaign with user as DM...
    return c.json({ campaign }, 201);
  })
  .get("/", async (c) => {
    const user = c.get("user")!;
    // List campaigns for user...
    return c.json({ campaigns });
  });

export default campaigns;

// src/app.ts
import campaigns from "./routes/campaigns.js";
app.route("/api/campaigns", campaigns);
```

### Pattern 5: Client-Side Auth Integration

**What:** Use Better Auth's React client (`createAuthClient` from `better-auth/react`) alongside existing Zustand stores.
**When to use:** All client-side auth interactions.
**Confidence:** HIGH (from Better Auth client docs)

```typescript
// packages/client/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "http://localhost:3000", // Server URL
});

// Usage in React components:
// const { data: session, isPending } = authClient.useSession();
// authClient.signUp.email({ name, email, password });
// authClient.signIn.email({ email, password });
// authClient.signOut();
```

### Anti-Patterns to Avoid

- **Hand-rolling JWT authentication:** Better Auth manages session tokens, cookies, CSRF protection, and password hashing. Do not implement custom JWT flows.
- **Storing sessions in memory:** Better Auth persists sessions to PostgreSQL via Drizzle. Server restarts do not lose sessions. Do not add an in-memory session store.
- **Skipping CORS configuration:** The Vite dev server (port 5173) and Hono server (port 3000) are different origins. CORS with `credentials: true` is mandatory. CORS middleware MUST be registered before auth routes.
- **Creating a "controllers" pattern in Hono:** Hono's official best practice is to write handlers inline after path definitions for correct type inference. Do not create Rails-style controller classes.
- **Querying the database on every request for session:** Better Auth supports cookie caching to avoid database hits on every request. Enable it for performance once the app has more traffic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | Custom bcrypt/argon2 setup | Better Auth (uses scrypt internally) | Scrypt is OWASP-recommended, natively supported in Node.js. Better Auth handles salt, iteration count, and timing-safe comparison. |
| Session management | Custom JWT + refresh token flow | Better Auth sessions | Session table, cookie management, expiry, CSRF protection all handled. Sessions persist in PostgreSQL. |
| Auth routes (signup, login, logout) | Custom route handlers | Better Auth handler mount (`/api/auth/*`) | All auth endpoints are generated automatically with proper validation, rate limiting, and error handling. |
| Database migrations | Raw SQL scripts | Drizzle Kit (`drizzle-kit generate` + `drizzle-kit migrate`) | Type-safe migration generation from schema diffs, rollback support, migration history. |
| Request validation | Manual `if/else` checks | `@hono/zod-validator` with Zod schemas | Type-safe validation with automatic error responses. Schemas can be shared with `@hex-crawl/shared`. |
| CORS handling | Custom headers | Hono `cors()` middleware | Handles preflight OPTIONS, credential cookies, allowed origins/headers/methods. |
| ID generation | Custom UUID function | `crypto.randomUUID()` (Node.js built-in) or Better Auth's built-in ID generation | Crypto-secure, standards-compliant UUID v4. Better Auth generates IDs for auth tables automatically. |

**Key insight:** The Better Auth + Drizzle + Hono combination handles 80% of this phase's complexity out of the box. The application-specific work is limited to campaign/invitation schema, campaign CRUD routes, and invitation flow logic.

## Common Pitfalls

### Pitfall 1: CORS Not Configured Before Routes
**What goes wrong:** Auth requests from the Vite dev server (localhost:5173) fail with CORS errors. Browser blocks cross-origin requests because the server doesn't send proper `Access-Control-Allow-Origin` headers.
**Why it happens:** Hono processes middleware in registration order. If CORS middleware is registered after the auth handler, preflight OPTIONS requests never get CORS headers.
**How to avoid:** Register CORS middleware BEFORE all route handlers. Use `app.use("/api/*", cors({...}))` before `app.on(["POST", "GET"], "/api/auth/*", ...)`.
**Warning signs:** Browser console shows "CORS policy" errors. Auth requests fail silently.

### Pitfall 2: Better Auth `trustedOrigins` Missing Client URL
**What goes wrong:** Better Auth rejects requests from the client because the origin is not trusted.
**Why it happens:** Better Auth has its own CSRF/origin checking beyond Hono's CORS middleware. If `trustedOrigins` doesn't include the Vite dev server URL, requests are blocked.
**How to avoid:** Set `trustedOrigins: ["http://localhost:5173"]` in the Better Auth configuration. In production, set to the actual client URL.
**Warning signs:** Auth requests return 403 or empty responses despite CORS being configured.

### Pitfall 3: Credentials Not Sent with Cross-Origin Requests
**What goes wrong:** Session cookies are not sent with API requests from the client, so the server thinks the user is not logged in.
**Why it happens:** Browser does not send cookies cross-origin by default. Both the server CORS config (`credentials: true`) and the client fetch config (`credentials: "include"`) must be set.
**How to avoid:** Set `credentials: true` in Hono CORS middleware. Better Auth's React client handles this automatically when `baseURL` is configured correctly.
**Warning signs:** Login succeeds but subsequent API calls return 401. Session cookie is set but not sent.

### Pitfall 4: Drizzle Schema Out of Sync with Database
**What goes wrong:** Application crashes with "relation does not exist" errors or column mismatches.
**Why it happens:** Schema changes in TypeScript files are not automatically applied to the database. Developer forgets to run `drizzle-kit generate` and `drizzle-kit migrate`.
**How to avoid:** Add migration scripts to package.json (`"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`, `"db:push": "drizzle-kit push"`). Use `drizzle-kit push` during rapid prototyping (applies schema directly without migration files).
**Warning signs:** TypeScript compiles but runtime queries fail.

### Pitfall 5: Better Auth Schema Not Generated
**What goes wrong:** Better Auth fails to start because its required tables (user, session, account, verification) don't exist.
**Why it happens:** Developer defines application schema but forgets to generate Better Auth's schema using `npx @better-auth/cli generate`.
**How to avoid:** Run `npx @better-auth/cli generate --output src/db/schema/auth.ts` first, then generate Drizzle migrations including the auth schema. Include this in setup documentation.
**Warning signs:** Server crashes on startup with "relation 'user' does not exist".

### Pitfall 6: PostgreSQL Not Running or Connection Refused
**What goes wrong:** Server fails to start because it cannot connect to PostgreSQL.
**Why it happens:** PostgreSQL is not installed or not running. The dev environment does not have Docker, so PostgreSQL must be installed via `apt`.
**How to avoid:** Document PostgreSQL setup in the server README: `sudo apt install postgresql-16`, then create a dev database and user. Use a `.env` file with `DATABASE_URL`.
**Warning signs:** "ECONNREFUSED" or "connection refused" errors on startup.

### Pitfall 7: Vite Proxy vs Direct Cross-Origin Requests
**What goes wrong:** Developer tries to configure Vite's proxy to avoid CORS, but this breaks cookie-based auth in production where no proxy exists.
**Why it happens:** Vite proxy rewrites the origin, making cookies work in dev but not in production (different domains).
**How to avoid:** Use direct cross-origin requests with proper CORS configuration from the start. Do not use Vite proxy for auth requests. This ensures dev and production behave identically.
**Warning signs:** Auth works in development but breaks in production.

### Pitfall 8: Role Check Not Enforced Server-Side
**What goes wrong:** A player can call DM-only API endpoints (like creating a campaign or inviting players) because the server doesn't check roles.
**Why it happens:** Developer only hides UI elements for non-DM users but doesn't validate roles on the server.
**How to avoid:** Every DM-only route must check `campaignMember.role === "dm"` on the server. Create a `requireDM` middleware that checks the user's role for the specific campaign.
**Warning signs:** A player can access DM-only actions by calling API endpoints directly.

## Code Examples

### Server Entry Point

```typescript
// Source: Hono Node.js getting started (https://hono.dev/docs/getting-started/nodejs)
// packages/server/src/index.ts
import { serve } from "@hono/node-server";
import app from "./app.js";

const port = Number(process.env.PORT) || 3000;

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0", // REQUIRED: remote development constraint
}, (info) => {
  console.log(`Server running at http://0.0.0.0:${info.port}`);
});
```

### Database Connection

```typescript
// Source: Drizzle ORM PostgreSQL docs (https://orm.drizzle.team/docs/get-started-postgresql)
// packages/server/src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle({ client: pool, schema });
```

### Drizzle Config

```typescript
// packages/server/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Campaign CRUD Route

```typescript
// packages/server/src/routes/campaigns.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaign, campaignMember } from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";

const createCampaignSchema = z.object({
  name: z.string().min(1).max(100),
});

const campaigns = new Hono()
  .use("*", requireAuth)
  .post("/", zValidator("json", createCampaignSchema), async (c) => {
    const user = c.get("user")!;
    const { name } = c.req.valid("json");
    const id = crypto.randomUUID();

    // Create campaign + add creator as DM in a transaction
    await db.transaction(async (tx) => {
      await tx.insert(campaign).values({
        id,
        name,
        ownerId: user.id,
      });
      await tx.insert(campaignMember).values({
        id: crypto.randomUUID(),
        campaignId: id,
        userId: user.id,
        role: "dm",
      });
    });

    return c.json({ id, name }, 201);
  })
  .get("/", async (c) => {
    const user = c.get("user")!;
    // Get all campaigns where user is a member
    const members = await db
      .select()
      .from(campaignMember)
      .innerJoin(campaign, eq(campaign.id, campaignMember.campaignId))
      .where(eq(campaignMember.userId, user.id));

    return c.json({
      campaigns: members.map((m) => ({
        ...m.campaign,
        role: m.campaign_member.role,
      })),
    });
  });

export default campaigns;
```

### Better Auth Client Setup (React)

```typescript
// Source: Better Auth React client docs (https://www.better-auth.com/docs/concepts/client)
// packages/client/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000",
});

// Export commonly used hooks
export const { useSession, signIn, signUp, signOut } = authClient;
```

### Login Page Component

```typescript
// packages/client/src/components/auth/LoginPage.tsx
import { useState } from "react";
import { authClient } from "../../lib/auth-client";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data, error } = await authClient.signIn.email({
      email,
      password,
    });
    if (error) {
      setError(error.message);
    }
    // Better Auth automatically sets session cookie
    // useSession() will reactively update
  };

  return (
    <form onSubmit={handleLogin}>
      {/* form fields */}
    </form>
  );
}
```

### Auth-Guarded Route Layout

```typescript
// packages/client/src/components/auth/AuthGuard.tsx
import { authClient } from "../../lib/auth-client";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <div>Loading...</div>;
  if (!session) return <LoginPage />;

  return <>{children}</>;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Auth.js / NextAuth for auth | Better Auth | Sept 2025 (Auth.js team joined Better Auth) | Auth.js is maintenance-mode only. Better Auth is the active successor. |
| Lucia Auth | Better Auth | March 2025 (Lucia deprecated) | Lucia author recommends it only as educational resource. |
| Express for Node.js HTTP | Hono | 2024-2025 adoption wave | Hono is 3.5x faster, TypeScript-first, multi-runtime, 14KB vs 500KB. |
| Prisma for ORM | Drizzle ORM | 2024-2025 | Drizzle is SQL-transparent, no binary engine, lighter weight. Prisma still works but Drizzle preferred for new TypeScript projects. |
| `serial` / `SERIAL` columns in PostgreSQL | `integer().generatedAlwaysAsIdentity()` | PostgreSQL standard | PostgreSQL documentation recommends identity columns over serial. |
| `ts-node` for TypeScript execution | `tsx` or native Node.js type stripping | 2024-2025 | tsx uses esbuild for 5-10x faster startup. Node.js 22+ has experimental native support. |

**Deprecated/outdated:**
- Auth.js / NextAuth: Maintenance mode only (security patches). Do not use for new projects.
- Lucia Auth: Deprecated March 2025. Educational resource only.
- Express: Not deprecated but superseded by Hono for new TypeScript projects.

## Environment Setup

### PostgreSQL Installation (No Docker Available)

This development environment does **not** have Docker installed. PostgreSQL 16 is available via `apt`:

```bash
sudo apt install postgresql-16
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create development database and user
sudo -u postgres createuser --interactive hexcrawl_dev
sudo -u postgres createdb hexcrawl_dev --owner=hexcrawl_dev
sudo -u postgres psql -c "ALTER USER hexcrawl_dev WITH PASSWORD 'dev_password';"
```

**DATABASE_URL:** `postgresql://hexcrawl_dev:dev_password@localhost:5432/hexcrawl_dev`

### Environment Variables (.env in packages/server/)

```env
DATABASE_URL=postgresql://hexcrawl_dev:dev_password@localhost:5432/hexcrawl_dev
BETTER_AUTH_SECRET=<generate with: openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
PORT=3000
```

### Server package.json Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

### Dev Server Binding

**Critical constraint:** All dev servers must bind to `0.0.0.0` (remote development environment).
- Hono server: `serve({ fetch: app.fetch, port, hostname: "0.0.0.0" })`
- Vite dev server: already configured with `server: { host: "0.0.0.0" }` in `vite.config.ts`

## Database Schema Design

### Better Auth Tables (Generated)

Better Auth creates these tables via `npx @better-auth/cli generate`:

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `user` | id, name, email, emailVerified, image, createdAt, updatedAt | User identity. ID is text (not serial). |
| `session` | id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt | Session tracking. Token used as cookie value. |
| `account` | id, userId, accountId, providerId, password, accessToken, refreshToken, ... | Provider credentials. For email/password: `providerId = "credential"`, password stored here (not in user table). |
| `verification` | id, identifier, value, expiresAt, createdAt, updatedAt | Email verification and password reset tokens. |

### Application Tables (Custom)

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `campaign` | id, name, ownerId (FK->user), createdAt, updatedAt | A campaign created by a DM. `ownerId` is the DM user. |
| `campaign_member` | id, campaignId (FK->campaign), userId (FK->user), role ("dm"/"player"), joinedAt | Links users to campaigns with roles. DM is added on campaign creation. |
| `invitation` | id, campaignId (FK->campaign), email, invitedBy (FK->user), status ("pending"/"accepted"/"declined"), createdAt, expiresAt | Email-based invitation. Resolved when invited user signs up/logs in and accepts. |

### Schema Relationships

```
user (1) ──< campaign (many)           [ownerId]
user (1) ──< campaign_member (many)    [userId]
campaign (1) ──< campaign_member (many) [campaignId]
campaign (1) ──< invitation (many)     [campaignId]
user (1) ──< invitation (many)         [invitedBy]
```

## Campaign Invite Flow

The invitation flow for AUTH-04 and AUTH-05:

1. **DM invites by email:** `POST /api/campaigns/:id/invitations` with `{ email }`. Creates an `invitation` row with `status: "pending"`.
2. **Check on login/signup:** When a user logs in or signs up, check if any pending invitations match their email. Show pending invitations in the UI.
3. **Accept invitation:** `POST /api/invitations/:id/accept`. Creates a `campaign_member` row with `role: "player"` and updates invitation `status: "accepted"`.
4. **Decline invitation:** `POST /api/invitations/:id/decline`. Updates invitation `status: "declined"`.

This approach avoids needing email sending infrastructure for v1. The invitation is resolved when the user next logs in. Email notification can be added later.

## Role Enforcement Strategy

For success criterion 5 ("DM and player roles are enforced"):

- **Server-side enforcement is mandatory.** Client-side UI hiding is insufficient.
- Every campaign-scoped API route must:
  1. Verify the user is authenticated (session exists)
  2. Verify the user is a member of the campaign
  3. For DM-only actions: verify `campaign_member.role === "dm"`
- Create a `requireCampaignRole(role)` middleware that checks the user's role for the specific campaign in the request path.

## Open Questions

1. **Map data persistence (AUTH-06)**
   - What we know: AUTH-06 requires "campaign state (fog, hexes, tokens, content) persists between sessions." Phase 2 only needs to persist campaign and user data. Full map/fog/token persistence depends on later phases.
   - What's unclear: Should Phase 2 create the hex map tables now (empty, for future use) or defer them entirely to Phase 3+?
   - Recommendation: Create only the tables needed for Phase 2 (campaign, campaign_member, invitation). Hex/fog/token tables belong to later phases. AUTH-06 for Phase 2 means "campaign metadata persists" -- the map data tables will be added in their respective phases.

2. **Vite client proxy vs direct CORS requests**
   - What we know: Both approaches work. Vite proxy avoids CORS in dev but masks production behavior. Direct CORS matches production.
   - What's unclear: Whether Better Auth's cookie handling works correctly through a Vite proxy.
   - Recommendation: Use direct cross-origin requests with CORS. This is the pattern documented in Better Auth's official Hono integration guide and ensures dev matches production.

3. **Node.js native TypeScript support vs tsx**
   - What we know: Node.js 24 (current environment) supports `--experimental-strip-types` for native TS execution.
   - What's unclear: Whether native strip-types handles all TypeScript features used by Hono/Drizzle (decorators, path aliases, etc.).
   - Recommendation: Use `tsx` for reliability. It is battle-tested with the exact stack we use. Can migrate to native later.

## Sources

### Primary (HIGH confidence)
- [Better Auth Installation](https://www.better-auth.com/docs/installation) - Full setup guide including Drizzle adapter
- [Better Auth Hono Integration](https://www.better-auth.com/docs/integrations/hono) - Handler mounting, CORS, session middleware
- [Better Auth Email & Password](https://www.better-auth.com/docs/authentication/email-password) - Configuration, sign up/in flows, password options
- [Better Auth Session Management](https://www.better-auth.com/docs/concepts/session-management) - Session expiry, cookies, revocation
- [Better Auth Database](https://www.better-auth.com/docs/concepts/database) - Schema, tables, customization, hooks
- [Better Auth Drizzle Adapter](https://www.better-auth.com/docs/adapters/drizzle) - Adapter config, schema generation, CLI
- [Drizzle ORM PostgreSQL Getting Started](https://orm.drizzle.team/docs/get-started-postgresql) - Driver setup, connection, schema
- [Hono Node.js Getting Started](https://hono.dev/docs/getting-started/nodejs) - @hono/node-server setup, serve configuration
- [Hono Best Practices](https://hono.dev/docs/guides/best-practices) - Route organization, inline handlers, app.route()
- [Hono Validation Guide](https://hono.dev/docs/guides/validation) - @hono/zod-validator usage
- [tsx Documentation](https://tsx.is/) - Watch mode, TypeScript execution

### Secondary (MEDIUM confidence)
- [Hono + Better Auth example](https://hono.dev/examples/better-auth) - Official Hono example combining the two
- [Drizzle ORM Relations](https://orm.drizzle.team/docs/relations-schema-declaration) - One-to-many, foreign keys, relation declarations
- [Better Auth Client Docs](https://www.better-auth.com/docs/concepts/client) - React hooks, useSession, createAuthClient

### Tertiary (LOW confidence)
- [bhvr monorepo template](https://github.com/stevedylandev/bhvr) - Bun+Hono+Vite+React monorepo structure (community project)
- [hono-better-auth GitHub](https://github.com/LovelessCodes/hono-better-auth) - Community integration example

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries are prior decisions verified in Stack research. Versions confirmed via npm.
- Architecture: HIGH - Patterns verified from official documentation (Better Auth Hono integration, Drizzle ORM docs, Hono best practices).
- Pitfalls: HIGH - Identified from official docs (CORS ordering, trustedOrigins) and common patterns (credential cookies, schema sync).

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (stable libraries, 30-day validity)
