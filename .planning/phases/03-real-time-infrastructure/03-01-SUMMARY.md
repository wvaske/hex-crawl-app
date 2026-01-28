---
phase: 03-real-time-infrastructure
plan: 01
subsystem: infra
tags: [websocket, hono, node-ws, drizzle, zod, real-time, session]

# Dependency graph
requires:
  - phase: 02-server-authentication
    provides: "Hono server with Better Auth, campaign/member schema, CORS config"
provides:
  - "WebSocket endpoint at /ws with cookie-based auth and campaign membership verification"
  - "game_session and session_event database tables with enums and indexes"
  - "Zod-validated ServerMessage and ClientMessage schemas in shared package"
  - "Session type definitions (SessionStatus, ConnectionStatus, BroadcastMode)"
  - "Vite dev proxy forwarding /ws with ws:true"
affects: [03-02, 03-03, 03-04, 04-fog-of-war, 05-player-experience]

# Tech tracking
tech-stack:
  added: ["@hono/node-ws ^1.3.0", "@types/ws ^8.18.1"]
  patterns:
    - "createNodeWebSocket setup with injectWebSocket post-serve"
    - "Cookie auth inside upgradeWebSocket callback (not middleware)"
    - "Origin validation for CSWSH protection"
    - "Zod discriminatedUnion for WS message type-safe validation"

key-files:
  created:
    - "packages/server/src/ws/setup.ts"
    - "packages/server/src/ws/handler.ts"
    - "packages/server/src/db/schema/session.ts"
    - "packages/shared/src/ws-messages.ts"
    - "packages/shared/src/session-types.ts"
  modified:
    - "packages/server/src/index.ts"
    - "packages/server/src/db/schema/index.ts"
    - "packages/server/drizzle.config.ts"
    - "packages/server/package.json"
    - "packages/shared/src/index.ts"
    - "packages/client/vite.config.ts"

key-decisions:
  - "Hono<any> type parameter for setupWebSocket/createWsRoute to accommodate AppVariables generic"
  - "Origin validation allows connections without Origin header (browser WS always sends it, server-to-server may not)"
  - "Campaign membership verified during WS upgrade handshake, not on each message"

patterns-established:
  - "WS route registration in index.ts between setupWebSocket() and serve() calls"
  - "Cookie auth via auth.api.getSession({ headers }) inside upgradeWebSocket callback"
  - "Close codes: 4001=Unauthorized, 4002=Missing campaignId, 4003=Forbidden origin or Not a member"
  - "Session event types cover full lifecycle plus hex/player/token events"

# Metrics
duration: 7min
completed: 2026-01-28
---

# Phase 3 Plan 1: WebSocket Infrastructure Summary

**WebSocket endpoint at /ws with cookie auth, session/event DB tables, and Zod-validated message schemas shared across client and server**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-28T01:02:03Z
- **Completed:** 2026-01-28T01:09:16Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- WebSocket endpoint at /ws authenticates via cookies, validates origin, checks campaign membership, and rejects unauthorized connections with specific close codes
- game_session and session_event tables created with proper FK constraints, pgEnum types, and indexes on sessionId and createdAt
- Zod discriminatedUnion schemas define 11 server-to-client and 9 client-to-server message types with full type inference
- Vite dev proxy configured to forward /ws path to backend with WebSocket protocol support

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @hono/node-ws, create WS setup and handler, wire into server entry point** - `cb4ea25` (feat)
2. **Task 2: Create session/event database schema and shared message type definitions** - `d01ae15` (feat)

## Files Created/Modified
- `packages/server/src/ws/setup.ts` - createNodeWebSocket initialization, exports upgradeWebSocket and injectWebSocket
- `packages/server/src/ws/handler.ts` - WebSocket upgrade route with origin validation, cookie auth, campaign membership check
- `packages/server/src/db/schema/session.ts` - gameSession and sessionEvent Drizzle tables with enums
- `packages/shared/src/ws-messages.ts` - Zod schemas for ServerMessage (11 types) and ClientMessage (9 types)
- `packages/shared/src/session-types.ts` - SessionStatus, ConnectionStatus, BroadcastMode, PlayerPresence, StagedChange types
- `packages/server/src/index.ts` - Wired in setupWebSocket, createWsRoute, injectWebSocket
- `packages/server/src/db/schema/index.ts` - Added session barrel export
- `packages/server/drizzle.config.ts` - Added session.ts to schema array
- `packages/server/package.json` - Added @hono/node-ws dependency
- `packages/shared/src/index.ts` - Re-exports for ws-messages and session-types
- `packages/client/vite.config.ts` - Added /ws proxy with ws:true

## Decisions Made
- Used `Hono<any>` type parameter in setup.ts and handler.ts to accommodate the AppVariables generic from app.ts without coupling WS files to the specific Hono env type
- Origin validation allows connections without an Origin header (browser WebSocket always sends it; CLI/server-to-server may not) -- only rejects if Origin is present AND not allowed
- Campaign membership is verified once during the WS upgrade handshake rather than on each message, trading off dynamic membership changes for performance
- Installed @types/ws as devDependency since ws is a transitive dependency of @hono/node-ws but pnpm strict mode doesn't expose it directly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed @types/ws for WebSocket type declarations**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `import type { WebSocket } from "ws"` in handler.ts failed because @types/ws was not installed; ws is a transitive dep of @hono/node-ws but not directly available in pnpm strict mode
- **Fix:** Added `@types/ws` as devDependency
- **Files modified:** packages/server/package.json, pnpm-lock.yaml
- **Verification:** TypeScript compilation passes
- **Committed in:** cb4ea25 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed Hono generic type mismatch**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `setupWebSocket(app)` and `createWsRoute(app, ...)` used `Hono` default generic which didn't match `Hono<{ Variables: AppVariables }>` from app.ts
- **Fix:** Changed parameter types to `Hono<any>` matching createNodeWebSocket's own type expectation
- **Files modified:** packages/server/src/ws/setup.ts, packages/server/src/ws/handler.ts
- **Verification:** TypeScript compilation passes without errors
- **Committed in:** cb4ea25 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes were necessary for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WebSocket infrastructure is ready for session manager implementation (Plan 03-02)
- Message schemas define the full protocol for session lifecycle, hex reveals, and player presence
- Session tables are ready for event logging in Plan 03-03
- Handler onOpen/onMessage/onClose are placeholder stubs ready to integrate with session manager

---
*Phase: 03-real-time-infrastructure*
*Completed: 2026-01-28*
