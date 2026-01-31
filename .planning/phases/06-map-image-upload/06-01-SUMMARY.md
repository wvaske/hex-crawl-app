---
phase: 06-map-image-upload
plan: 01
subsystem: server
tags: [drizzle, hono, file-upload, storage, websocket]
depends_on: []
provides: [campaign_map-table, map_image_layer-table, storage-backend, image-upload-routes, ws-layer-messages]
affects: [06-02, 06-03, 06-04]
tech_stack:
  added: []
  patterns: [storage-abstraction, multipart-upload]
key_files:
  created:
    - packages/server/src/db/schema/map.ts
    - packages/server/src/db/schema/map-image-layer.ts
    - packages/server/src/storage/interface.ts
    - packages/server/src/storage/local.ts
    - packages/server/src/routes/map-images.ts
  modified:
    - packages/server/src/db/schema/index.ts
    - packages/server/src/app.ts
    - packages/server/drizzle.config.ts
    - packages/shared/src/ws-messages.ts
decisions: []
metrics:
  duration: 4min
  completed: 2026-01-31
---

# Phase 6 Plan 1: DB Schema + Storage + Upload Routes Summary

**One-liner:** campaign_map and map_image_layer tables with local file storage backend and full CRUD REST endpoints for map image layers.

## What Was Done

### Task 1: Database schema + storage abstraction
- Created `campaignMap` table with grid style settings (line color/thickness/opacity, terrain overlay, hex size X/Y, grid offset)
- Created `mapImageLayer` table with per-layer alignment (offset, scale, sort order, visibility flags)
- Implemented `StorageBackend` interface with put/getUrl/delete methods
- Implemented `LocalStorageBackend` using filesystem (mkdir + writeFile + unlink)
- Registered schemas in drizzle config and pushed to database

### Task 2: Upload routes + static serving + WS message types
- Full CRUD for campaign maps (POST create with grid inheritance, GET list, PATCH update)
- Image upload endpoint with extension validation (png/jpg/jpeg) and auto sort ordering
- Image layer list (filtered by playerVisible for non-DM users), PATCH update, DELETE with file cleanup
- Static file serving via `serveStatic` on `/uploads/*`
- Added WS message schemas: `layer:added`, `layer:updated`, `layer:removed`, `map:updated`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added new schema files to drizzle.config.ts**
- drizzle-kit uses explicit schema array, not auto-discovery
- Added map.ts and map-image-layer.ts to config to enable `db:push`

## Commits

| Hash | Message |
|------|---------|
| 32c7f57 | feat(06-01): add campaign_map and map_image_layer schemas + storage abstraction |
| 40cae3f | feat(06-01): add map image upload routes, static serving, and WS message types |
