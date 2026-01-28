---
phase: 03-real-time-infrastructure
plan: 03
subsystem: ui
tags: [zustand, websocket, react-hooks, reconnection, session-state, real-time]

# Dependency graph
requires:
  - phase: 03-real-time-infrastructure
    plan: 01
    provides: "Zod-validated ServerMessage/ClientMessage schemas, session types, Vite /ws proxy"
provides:
  - "Zustand session store (useSessionStore) managing connection, session, player, and hex state"
  - "WebSocket connection hook (useWebSocket) with exponential backoff + jitter reconnection"
  - "ConnectionBanner component for connection loss/reconnecting status"
  - "SessionOverlay component for waiting/paused/ended session states"
affects: [03-04, 04-fog-of-war, 05-player-experience]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zustand store dispatch pattern: switch on ServerMessage.type, create new Map/Set for reactivity"
    - "WebSocket hook exposes sendMessage via store (not return value)"
    - "Exponential backoff with jitter: 1s initial, 30s max, 75-125% randomization"
    - "Intentional close nulls onclose handler to prevent reconnect loop"

key-files:
  created:
    - "packages/client/src/stores/useSessionStore.ts"
    - "packages/client/src/hooks/useWebSocket.ts"
    - "packages/client/src/components/ConnectionBanner.tsx"
    - "packages/client/src/components/SessionOverlay.tsx"
  modified: []

key-decisions:
  - "sendMessage exposed via Zustand store (not hook return) for cross-component access"
  - "Intentional close sets ws.onclose = null to prevent reconnection on cleanup/campaign change"
  - "setSendMessage(null) on close to prevent stale sends during reconnection window"

patterns-established:
  - "dispatch(message) pattern for routing WS messages into Zustand state updates"
  - "Connection lifecycle: connecting -> connected -> reconnecting (on close) -> connecting (retry)"
  - "Session overlays: z-[90] for session state, z-[100] for connection banner, z-[80] for subtle indicators"

# Metrics
duration: 2min
completed: 2026-01-28
---

# Phase 3 Plan 3: Client Real-Time Infrastructure Summary

**Zustand session store with ServerMessage dispatch, WebSocket hook with exponential backoff reconnection, and connection/session overlay components**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-28T01:12:55Z
- **Completed:** 2026-01-28T01:14:43Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- useSessionStore handles all 11 ServerMessage types with proper Map/Set reactivity (new instances on every update)
- useWebSocket connects to /ws?campaignId=X, dispatches incoming messages, reconnects with exponential backoff + jitter
- ConnectionBanner shows yellow "Connecting..." or red "Connection lost. Reconnecting..." overlay banners
- SessionOverlay renders role-appropriate overlays for waiting, paused, ended states plus subtle DM-preparing indicator

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useSessionStore and useWebSocket hook** - `583cbf6` (feat)
2. **Task 2: Create ConnectionBanner and SessionOverlay UI components** - `d1d6d07` (feat)

## Files Created/Modified
- `packages/client/src/stores/useSessionStore.ts` - Zustand store for real-time session state with dispatch for all ServerMessage types
- `packages/client/src/hooks/useWebSocket.ts` - React hook managing WebSocket lifecycle, reconnection, and store dispatch
- `packages/client/src/components/ConnectionBanner.tsx` - Persistent top banner for connection loss/reconnecting status
- `packages/client/src/components/SessionOverlay.tsx` - Full-screen overlays for waiting/paused/ended states and DM preparing indicator

## Decisions Made
- sendMessage function exposed via Zustand store (setSendMessage) rather than hook return value, enabling any component to send messages without prop drilling
- Intentional close (cleanup/campaign change) sets ws.onclose = null before calling close() to prevent triggering the reconnection loop
- setSendMessage(null) called immediately on socket close to prevent stale send attempts during the reconnection window

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Session store and WebSocket hook are ready for integration with App.tsx (Plan 03-04)
- ConnectionBanner and SessionOverlay can be mounted in the layout
- Store dispatch handles all server message types; Phase 4 hex:updated will need to bridge to useMapStore
- sendMessage on store is ready for DM controls to invoke client-to-server messages

---
*Phase: 03-real-time-infrastructure*
*Completed: 2026-01-28*
