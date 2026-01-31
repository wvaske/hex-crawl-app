---
phase: 04-fog-of-war
plan: 04
subsystem: ui
tags: [fog-of-war, websocket, zustand, pixi, dm-controls]

requires:
  - phase: 04-02
    provides: FogLayer rendering with two-tier fog
  - phase: 04-03
    provides: Server-side fog persistence and WS message handlers
provides:
  - DM fog controls (reveal/hide selected, bulk actions with type-to-confirm)
  - useFogActions hook for fog WS messaging and map upload
  - Client-side map data fetching on session connect
affects: [05-player-tokens, 06-map-image-upload]

tech-stack:
  added: []
  patterns:
    - "Server map fetch on WS session:state for both DM and player"
    - "loadFromServer action on useMapStore for API-sourced hex data"

key-files:
  created:
    - packages/client/src/hooks/useFogActions.ts
    - packages/client/src/components/FogControls.tsx
  modified:
    - packages/client/src/components/SidePanel.tsx
    - packages/client/src/stores/useUIStore.ts
    - packages/client/src/stores/useMapStore.ts
    - packages/client/src/hooks/useWebSocket.ts

key-decisions:
  - "Map data fetched via GET /api/campaigns/:id/map after session:state received in useWebSocket"
  - "loadFromServer computes gridWidth/gridHeight from hex coordinate bounds"

patterns-established:
  - "Server data hydration: fetch REST API after WS session:state for store population"

duration: 8min
completed: 2026-01-31
---

# Phase 4 Plan 4: DM Fog Controls Summary

**DM fog controls with reveal/hide buttons, bulk type-to-confirm actions, and client map data fetching on session connect**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-01-31
- **Completed:** 2026-01-31
- **Tasks:** 2 (1 auto task + 1 checkpoint with post-checkpoint fix)
- **Files modified:** 6

## Accomplishments
- DM has full fog controls: reveal/hide selected hexes, bulk Reveal All/Hide All with type-to-confirm
- Player targeting selector for per-player fog reveals
- Map data automatically fetched from server on session connect (fixes both DM and player empty map)
- Map upload to server via Save Map button

## Task Commits

1. **Task 1: Create fog actions hook, FogControls component, and wire into SidePanel** - `3d17ccc` (feat)
2. **Fix: Fetch map data from server on session connect** - `4436b58` (fix)

## Files Created/Modified
- `packages/client/src/hooks/useFogActions.ts` - Hook for fog WS messages and map upload
- `packages/client/src/components/FogControls.tsx` - DM fog control UI with reveal/hide/bulk actions
- `packages/client/src/components/SidePanel.tsx` - Added Fog tab for DM
- `packages/client/src/stores/useUIStore.ts` - Added 'fog' to SidePanelTab type
- `packages/client/src/stores/useMapStore.ts` - Added loadFromServer action
- `packages/client/src/hooks/useWebSocket.ts` - Fetch map data after session:state

## Decisions Made
- Fetch map data in useWebSocket onmessage handler after session:state dispatch (co-located with WS lifecycle)
- loadFromServer derives gridWidth/gridHeight from hex coordinate min/max bounds
- Only fetch when mapStore.hexes.size === 0 to avoid overwriting locally-created maps

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Client never fetches map data from server on connect**
- **Found during:** Checkpoint human-verify (user reported)
- **Issue:** useMapStore.hexes was always empty on connect, causing MapView to show "create a map" and FogLayer to early-return
- **Fix:** Added loadFromServer to useMapStore; fetch GET /api/campaigns/:id/map in useWebSocket after session:state
- **Files modified:** useMapStore.ts, useWebSocket.ts
- **Verification:** pnpm tsc --noEmit passes
- **Committed in:** 4436b58

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for map rendering on connect. No scope creep.

## Issues Encountered
- Player and DM both saw empty map because client never called the existing GET map endpoint. Root cause: server had the endpoint but no client code invoked it.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full fog of war pipeline complete: DM controls -> server persistence -> WS broadcast -> client rendering
- Ready for Phase 5 (player tokens) or Phase 6 (map image upload)

---
*Phase: 04-fog-of-war*
*Completed: 2026-01-31*
