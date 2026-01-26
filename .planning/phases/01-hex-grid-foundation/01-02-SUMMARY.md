---
phase: 01-hex-grid-foundation
plan: 02
subsystem: rendering
tags: [pixi.js, "@pixi/react", pixi-viewport, sprite-rendering, terrain-textures, viewport-culling, pan-zoom, canvas-2d]

requires:
  - phase: 01-hex-grid-foundation (plan 01)
    provides: pnpm monorepo, GameHex class, createGrid, hex coordinate helpers, Zustand stores, terrain types/colors, BFS terrain generation
provides:
  - Runtime terrain texture generation (30 textures via offscreen Canvas 2D)
  - "@pixi/react Application wrapper with extend() component registration"
  - pixi-viewport integration with drag/pinch/wheel/decelerate and zoom clamping
  - Sprite-based hex terrain rendering with viewport culling
  - Grid line overlay with imperative Graphics
  - Layered container architecture (terrain z:0, grid lines z:1)
  - Auto-initialized 15x15 default map with BFS terrain
affects: [01-03, 01-04, 02-server-foundation, 06-map-image-upload]

tech-stack:
  added: []
  patterns: [sprite-based-hex-rendering, viewport-culling, imperative-pixi-management, offscreen-canvas-texture-generation, pixi-viewport-extend-pattern]

key-files:
  created:
    - packages/client/src/hex/textures.ts
    - packages/client/src/canvas/HexMapCanvas.tsx
    - packages/client/src/canvas/ViewportContainer.tsx
    - packages/client/src/canvas/layers/TerrainLayer.tsx
    - packages/client/src/canvas/layers/GridLineLayer.tsx
    - packages/client/src/canvas/HexSprite.tsx
    - packages/client/src/pixi-viewport-jsx.d.ts
  modified:
    - packages/client/src/components/MapView.tsx

key-decisions:
  - "Sprite-based rendering with pre-generated textures for 60 FPS at 500+ hexes"
  - "Offscreen Canvas 2D for runtime texture generation (no external asset pipeline)"
  - "pixi-viewport registered as custom JSX component via extend({ Viewport })"
  - "Imperative Graphics management for grid lines (avoiding @pixi/react draw callback limitation)"
  - "Viewport culling via AABB bounds check per tick with threshold-based recalculation"
  - "Seeded PRNG (mulberry32) for deterministic terrain noise patterns per variant"

patterns-established:
  - "Extend pattern: register PixiJS + custom components via extend() before JSX use"
  - "Imperative layer pattern: useRef + useEffect for performance-critical PixiJS objects"
  - "Viewport culling pattern: compare viewport bounds on tick, show/hide sprites by AABB"
  - "Texture generation pattern: offscreen Canvas 2D with hex clipping path and noise overlay"

duration: 12min
completed: 2026-01-26
---

# Phase 1 Plan 2: PixiJS Rendering Pipeline Summary

**Sprite-based hex terrain rendering with pixi-viewport pan/zoom, runtime Canvas 2D texture generation, and viewport culling for 60 FPS at 500+ hexes**

## Performance

- **Duration:** 12 min
- **Started:** 2026-01-26T16:31:07Z
- **Completed:** 2026-01-26T16:42:41Z
- **Tasks:** 2
- **Files created:** 7
- **Files modified:** 1

## Accomplishments
- Built runtime terrain texture generation system producing 30 textures (10 terrain types x 3 noise variants) using offscreen Canvas 2D with seeded PRNG
- Integrated @pixi/react Application with pixi-viewport for smooth drag-to-pan, scroll-wheel zoom, pinch-to-zoom, and decelerate with zoom clamping (0.25x to 4.0x)
- Implemented sprite-based hex terrain rendering with viewport culling that only shows hexes visible in the current viewport
- Created grid line overlay using imperative Graphics management for thin hex outlines
- Established layered container architecture (terrain layer z:0, grid lines z:1) ready for highlights z:2 and UI overlay z:3
- Auto-initializes a default 15x15 hex map with BFS-generated terrain on first load

## Task Commits

Each task was committed atomically:

1. **Task 1: Generate terrain textures and set up PixiJS canvas with pixi-viewport** - `56159cd` (feat)
2. **Task 2: Render hex terrain sprites with layered containers and viewport culling** - `80e87bb` (feat)

