---
phase: 05-tokens-and-movement
plan: 01
subsystem: data-model
tags: [drizzle, postgresql, zod, websocket, tokens]
completed: 2026-01-31
duration: 1min
dependency-graph:
  requires: [02-01, 02-02]
  provides: [campaign_token table, Token type, token WS messages]
  affects: [05-02, 05-03, 05-04]
tech-stack:
  added: []
  patterns: [token CRUD via WS messages]
key-files:
  created:
    - packages/server/src/db/schema/token.ts
  modified:
    - packages/server/src/db/schema/index.ts
    - packages/server/drizzle.config.ts
    - packages/shared/src/hex-types.ts
    - packages/shared/src/ws-messages.ts
    - packages/shared/src/index.ts
decisions: []
---

# Phase 5 Plan 1: Token Schema Summary

**One-liner:** campaign_token Drizzle table with cascade FK, Token interface, and 9 Zod-validated WS message schemas for CRUD+move+state

## Tasks Completed

| # | Task | Commit | Key Output |
|---|------|--------|------------|
| 1 | Create campaign_token DB schema | 5e23a07 | token.ts, drizzle push |
| 2 | Add Token types and WS messages | 161a0ce | Token interface, 9 WS schemas |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- `drizzle-kit push` succeeded - campaign_token table created in PostgreSQL
- `npx tsc --noEmit` passes for shared package
- Server package has pre-existing TS error (Hono WS type mismatch) unrelated to this plan

## Next Phase Readiness

All data foundations in place. Plans 05-02 through 05-04 can proceed with token CRUD handlers, movement logic, and UI.
