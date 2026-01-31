---
phase: 05-tokens-and-movement
plan: 04
subsystem: client-interaction
tags: [token-drag, animation, websocket, pixi, ui]
depends_on: ["05-02", "05-03"]
provides: ["token-drag-to-move", "token-animation", "dm-token-ui", "ws-token-dispatch"]
affects: ["06-map-image-upload"]
tech_stack:
  added: []
  patterns: ["module-level-display-registry", "optimistic-update-with-snapback", "ticker-animation"]
key_files:
  created: []
  modified:
    - packages/client/src/canvas/HexInteraction.tsx
    - packages/client/src/stores/useSessionStore.ts
    - packages/client/src/components/SidePanel.tsx
    - packages/client/src/stores/useUIStore.ts
decisions:
  - id: "05-04-A"
    description: "Module-level tokenDisplayMap for cross-component token display access during drag"
  - id: "05-04-B"
    description: "Ticker-based animation processor for smooth token moves (ease-out quad, 200ms)"
  - id: "05-04-C"
    description: "Optimistic move with pendingMoves set to prevent double-drag during network latency"
metrics:
  duration: "3min"
  completed: "2026-01-31"
---

# Phase 5 Plan 4: Token Drag Integration Summary

Token drag-to-move with smooth animation, WS message wiring, and DM token creation UI.

## One-liner

Token drag interaction with optimistic moves, ease-out animation, WS dispatch for all token events, and DM creation/management panel.

## What Was Built

### Task 1: Token drag interaction and WS message wiring
- **Pointerdown** hit-tests all tokens by distance from hex center (radius = hexSize * 0.35), closest first
- Permission check: players can only drag own tokens (ownerId === userId), DM drags any
- Viewport drag plugin paused during token drag to prevent pan conflict
- **Pointermove** moves token display object to follow cursor in world coords via parent transform math
- **Pointerup** validates target hex: players must move to adjacent (6 neighbors), DM can move anywhere
- Invalid moves snap back with smooth animation; valid moves optimistically update store and send `token:move`
- Module-level `tokenDisplayMap` registry (`registerTokenDisplay`/`unregisterTokenDisplay`) for drag access
- Module-level animation system using PixiJS ticker: ease-out quad interpolation, 200ms duration
- `pendingMoves` Set prevents double-drag during network latency (3s timeout fallback)
- Wired all 5 token server messages in useSessionStore dispatch: `token:moved`, `token:created`, `token:updated`, `token:deleted`, `token:state`
- Remote moves (movedBy !== current user) update token store; local moves skip (already optimistic)

### Task 2: DM token creation and management UI
- Added `'tokens'` to `SidePanelTab` union type
- New "Tokens" tab in SidePanel, visible to DM only
- Token creation form: text name input, 16 RPG emoji icon grid, 8 preset color circles, PC/NPC toggle
- PC tokens show player assignment dropdown from connected players
- "Place Token" button sends `token:create` with selected hex key
- Token list shows all tokens with icon, color dot, label, type badge (PC blue / NPC orange)
- Visibility toggle button per token (sends `token:update` with `visible` flip)
- Delete button per token (sends `token:delete`)

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 05-04-A | Module-level tokenDisplayMap | Follows ViewportContext pattern for cross-component PixiJS object access |
| 05-04-B | Ticker-based animation with ease-out quad | Smooth 200ms animation integrated into existing useTick loop |
| 05-04-C | Optimistic moves with pendingMoves guard | Prevents double-drag, server confirmation clears pending state |

## Next Phase Readiness

Phase 5 is now complete. All token functionality is wired:
- Schema (05-01), server handlers (05-02), client store + display utilities (05-03), and interaction + UI (05-04)
- TokenLayer component still needs to be created to render tokens on the canvas (using registerTokenDisplay from HexInteraction)
- This is a known gap - TokenLayer was part of 05-03's scope but the display registry bridge was added here
