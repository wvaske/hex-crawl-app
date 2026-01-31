---
phase: 06-map-image-upload
plan: 02
subsystem: client-canvas
tags: [zustand, pixi, image-layer, sprites]
depends_on:
  requires: [01-02]
  provides: [image-layer-store, image-layer-component]
  affects: [06-03, 06-04]
tech-stack:
  added: []
  patterns: [async-texture-loading, sortable-children-zindex]
key-files:
  created:
    - packages/client/src/stores/useImageLayerStore.ts
    - packages/client/src/canvas/layers/ImageLayer.tsx
  modified:
    - packages/client/src/components/MapView.tsx
    - packages/client/vite.config.ts
decisions: []
metrics:
  duration: 1min
  completed: 2026-01-31
---

# Phase 06 Plan 02: Client Image Rendering Summary

Zustand store + PixiJS ImageLayer component rendering uploaded map images as background sprites beneath the hex grid.

## What Was Done

### Task 1: useImageLayerStore (24e5498)
Created Zustand store following existing patterns (useTokenStore). ImageLayerData type with offset/scale/visibility fields. CRUD actions for layers, alignment mode state, and reorderLayers for drag-and-drop sorting. Uses array with sort-on-mutate pattern (layers always sorted by sortOrder).

### Task 2: ImageLayer component + MapView + Vite proxy (1a0b93a)
Created ImageLayer component that async-loads textures via Assets.load and creates Sprites with position/scale from layer data. Uses sortableChildren + zIndex for correct render order among multiple image layers. Wired into MapView as first viewport child (z:0, before TerrainLayer). Added /uploads Vite proxy for dev server.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- TypeScript compilation passes with no errors
- ImageLayer mounts as first viewport child
- Empty layers array causes no errors (no sprites created)
- Vite proxy configured for /uploads path
