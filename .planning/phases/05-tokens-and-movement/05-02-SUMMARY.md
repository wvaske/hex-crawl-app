---
phase: 05-tokens-and-movement
plan: 02
subsystem: server-api
tags: [websocket, tokens, drizzle, hono, rest]
depends_on: [05-01]
provides: [server-token-handlers, token-map-endpoint]
affects: [05-03, 05-04]
tech-stack:
  patterns: [ws-message-handler, role-based-filtering, cube-distance]
key-files:
  modified:
    - packages/server/src/ws/message-handlers.ts
    - packages/server/src/routes/map.ts
metrics:
  completed: 2026-01-31
  duration: ~3min
---

# Phase 05 Plan 02: Server Token Handlers Summary

Server-side token CRUD via WS handlers with role-based permissions, adjacency validation using inline cube-distance, and token data in GET map endpoint.

## What Was Done

### Task 1: Token Message Handlers
Added 4 WS message handlers to message-handlers.ts:

- **token:move** - Loads token from DB, checks player ownership, validates adjacency (cube distance = 1) for non-DM, updates DB, broadcasts token:moved
- **token:create** (DM only) - Inserts new campaignToken row, broadcasts token:created with full token object
- **token:update** - Players can only update own token's icon; DM can update icon, color, visible, label. Broadcasts token:updated
- **token:delete** (DM only) - Deletes from DB, broadcasts token:deleted

Inline hex distance function converts offset coords to cube coords and computes `max(|dq|, |dr|, |ds|)`.

### Task 2: Token Data in Map Endpoint
Added token query to GET `/api/campaigns/:id/map`:
- DM sees all tokens
- Players see only tokens where `visible = true`
- Token objects mapped to shared Token shape (id, hexKey, ownerId, label, icon, color, tokenType, visible)

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Inline cube distance calculation | Server cannot import from client package; 5-line function avoids cross-package dependency |
| Players restricted to icon-only updates | Prevents players from making tokens invisible or changing labels/colors |
| Token filtering at REST level | Simpler than WS-based token:state; client already fetches map data on connect |

## Deviations from Plan

None - plan executed exactly as written. Token handlers were pre-staged in working tree from plan authoring.

## Commits

| Hash | Message |
|------|---------|
| 24461e8 | feat(05-02): add token message handlers to WS message-handlers.ts |
| 2284e69 | feat(05-02): add token data to GET /api/campaigns/:id/map endpoint |

## Next Phase Readiness

- Server token handlers complete; client token store (05-03) can consume token:moved/created/updated/deleted events
- Map endpoint returns tokens for initial state hydration
- No blockers for 05-03 or 05-04
