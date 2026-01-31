---
phase: 04-fog-of-war
plan: 03
subsystem: client-rendering
tags: [pixi, fog-of-war, zustand, canvas, graphics]
dependency_graph:
  requires: [04-01]
  provides: [FogLayer-component, adjacentHexKeys-store, hex-hidden-dispatch]
  affects: [04-04]
tech_stack:
  added: []
  patterns: [two-tier-fog-overlay, graphics-viewport-culling]
key_files:
  created:
    - packages/client/src/canvas/layers/FogLayer.tsx
  modified:
    - packages/client/src/stores/useSessionStore.ts
    - packages/client/src/components/MapView.tsx
decisions: []
metrics:
  duration: "3min"
  completed: "2026-01-31"
---

# Phase 4 Plan 3: FogLayer Client Rendering Summary

**One-liner:** Two-tier fog overlay with opaque hidden hexes, dimmed adjacent hexes, and DM tint using PixiJS Graphics with viewport culling

## Tasks Completed

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Extend session store with adjacentHexKeys and hex:hidden | 54a24de | adjacentHexKeys Set, hex:hidden dispatch, adjacency tracking on reveals |
| 2 | Create FogLayer and integrate into MapView | 9407e3e | FogLayer.tsx, MapView integration between grid and highlights |

## What Was Built

### Session Store Extensions
- **adjacentHexKeys**: New `Set<string>` tracking hexes adjacent to revealed hexes (tier-1 fog zone)
- **session:state handler**: Populates adjacentHexKeys from message.adjacentHexes
- **hex:revealed handler**: Updates adjacentHexKeys and removes newly-revealed keys from adjacent set
- **hex:hidden handler**: Removes hidden keys from revealedHexKeys, clears adjacentHexKeys

### FogLayer Component
- **Tier 2 (hidden)**: 0x1a1a2e fill at 0.95 alpha -- nearly opaque, hides all terrain
- **Tier 1 (adjacent)**: 0x2a2a3e fill at 0.55 alpha -- dimmed but terrain visible
- **DM tint**: 0xff4444 at 0.08 alpha -- subtle red indicator on unrevealed hexes
- **Viewport culling**: AABB bounds check with 100px padding, same pattern as TerrainLayer
- **Change detection**: Only redraws when revealedHexKeys, adjacentHexKeys, role, or hex count changes
- **Layer order**: Positioned at z:2 between GridLineLayer and HighlightLayer

## Decisions Made

None -- followed established patterns from HighlightLayer and TerrainLayer.

## Deviations from Plan

None -- plan executed exactly as written.

## Next Phase Readiness

Plan 04-04 can proceed. FogLayer renders reactively and the store handles all fog-related WS messages.
