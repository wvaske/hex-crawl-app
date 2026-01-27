---
phase: 02-server-authentication
plan: 02
subsystem: database, api
tags: [drizzle-orm, postgresql, hono, campaign, schema, crud, zod, middleware]

# Dependency graph
requires:
  - phase: 02-server-authentication
    plan: 01
    provides: Hono server, Better Auth, Drizzle ORM, PostgreSQL connection, auth schema
provides:
  - Campaign, campaign_member, invitation PostgreSQL tables with FK relationships
  - requireAuth middleware extracting Better Auth session
  - POST /api/campaigns (create campaign + DM member atomically)
  - GET /api/campaigns (list user campaigns with roles)
  - GET /api/campaigns/:id (single campaign for members)
affects: [02-03-client-auth, 02-04-invitations, 03-real-time, 04-fog-of-war]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requireAuth middleware via createMiddleware + auth.api.getSession"
    - "Campaign routes with Hono<{ Variables: AppVariables }> for type-safe c.get('user')"
    - "db.transaction() for atomic multi-table inserts"
    - "innerJoin query for membership-filtered campaign listing"
    - "Extensionless imports in schema files for drizzle-kit CJS compatibility"

key-files:
  created:
    - packages/server/src/db/schema/campaign.ts
    - packages/server/src/db/schema/invitation.ts
    - packages/server/src/middleware/auth.ts
    - packages/server/src/routes/campaigns.ts
  modified:
    - packages/server/src/db/schema/index.ts
    - packages/server/src/app.ts
    - packages/server/drizzle.config.ts

key-decisions:
  - "Extensionless imports in schema files (./auth not ./auth.js) for drizzle-kit CJS resolver compatibility"
  - "AppVariables type exported from app.ts for route-level type safety"
  - "Campaign creation + DM member insert wrapped in db.transaction() for atomicity"

patterns-established:
  - "Schema files use extensionless imports for drizzle-kit CJS compatibility"
  - "Route files import AppVariables type and parameterize Hono<{ Variables: AppVariables }>"
  - "All campaign routes gated by requireAuth middleware via .use('*', requireAuth)"
  - "drizzle.config.ts schema array must include each new schema file individually"

# Metrics
duration: 5min
completed: 2026-01-27
---

# Phase 2 Plan 02: Campaign Schema & Routes Summary

**Campaign/invitation Drizzle schema pushed to PostgreSQL, requireAuth middleware, and campaign CRUD routes (POST/GET) with DM auto-assignment**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-27T15:52:35Z
- **Completed:** 2026-01-27T15:57:25Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- 3 new PostgreSQL tables (campaign, campaign_member, invitation) with proper FK constraints -- 7 total tables
- requireAuth middleware rejects unauthenticated requests with 401
- POST /api/campaigns creates campaign and auto-adds creator as DM member in atomic transaction
- GET /api/campaigns lists user's campaigns with role (dm/player)
- GET /api/campaigns/:id returns single campaign for members, 404 for non-members

## Task Commits

Each task was committed atomically:

1. **Task 1: Create application schema and push to database** - `192bf7c` (feat)
2. **Task 2: Create auth middleware and campaign CRUD routes** - `9975a70` (feat, bundled with 02-03 parallel execution)

## Files Created/Modified
- `packages/server/src/db/schema/campaign.ts` - Campaign and campaign_member table definitions with FK to user
- `packages/server/src/db/schema/invitation.ts` - Invitation table with pending/accepted/declined status enum
- `packages/server/src/db/schema/index.ts` - Barrel export updated with campaign and invitation modules
- `packages/server/drizzle.config.ts` - Schema array expanded with campaign.ts and invitation.ts
- `packages/server/src/middleware/auth.ts` - authMiddleware (optional) and requireAuth (mandatory) via Better Auth session
- `packages/server/src/routes/campaigns.ts` - Campaign CRUD with Zod validation, transactions, membership queries
- `packages/server/src/app.ts` - Exported AppVariables type, mounted campaign routes at /api/campaigns

## Decisions Made
- **Extensionless schema imports:** Schema files (`campaign.ts`, `invitation.ts`) use `./auth` instead of `./auth.js` because drizzle-kit uses CJS resolver (jiti) which cannot resolve `.js` extensions for `.ts` files. The `moduleResolution: "bundler"` in tsconfig supports extensionless imports at runtime via tsx.
- **Exported AppVariables type:** Changed from private `type` to `export type` so route files can parameterize their Hono instance for type-safe `c.get("user")` access.
- **Transaction for campaign creation:** Wrapped campaign insert + campaign_member insert in `db.transaction()` to ensure atomicity -- if either fails, both roll back.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Changed .js to extensionless imports in schema files**
- **Found during:** Task 1 (drizzle-kit push)
- **Issue:** `drizzle-kit push` failed with `Cannot find module './auth.js'` because drizzle-kit CJS resolver cannot resolve `.js` extensions for `.ts` files
- **Fix:** Changed `import { user } from "./auth.js"` to `import { user } from "./auth"` in campaign.ts and invitation.ts. Also updated barrel index.ts for consistency.
- **Files modified:** `packages/server/src/db/schema/campaign.ts`, `packages/server/src/db/schema/invitation.ts`, `packages/server/src/db/schema/index.ts`
- **Verification:** `drizzle-kit push` succeeds, runtime imports work with `moduleResolution: "bundler"`
- **Committed in:** `192bf7c` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary workaround for CJS/ESM interop, consistent with 02-01 decision. No scope creep.

## Issues Encountered
- Task 2 files (middleware/auth.ts, routes/campaigns.ts, app.ts changes) were committed as part of a parallel 02-03 execution (`9975a70`). The code is identical to what was planned and verified. All Task 2 done criteria are met.

## User Setup Required
None - schema pushed automatically via drizzle-kit push.

## Next Phase Readiness
- Campaign schema and routes ready for client integration (02-03)
- Invitation schema ready for invitation routes (02-04)
- requireAuth middleware pattern established for all future protected routes
- All 7 tables active in PostgreSQL with correct FK relationships

---
*Phase: 02-server-authentication*
*Completed: 2026-01-27*
