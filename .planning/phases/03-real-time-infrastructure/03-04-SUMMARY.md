---
phase: 03-real-time-infrastructure
plan: 04
subsystem: integration
tags: [websocket, session-controls, player-presence, connection-banner, e2e-verification, vitest]

# Dependency graph
requires:
  - phase: 03-real-time-infrastructure
    plan: 02
    provides: "SessionManager with room tracking, message handlers, event logging"
  - phase: 03-real-time-infrastructure
    plan: 03
    provides: "useSessionStore, useWebSocket hook, ConnectionBanner, SessionOverlay"
provides:
  - "DM session controls (start/pause/resume/end) wired to server via WebSocket"
  - "Player presence list with online/offline status"
  - "WebSocket connected in App.tsx when campaign selected"
  - "ConnectionBanner and SessionOverlay mounted at app level"
  - "Test infrastructure (vitest) for server and client"
affects: [04-fog-of-war, 05-tokens-movement]

# Tech tracking
tech-stack:
  added:
    - "vitest (server + client test runner)"
    - "@testing-library/react + @testing-library/jest-dom (client component tests)"
    - "jsdom (client test environment)"
  patterns:
    - "Dev-mode origin permissiveness: CORS, WS origin check, and Better Auth trustedOrigins all accept any origin when NODE_ENV !== production"
    - "ALLOWED_ORIGINS env var for production origin configuration"
    - "StrictMode double-mount guard: close old WS on replacement, skip stale onClose handlers"

key-files:
  created:
    - "packages/client/src/components/campaigns/SessionControls.tsx"
    - "packages/client/src/components/campaigns/PlayerPresenceList.tsx"
    - "packages/server/vitest.config.ts"
    - "packages/client/vitest.config.ts"
    - "packages/client/src/test/setup.ts"
    - "packages/server/src/ws/__tests__/session-manager.test.ts"
    - "packages/client/src/stores/__tests__/useSessionStore.test.ts"
    - "packages/client/src/components/__tests__/ConnectionBanner.test.tsx"
    - "packages/client/src/hooks/__tests__/useWebSocket.test.ts"
  modified:
    - "packages/client/src/App.tsx"
    - "packages/client/src/components/campaigns/CampaignDashboard.tsx"
    - "packages/client/src/components/SessionOverlay.tsx"
    - "packages/server/src/ws/handler.ts"
    - "packages/server/src/ws/session-manager.ts"
    - "packages/server/src/app.ts"
    - "packages/server/src/auth.ts"

key-decisions:
  - "Pause overlay shown only to players -- DM needs access to resume/end controls in dashboard"
  - "Dev-mode origin handling uses wildcard/permissive checks to support Tailscale/LXD port forwarding"
  - "onMessage handler parameter renamed from _ws to ws -- it's needed by handleClientMessage"
  - "Sign Out button offset to right-[316px] in map view to avoid overlapping SidePanel"
  - "StrictMode WS fix: server closes old socket on replacement (code 4000) and skips stale onClose events"

patterns-established:
  - "Test infrastructure: vitest for both packages, jsdom + testing-library for client"
  - "Environment-based origin config: ALLOWED_ORIGINS env var, permissive in dev, strict in production"

# Metrics
duration: manual (interactive debugging session)
completed: 2026-01-30
---

# Phase 3 Plan 4: Integration, Verification & Bug Fixes Summary

**Wired WebSocket, session controls, and presence list into App and CampaignDashboard. Fixed StrictMode reconnection loop, dev-mode origin restrictions, onMessage handler crash, and DM pause overlay blocking.**

## Performance

- **Duration:** Interactive debugging session across multiple iterations
- **Completed:** 2026-01-30
- **Files modified:** 17 (7 created, 10 modified)

## Accomplishments

- SessionControls component provides DM with start/pause/resume/end buttons and broadcast mode toggle
- PlayerPresenceList shows connected players with green online indicators
- WebSocket connects when campaign selected, disconnects on navigation away
- ConnectionBanner and SessionOverlay mounted at app level for all views
- Test infrastructure with vitest: 18 tests across 4 test files (all passing)

## Bug Fixes During Verification

1. **StrictMode reconnection loop** — Server's addConnection now closes old WS before replacing; onClose guards against stale removal
2. **Dev-mode origin restrictions** — CORS, WS origin check, and Better Auth trustedOrigins all made permissive in dev to support Tailscale/LXD connections
3. **onMessage ReferenceError** — Parameter was `_ws` but `handleClientMessage` referenced `ws`; renamed parameter
4. **DM pause overlay blocking** — Full-screen pause overlay now shown only to players so DM can access controls
5. **Sign Out overlapping Import/Export tab** — Button offset past SidePanel in map view

## Commits

1. `eb78465` - feat(03-04): wire WebSocket, overlays, and session controls into App and CampaignDashboard
2. `fa63da1` - fix(03-04): add missing @hex-crawl/shared workspace dependency to server
3. `ed4d533` - fix(ws): prevent banner flash from StrictMode double-mount
4. `e03223d` - fix(03-04): allow dev origins, fix onMessage ws ref, unblock DM pause

## Checkpoint Verification Results

| Test | Result |
|------|--------|
| Connection test (WS connects, no banner flash) | Passed |
| Session lifecycle (start/pause/resume/end with real-time updates) | Passed |
| Reconnection test (server stop/restart, banners appear/disappear) | Passed |
| Presence test (player join/leave updates DM's list) | Passed |
| Database verification (game_session + session_event records) | Passed |

## Deviations from Plan

- Multiple bug fixes required during manual verification (origin restrictions, handler crash, overlay blocking)
- Diagnostic logging added to useWebSocket (temporary, tagged [WS-DIAG])
- Test infrastructure added as part of StrictMode fix investigation

## Next Phase Readiness

- All Phase 3 success criteria verified and passing
- Real-time infrastructure ready for Phase 4 (Fog of War): hex reveals will use existing broadcastToPlayers + hex:revealed message type
- Store dispatch already handles hex:revealed and hex:updated message types
- Test infrastructure in place for future phases

---
*Phase: 03-real-time-infrastructure*
*Completed: 2026-01-30*
