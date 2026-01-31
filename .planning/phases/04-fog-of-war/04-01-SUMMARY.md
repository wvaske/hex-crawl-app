---
phase: 04-fog-of-war
plan: 01
subsystem: database-schema
tags: [drizzle, postgresql, fog-of-war, websocket, rest-api]
dependency_graph:
  requires: [01-hex-grid-foundation, 02-server-authentication, 03-real-time-infrastructure]
  provides: [hex_visibility-table, campaign_hex-table, map-rest-endpoints, fog-ws-messages]
  affects: [04-02, 04-03, 04-04]
tech_stack:
  added: []
  patterns: [sentinel-value-for-null-uniqueness]
key_files:
  created:
    - packages/server/src/db/schema/fog.ts
    - packages/server/src/db/schema/hex-data.ts
    - packages/server/src/routes/map.ts
  modified:
    - packages/server/src/db/schema/index.ts
    - packages/server/src/db/schema/session.ts
    - packages/server/drizzle.config.ts
    - packages/shared/src/ws-messages.ts
    - packages/shared/src/hex-types.ts
    - packages/shared/src/index.ts
    - packages/server/src/app.ts
    - packages/server/tsconfig.json
    - packages/server/src/ws/handler.ts
decisions:
  - id: "04-01-sentinel"
    description: "Use '__all__' sentinel string instead of NULL for hex_visibility.user_id 'all players' case, avoiding PostgreSQL NULL uniqueness issues"
metrics:
  duration: "3min"
  completed: "2026-01-31"
---

# Phase 4 Plan 1: DB Foundation and Message Contracts Summary

**One-liner:** hex_visibility + campaign_hex Drizzle schemas with map REST CRUD and fog WS message contracts

## Tasks Completed

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Create DB schemas and run migration | 130baf3 | fog.ts, hex-data.ts, schema index, session enum, drizzle config |
| 2 | Extend WS messages and shared types, add map REST endpoints | 7df0a0a | ws-messages.ts, hex-types.ts, map.ts routes, app.ts mount |

## What Was Built

### Database Tables
- **hex_visibility**: Tracks per-hex, per-user (or __all__) reveal state with campaign_id, hex_key, user_id, revealed_by, revealed_at. Unique constraint on (campaign_id, hex_key, user_id). Uses NOT NULL user_id with "__all__" sentinel.
- **campaign_hex**: Stores server-side map terrain data (campaign_id, hex_key, terrain, terrain_variant). Unique on (campaign_id, hex_key).

### WS Message Contracts
- **hex:hide** (client): DM sends hex keys + targets to hide hexes
- **hex:hidden** (server): Notifies clients of hidden hexes
- **adjacentHexes** optional field added to session:state and hex:revealed messages
- **FogTier** type: "revealed" | "adjacent" | "hidden"

### REST Endpoints
- **POST /api/campaigns/:id/map**: DM-only, upserts hex terrain data (delete+insert in transaction)
- **GET /api/campaigns/:id/map**: Campaign member, returns all hex data

## Decisions Made

1. **Sentinel value over NULL** (04-01-sentinel): Used "__all__" string instead of nullable user_id for the "all players" visibility case. PostgreSQL treats NULL as distinct in unique constraints, which would allow duplicate "all" reveals.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing WSContext type error in handler.ts**
- **Found during:** Task 2 (tsc verification)
- **Issue:** `typeof ws` referenced `ws` parameter before its scope (line 100 references onOpen's ws param)
- **Fix:** Changed to explicit `WSContext` type import, removed unused `WebSocket` import
- **Files modified:** packages/server/src/ws/handler.ts

**2. [Rule 3 - Blocking] Removed drizzle.config.ts from tsconfig include**
- **Found during:** Task 2 (tsc verification)
- **Issue:** drizzle.config.ts outside rootDir caused TS6059 error, blocking compilation check
- **Fix:** Removed from tsconfig.json include array
- **Files modified:** packages/server/tsconfig.json

**3. [Rule 3 - Blocking] Used drizzle-kit push instead of migrate**
- **Found during:** Task 1 (migration)
- **Issue:** No previous migration history in drizzle/ folder (prior phases used push). Generated migration tried to CREATE existing types/tables.
- **Fix:** Used `drizzle-kit push` for schema sync

## Next Phase Readiness

Plan 04-02 can proceed immediately. All schema, message types, and endpoints are in place.
