---
phase: 02-server-authentication
plan: 01
subsystem: auth
tags: [hono, better-auth, drizzle-orm, postgresql, pg, cors, session]

# Dependency graph
requires:
  - phase: 01-hex-grid-foundation
    provides: pnpm monorepo with client package, shared types
provides:
  - Hono HTTP server on port 3000 with CORS and health check
  - Better Auth email/password signup and login at /api/auth/*
  - Drizzle ORM connection to PostgreSQL via pg Pool
  - Auth schema (user, session, account, verification tables)
  - Server package scaffold with tsx watch, drizzle-kit scripts
affects: [02-02-campaign-schema, 02-03-client-auth, 02-04-invitations, 03-real-time]

# Tech tracking
tech-stack:
  added: [hono, "@hono/node-server", better-auth, drizzle-orm, pg, drizzle-kit, "@hono/zod-validator", dotenv, tsx, zod]
  patterns: [Better Auth handler mount on Hono, Drizzle pg Pool connection, CORS before routes, dotenv/config import-first]

key-files:
  created:
    - packages/server/src/index.ts
    - packages/server/src/app.ts
    - packages/server/src/auth.ts
    - packages/server/src/db/index.ts
    - packages/server/src/db/schema/auth.ts
    - packages/server/src/db/schema/index.ts
    - packages/server/drizzle.config.ts
    - packages/server/tsconfig.json
    - packages/server/.env
  modified:
    - packages/server/package.json
    - package.json
    - .gitignore
    - pnpm-lock.yaml

key-decisions:
  - "Manual Better Auth schema instead of CLI-generated (CLI chokes on ESM .js imports in barrel files)"
  - "drizzle.config.ts uses explicit schema file array instead of barrel index.ts (drizzle-kit CJS resolver incompatible with .js extension imports)"
  - "Direct cross-origin CORS instead of Vite proxy (matches production behavior)"

patterns-established:
  - "Better Auth mount: app.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))"
  - "CORS middleware registered before all routes on /api/*"
  - "dotenv/config imported as first line in entry point and db/index.ts"
  - "Server binds to 0.0.0.0 for remote development access"

# Metrics
duration: 5min
completed: 2026-01-27
---

# Phase 2 Plan 01: Server Foundation Summary

**Hono server with Better Auth email/password auth, Drizzle ORM PostgreSQL connection, and user/session/account/verification schema**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-27T15:42:18Z
- **Completed:** 2026-01-27T15:47:31Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- PostgreSQL 16 running with hexcrawl_dev database and user
- Hono server starts on port 3000 bound to 0.0.0.0 with health check at /api/health
- Better Auth handles email/password signup and login at /api/auth/* endpoints
- User signup creates user row in PostgreSQL, session persists via cookie
- CORS configured for localhost:5173 with credentials support

## Task Commits

Each task was committed atomically:

1. **Task 1: Set up PostgreSQL, install dependencies, scaffold server package** - `c70181b` (chore)
2. **Task 2: Create Hono server with Better Auth, Drizzle connection, and auth schema** - `8f25a8c` (feat)

## Files Created/Modified
- `packages/server/src/index.ts` - Server entry point with @hono/node-server, binds 0.0.0.0:3000
- `packages/server/src/app.ts` - Hono app with CORS middleware and Better Auth handler mount
- `packages/server/src/auth.ts` - Better Auth instance with Drizzle adapter, email/password config
- `packages/server/src/db/index.ts` - Drizzle ORM connection via pg Pool using DATABASE_URL
- `packages/server/src/db/schema/auth.ts` - Better Auth tables (user, session, account, verification)
- `packages/server/src/db/schema/index.ts` - Schema barrel export
- `packages/server/drizzle.config.ts` - Drizzle Kit config pointing at schema files
- `packages/server/tsconfig.json` - TypeScript config (ES2022, ESNext modules, bundler resolution)
- `packages/server/.env` - Environment variables (DATABASE_URL, BETTER_AUTH_SECRET, PORT)
- `packages/server/package.json` - Full server package with all dependencies and scripts
- `package.json` - Added dev:server script to root
- `.gitignore` - Added .env to prevent secret leakage

## Decisions Made
- **Manual Better Auth schema:** The `@better-auth/cli generate` command failed because it uses jiti (CJS) internally and cannot resolve `.js` extension imports in TypeScript barrel files. Created the schema manually from Better Auth documentation instead. The schema is functionally identical.
- **Explicit schema file array in drizzle.config.ts:** drizzle-kit also uses CJS resolution and has the same `.js` extension issue with barrel files. Used an explicit array of schema file paths instead of pointing at the barrel `index.ts`.
- **Direct CORS over Vite proxy:** Configured CORS for cross-origin requests from localhost:5173 rather than using Vite's proxy feature. This matches production behavior and is the approach documented in Better Auth's Hono integration guide.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] drizzle-kit and @better-auth/cli CJS resolution incompatible with ESM barrel exports**
- **Found during:** Task 2 (schema generation and push)
- **Issue:** Both drizzle-kit and @better-auth/cli use jiti/CJS internally to load TypeScript config files. The barrel file `schema/index.ts` exports from `./auth.js` (ESM convention), but CJS resolution cannot find `auth.js` when only `auth.ts` exists.
- **Fix:** Created Better Auth schema manually instead of via CLI. Changed drizzle.config.ts to use explicit schema file array instead of barrel index.ts. The barrel file still works at runtime with tsx/ESM.
- **Files modified:** `packages/server/src/db/schema/auth.ts`, `packages/server/drizzle.config.ts`
- **Verification:** `drizzle-kit push` succeeds, all 4 tables created in PostgreSQL
- **Committed in:** `8f25a8c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary workaround for CJS/ESM interop. No scope creep. All functionality delivered as planned.

## Issues Encountered
- The Zod v4 peer dependency warning from `@hono/zod-validator` (expects Zod v3) is cosmetic -- the validator works correctly at runtime with Zod v4's backwards compatibility.

## User Setup Required
None - PostgreSQL is installed and configured automatically. The .env file is generated with a random BETTER_AUTH_SECRET.

## Next Phase Readiness
- Server foundation complete with auth endpoints ready
- Plan 02 can add campaign/member/invitation schema and CRUD routes
- Plan 03 can integrate Better Auth client in the React app
- Session middleware pattern documented in research for protected routes

---
*Phase: 02-server-authentication*
*Completed: 2026-01-27*