## Files Created/Modified
- `packages/client/src/hex/textures.ts` - Runtime terrain texture generation using offscreen Canvas 2D with hex clipping and noise overlay
- `packages/client/src/canvas/HexMapCanvas.tsx` - @pixi/react Application wrapper with extend() for PixiJS + Viewport component registration
- `packages/client/src/canvas/ViewportContainer.tsx` - pixi-viewport wrapper with drag/pinch/wheel/decelerate and zoom clamping
- `packages/client/src/canvas/layers/TerrainLayer.tsx` - Sprite-based hex terrain rendering with viewport culling
- `packages/client/src/canvas/layers/GridLineLayer.tsx` - Hex border outline rendering with imperative Graphics
- `packages/client/src/canvas/HexSprite.tsx` - Factory function for creating positioned hex terrain sprites
- `packages/client/src/pixi-viewport-jsx.d.ts` - TypeScript declarations for viewport JSX element
- `packages/client/src/components/MapView.tsx` - Updated to integrate HexMapCanvas with layers and auto-create default map

## Decisions Made
- **Offscreen Canvas 2D for textures:** Generates hex textures at runtime using Canvas 2D instead of pre-built PNG assets. Avoids external tool dependencies (TexturePacker) and build-time asset pipeline. Each texture uses a hex clipping path with color fill and scattered noise dots for visual variety.
- **pixi-viewport as extend() custom component:** Registered pixi-viewport's Viewport class via `extend({ Viewport })` for declarative JSX usage (`<viewport>`). Required TypeScript declaration augmentation for the `viewport` JSX element type.
- **Imperative Graphics for grid lines:** Used imperative `new Graphics()` attached to a Container via useEffect instead of `<pixiGraphics draw={...}>` because the @pixi/react `pixiGraphics` component requires a mandatory `draw` prop that doesn't integrate well with per-tick viewport culling.
- **AABB viewport culling with threshold:** Checks each sprite's position against viewport bounds every tick, but only recalculates when bounds change by more than 10 pixels. This avoids unnecessary work during minor viewport jitter.
- **Seeded PRNG (mulberry32):** Terrain noise patterns use a deterministic seed based on terrain index and variant, ensuring consistent visual appearance across page reloads.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript type declarations for pixi-viewport JSX element**
- **Found during:** Task 1 (ViewportContainer creation)
- **Issue:** `<viewport>` JSX element not recognized by TypeScript. @pixi/react's `extend()` registers the component at runtime, but TypeScript needs compile-time type information.
- **Fix:** Created `pixi-viewport-jsx.d.ts` augmenting @pixi/react's `PixiElements` interface with viewport/pixiViewport types.
- **Files created:** `packages/client/src/pixi-viewport-jsx.d.ts`
- **Verification:** TypeScript compiles without errors
- **Committed in:** `56159cd` (Task 1 commit)

**2. [Rule 3 - Blocking] Switched GridLineLayer from pixiGraphics draw prop to imperative Graphics**
- **Found during:** Task 2 (GridLineLayer implementation)
- **Issue:** @pixi/react's `<pixiGraphics>` component requires a mandatory `draw` callback prop. This draw callback pattern doesn't integrate well with per-tick viewport culling that needs to check viewport bounds and conditionally redraw.
- **Fix:** Used imperative `new Graphics()` instance managed via `useEffect`, attached to a `<pixiContainer>`. Grid lines are drawn on tick with threshold-based viewport bounds change detection.
- **Files modified:** `packages/client/src/canvas/layers/GridLineLayer.tsx`
- **Verification:** Grid lines render correctly, culling works, TypeScript compiles
- **Committed in:** `80e87bb` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both auto-fixes were necessary to unblock TypeScript compilation and correct rendering. No scope creep.

## Issues Encountered
- `noUncheckedIndexedAccess` in tsconfig caused errors when accessing array elements by index in the hex corner iteration. Fixed with non-null assertions (`corners[i]!`) since the loop bounds guarantee valid indices.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Rendering pipeline complete: terrain sprites, grid lines, pan/zoom all functional
- Ready for Plan 03 (hex interaction: click/hover, selection, coordinate labels)
- Ready for Plan 04 (terrain painting, side panel integration)
- Layered container architecture provides z-ordering slots for highlight layer (z:2) and UI overlay (z:3)

---
*Phase: 01-hex-grid-foundation*
*Completed: 2026-01-26*
