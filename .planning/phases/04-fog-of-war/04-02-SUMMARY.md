---
phase: 04-fog-of-war
plan: 02
subsystem: websocket-fog-logic
tags: [fog-of-war, websocket, adjacency, persistence, security]
dependency_graph:
  requires: [04-01]
  provides: [fog-utils, fog-filtered-session-state, hex-hide-handler, hex-reveal-persistence]
  affects: [04-03, 04-04]
tech_stack:
  added: []
  patterns: [fire-and-forget-async-in-sync-callback, db-cache-on-first-connect]
key_files:
  created:
    - packages/server/src/ws/fog-utils.ts
  modified:
    - packages/server/src/ws/session-manager.ts
    - packages/server/src/ws/message-handlers.ts
    - packages/server/src/ws/handler.ts
decisions: []
metrics:
  duration: "3min"
  completed: "2026-01-31"
---

# Phase 4 Plan 2: Server-Side Fog Logic Summary

**One-liner:** Adjacency computation, persistent reveal/hide with hex_visibility DB writes, and FOG-05 filtered session:state payloads

## Tasks Completed

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Create fog-utils and update session manager | 50e16ca | fog-utils.ts with adjacency/DB functions, mapData field on SessionRoom |
| 2 | Update message handlers and WS connect for fog enforcement | 8394238 | DB-persistent reveal/hide, filtered session:state for players |

## What Was Built

### fog-utils.ts
- **getNeighborKeys**: Parses "q,r" key, returns 6 flat-top neighbor keys
- **computeAdjacentHexes**: Given revealed set and all hex keys, returns unrevealed neighbors
- **buildPlayerFogPayload**: Returns revealed keys + adjacent hexes with terrain-only data
- **loadFogState**: Queries hex_visibility, returns Map<hexKey, Set<userId>>
- **loadMapData**: Queries campaign_hex, returns Map<hexKey, {terrain, terrainVariant}>

### Updated handleHexReveal
- Persists to hex_visibility with onConflictDoNothing
- Uses "__all__" sentinel for "all players" reveals
- Builds terrain from room.mapData cache instead of placeholder
- Includes adjacentHexes in hex:revealed payload

### New handleHexHide
- Removes hex keys from in-memory revealedHexes
- Deletes from hex_visibility DB (targeted or all)
- Broadcasts hex:hidden to affected players

### Fog-Filtered WS Connect
- On first connect, loads fog state and map data from DB into room cache
- DM receives all revealed hex keys (full visibility)
- Players receive only their revealed keys + adjacent terrain (FOG-05 enforced)
- Fog state survives server restart via DB reload

## Decisions Made

None -- followed existing patterns from 04-01.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted async session state to helper function**
- **Found during:** Task 2 (tsc verification)
- **Issue:** onOpen callback is synchronous, cannot use await directly
- **Fix:** Created `sendSessionState` async helper, called via `void` fire-and-forget pattern
- **Files modified:** packages/server/src/ws/handler.ts

**2. [Rule 1 - Bug] Fixed stale `room` variable reference in onOpen**
- **Found during:** Task 2 (tsc verification)
- **Issue:** After refactoring session:state into helper, `room` variable no longer in scope for player_join log
- **Fix:** Added `const currentRoom = sessionManager.getRoom(campaignId)` before the log check
- **Files modified:** packages/server/src/ws/handler.ts

## Next Phase Readiness

Plan 04-03 can proceed. Server-side fog logic is complete with DB persistence, adjacency computation, and filtered payloads.
