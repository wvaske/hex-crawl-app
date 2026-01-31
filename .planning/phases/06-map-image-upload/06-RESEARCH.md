# Phase 6: Map Image Upload - Research

**Researched:** 2026-01-31
**Domain:** File upload, image rendering in PixiJS, storage abstraction, DB schema for multi-layer multi-map support
**Confidence:** HIGH

## Summary

Phase 6 adds map image upload with background rendering beneath the hex grid, per-layer alignment controls, and multi-map support per campaign. The implementation spans four domains: (1) server-side file upload and storage, (2) database schema for maps, image layers, and grid settings, (3) PixiJS background image rendering, and (4) client UI for upload, layer management, and alignment mode.

The existing stack (Hono, Drizzle/PostgreSQL, PixiJS v8, Zustand, @pixi/react) handles all of this natively. Hono's `c.req.parseBody()` handles multipart uploads. PixiJS `Assets.load()` loads textures from URLs for background Sprites. Drizzle adds new schema tables. No new libraries are needed beyond what's already installed.

**Primary recommendation:** Use Hono multipart upload to save files to disk (dev) or S3 (prod) behind a simple `StorageBackend` interface. Serve uploaded files via `serveStatic` from `@hono/node-server/serve-static`. Render images as PixiJS Sprites at z-index below the terrain layer. Store layer metadata (offset, scale, ordering, visibility) in PostgreSQL. Add an "alignment mode" to the client that pauses normal hex interaction and shows grid offset/scale controls.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | ^4.11.0 | Multipart file upload via `c.req.parseBody()` | Already in stack, native multipart support |
| @hono/node-server | ^1.14.0 | `serveStatic` middleware for serving uploaded files | Already in stack |
| pixi.js | ^8.15.0 | `Assets.load()` + `Sprite` for background image rendering | Already in stack, v8 Assets API is the standard |
| drizzle-orm | ^0.45.0 | New tables for maps, image layers, grid settings | Already in stack |
| zustand | ^5.0.10 | Client stores for image layers and alignment state | Already in stack |
| node:fs/promises | built-in | Write uploaded files to local disk | Node.js built-in, no dependency |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aws-sdk/client-s3 | latest | S3-compatible upload for production | Only when deploying to production; not needed for dev |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DIY storage interface | @tweedegolf/storage-abstraction | Adds dependency for a 2-method interface (put/get); DIY is simpler given only local+S3 |
| Hono parseBody | multer/busboy | Hono already handles multipart natively; extra deps unnecessary |
| PixiJS Assets.load | raw Image() + Texture.from() | Assets.load handles caching, async, and cleanup; no reason to bypass |

**Installation:**
```bash
# No new packages needed for development
# For production S3 support (when needed):
# pnpm --filter @hex-crawl/server add @aws-sdk/client-s3
```

## Architecture Patterns

### Recommended Project Structure

```
packages/server/src/
├── storage/
│   ├── interface.ts         # StorageBackend interface (put, getUrl, delete)
│   ├── local.ts             # LocalStorageBackend (fs write + serve path)
│   └── s3.ts                # S3StorageBackend (future, production)
├── routes/
│   └── map-images.ts        # Upload/delete/list image layer routes
├── db/schema/
│   ├── map.ts               # campaign_map table
│   └── map-image-layer.ts   # map_image_layer table

packages/client/src/
├── canvas/layers/
│   └── ImageLayer.tsx        # PixiJS Sprite layer for background images
├── stores/
│   └── useImageLayerStore.ts # Zustand store for image layers + alignment
├── components/
│   ├── ImageLayerPanel.tsx   # Layer list with drag-to-reorder, visibility, upload
│   └── AlignmentControls.tsx # Grid alignment mode UI (offset, scale inputs + drag)
```

### Pattern 1: Storage Backend Interface

**What:** Simple interface abstracting local filesystem vs S3 storage
**When to use:** All file storage operations

```typescript
// packages/server/src/storage/interface.ts
export interface StorageBackend {
  /** Store a file, return its storage key */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Get the public URL/path for a stored file */
  getUrl(key: string): string;
  /** Delete a stored file */
  delete(key: string): Promise<void>;
}
```

```typescript
// packages/server/src/storage/local.ts
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export class LocalStorageBackend implements StorageBackend {
  constructor(private basePath: string, private urlPrefix: string) {}

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const filePath = join(this.basePath, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  getUrl(key: string): string {
    return `${this.urlPrefix}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await unlink(join(this.basePath, key)).catch(() => {});
  }
}
```

### Pattern 2: Hono Multipart Upload Route

**What:** File upload endpoint using Hono's native parseBody
**When to use:** Image upload route

```typescript
// Hono file upload pattern
app.post('/:mapId/images', async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'];
  if (!(file instanceof File)) return c.json({ error: 'No file' }, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !['png', 'jpg', 'jpeg'].includes(ext)) {
    return c.json({ error: 'Unsupported format' }, 400);
  }

  const key = `maps/${mapId}/${crypto.randomUUID()}.${ext}`;
  await storage.put(key, buffer, file.type);

  // Insert DB row for the image layer
  // Return the layer metadata with URL
});
```

### Pattern 3: PixiJS Background Image Sprite

**What:** Loading an image URL into a PixiJS Sprite positioned behind the hex grid
**When to use:** ImageLayer component

```typescript
// Source: https://pixijs.com/8.x/guides/components/assets
import { Assets, Sprite, Container } from 'pixi.js';

// Load texture from server URL
const texture = await Assets.load(imageUrl);
const sprite = new Sprite(texture);

// Position at layer's offset (image stays fixed, grid moves over it)
sprite.position.set(layer.offsetX, layer.offsetY);

// Scale independently for H and V
sprite.scale.set(layer.scaleX, layer.scaleY);

// Add to container at z-index below terrain
container.addChild(sprite);
```

### Pattern 4: Database Schema for Multi-Map + Multi-Layer

**What:** PostgreSQL tables for maps and image layers per campaign
**When to use:** Persisting map and layer state

```typescript
// campaign_map - multiple maps per campaign
export const campaignMap = pgTable("campaign_map", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // Grid style settings (per-map, inheritable)
  gridLineColor: text("grid_line_color").notNull().default("#ffffff"),
  gridLineThickness: real("grid_line_thickness").notNull().default(1.0),
  gridLineOpacity: real("grid_line_opacity").notNull().default(0.4),
  terrainOverlayEnabled: boolean("terrain_overlay_enabled").notNull().default(false),
  terrainOverlayOpacity: real("terrain_overlay_opacity").notNull().default(0.3),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// map_image_layer - multiple images per map
export const mapImageLayer = pgTable("map_image_layer", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull().references(() => campaignMap.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  // Per-layer alignment
  offsetX: real("offset_x").notNull().default(0),
  offsetY: real("offset_y").notNull().default(0),
  scaleX: real("scale_x").notNull().default(1.0),
  scaleY: real("scale_y").notNull().default(1.0),
  // Layer management
  sortOrder: integer("sort_order").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  playerVisible: boolean("player_visible").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Pattern 5: Alignment Mode UI

**What:** Dedicated mode where DM adjusts grid offset/scale over the image
**When to use:** When DM needs to align grid to uploaded image

The alignment mode:
1. DM clicks "Enter Alignment Mode" for a specific layer
2. Normal hex interaction is paused (no select, no paint)
3. Grid shows with enhanced visibility (thicker lines, distinct color)
4. Controls appear: drag to reposition grid offset, numeric inputs for fine-tuning
5. Sliders/inputs for hexSizeX and hexSizeY (independent H/V scale)
6. DM clicks "Done" to exit alignment mode and save settings

### Anti-Patterns to Avoid

- **Loading full image into WebSocket messages:** Images must go through HTTP upload, not WS. WS is only for metadata sync (layer added/removed/reordered).
- **Storing images in PostgreSQL blobs:** Use filesystem/S3 for binary data, DB for metadata only.
- **Creating a new PixiJS Application for the image:** Render image as a Sprite child of the existing viewport, not a separate canvas.
- **Rebuilding terrain sprites when image is present:** Image layer is independent; terrain layer continues working as-is. Only grid line appearance changes (wireframe vs filled).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart parsing | Custom body parser | `c.req.parseBody()` | Hono handles it natively including File objects |
| Image texture loading | Manual Image() + onload | `Assets.load(url)` | Handles caching, async, format detection, cleanup |
| Static file serving | Custom stream handler | `serveStatic` from @hono/node-server | Handles range requests, MIME types, security |
| Drag-to-reorder list | Custom drag implementation | HTML drag-and-drop API or a minimal sort | Small list (few layers), native DnD is sufficient |
| UUID generation | Custom ID gen | `crypto.randomUUID()` | Already used throughout the project |

**Key insight:** The existing stack already handles every piece of this phase. The complexity is in wiring the pieces together correctly, not in finding new tools.

## Common Pitfalls

### Pitfall 1: PixiJS Sprite Z-Order in Viewport
**What goes wrong:** Image layer renders on top of hex grid or fog because container order is wrong
**Why it happens:** PixiJS renders children in add-order; the image container must be added before terrain
**How to avoid:** In MapView, insert `<ImageLayer />` as the FIRST child of the viewport, before `<TerrainLayer />`. The layer order becomes: ImageLayer (z:0) -> TerrainLayer (z:1) -> GridLineLayer (z:2) -> etc.
**Warning signs:** Image covers hexes after upload

### Pitfall 2: Large Image Memory
**What goes wrong:** Uploading a 50MB map image causes browser tab crash
**Why it happens:** PixiJS creates a GPU texture from the image; very large images exceed GPU memory
**How to avoid:** While no hard file size limit, warn users about images over ~20MB. Consider downscaling on the server side for extremely large images. PixiJS v8 handles reasonable image sizes (up to ~8192x8192 on most GPUs) without issues.
**Warning signs:** WebGL context lost errors, blank textures

### Pitfall 3: CORS on Uploaded Image URLs
**What goes wrong:** PixiJS Assets.load fails for uploaded images served from a different origin
**Why it happens:** In production, images might be served from S3/CDN on a different domain
**How to avoid:** In dev, images are served from same origin via Hono serveStatic through the Vite proxy. In production, ensure S3 bucket CORS allows the app origin, or proxy through the server.
**Warning signs:** "Cross-origin image load denied" errors

### Pitfall 4: Alignment Mode Conflicts with Hex Interaction
**What goes wrong:** DM tries to drag grid offset but instead selects hexes or pans viewport
**Why it happens:** Multiple pointer event handlers compete for the same gestures
**How to avoid:** When alignment mode is active, disable hex interaction (HexInteraction component) and viewport drag plugin. Alignment drag operates on grid offset values, not viewport position.
**Warning signs:** Viewport pans instead of grid moving

### Pitfall 5: Layer Sync Between DM and Players
**What goes wrong:** Player sees DM-only layers or stale layer data
**Why it happens:** Layer metadata not properly filtered by playerVisible flag
**How to avoid:** Server filters layers in GET response based on user role. WS broadcasts layer changes (add/remove/reorder/visibility) with role-based filtering. Player never receives DM-only layer URLs.
**Warning signs:** Players see secret DM reference layers

### Pitfall 6: File Cleanup on Layer Delete
**What goes wrong:** Deleted layers leave orphaned files on disk/S3
**Why it happens:** DB row deleted but storage.delete not called
**How to avoid:** Always call storage.delete(storageKey) before or after deleting the DB row. Use a try/catch so DB deletion succeeds even if storage cleanup fails (log warning).
**Warning signs:** Storage usage grows indefinitely

## Code Examples

### Hono File Upload with Local Storage

```typescript
// Source: https://hono.dev/examples/file-upload + node:fs/promises
import { Hono } from 'hono';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const UPLOAD_DIR = './uploads';

app.post('/api/campaigns/:campaignId/maps/:mapId/images', requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'];
  if (!(file instanceof File)) return c.json({ error: 'No image file provided' }, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  const key = `${c.req.param('mapId')}/${crypto.randomUUID()}.${ext}`;
  const filePath = join(UPLOAD_DIR, key);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);

  // Insert into map_image_layer table...
  return c.json({ id: layerId, url: `/uploads/${key}` });
});
```

### Serving Uploaded Files

```typescript
// Source: https://hono.dev/docs/getting-started/nodejs
import { serveStatic } from '@hono/node-server/serve-static';

// Serve uploaded images at /uploads/*
app.use('/uploads/*', serveStatic({ root: './' }));
```

Add Vite proxy for `/uploads`:
```typescript
// vite.config.ts proxy addition
'/uploads': {
  target: 'http://localhost:3000',
  changeOrigin: true,
},
```

### PixiJS Image Layer Component

```typescript
// Source: https://pixijs.com/8.x/guides/components/assets
import { Assets, Sprite, Container } from 'pixi.js';
import { useEffect, useRef } from 'react';

export function ImageLayer() {
  const containerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Map<string, Sprite>>(new Map());

  // Subscribe to image layer store for layers data
  const layers = useImageLayerStore((s) => s.layers);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Load and display each visible layer
    async function loadLayers() {
      // Clear existing sprites
      for (const [id, sprite] of spritesRef.current) {
        container!.removeChild(sprite);
        sprite.destroy();
      }
      spritesRef.current.clear();

      // Sort by sortOrder, create sprites
      const sorted = [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
      for (const layer of sorted) {
        if (!layer.visible) continue;
        const texture = await Assets.load(layer.url);
        const sprite = new Sprite(texture);
        sprite.position.set(layer.offsetX, layer.offsetY);
        sprite.scale.set(layer.scaleX, layer.scaleY);
        container!.addChild(sprite);
        spritesRef.current.set(layer.id, sprite);
      }
    }

    loadLayers();

    return () => {
      // Cleanup on unmount
      for (const [, sprite] of spritesRef.current) {
        sprite.destroy();
      }
      spritesRef.current.clear();
    };
  }, [layers]);

  return <pixiContainer ref={(ref: Container | null) => { containerRef.current = ref; }} />;
}
```

### WebSocket Layer Sync Messages

```typescript
// New WS messages for layer operations
// Server -> Client
const LayerAddedMessage = z.object({
  type: z.literal("layer:added"),
  layer: ImageLayerSchema,
});

const LayerUpdatedMessage = z.object({
  type: z.literal("layer:updated"),
  layerId: z.string(),
  updates: z.object({
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    sortOrder: z.number().optional(),
    visible: z.boolean().optional(),
    playerVisible: z.boolean().optional(),
  }),
});

const LayerRemovedMessage = z.object({
  type: z.literal("layer:removed"),
  layerId: z.string(),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PIXI.Loader (v7) | Assets.load() (v8) | PixiJS v8 | Old Loader API removed; must use Assets |
| Texture.from() for loading | Assets.load() for loading | PixiJS v8 | Texture.from() only for cached; Assets.load() for initial load |
| multer for Node.js uploads | Hono c.req.parseBody() | Always (Hono) | Multer is Express-specific; Hono has native support |

**Deprecated/outdated:**
- `PIXI.Loader`: Removed in v8, replaced by `Assets`
- `Texture.fromURL()`: Use `Assets.load()` instead

## Open Questions

1. **Grid offset storage: per-map or per-layer?**
   - What we know: CONTEXT.md says "grid moves, image stays fixed" and "per-layer alignment (offset/scale)"
   - What's unclear: The grid offset/hexSize is a single setting for the whole map, but each layer has its own offset/scale. This means the "alignment" is actually about positioning each image layer relative to the fixed grid, OR moving the grid relative to the image.
   - Recommendation: Store grid offset (gridOffsetX, gridOffsetY) and hex scale (hexSizeX, hexSizeY) on the `campaign_map` table. Store per-image offset/scale on `map_image_layer`. The alignment mode adjusts the grid settings (on campaign_map), but each image can also be repositioned independently. This gives maximum flexibility.

2. **How to handle "new maps inherit most recent settings"?**
   - What we know: CONTEXT.md specifies grid style settings stored per map; new maps inherit
   - Recommendation: When creating a new map, query the most recently created map in the same campaign and copy its grid style settings as defaults.

## Sources

### Primary (HIGH confidence)
- Hono file upload docs: https://hono.dev/examples/file-upload - parseBody API
- Hono Node.js serveStatic: https://hono.dev/docs/getting-started/nodejs - static file serving
- PixiJS v8 Assets guide: https://pixijs.com/8.x/guides/components/assets - texture loading API
- PixiJS v8 Textures guide: https://pixijs.com/8.x/guides/components/textures - Sprite/Texture fundamentals
- Existing codebase: packages/server/src/routes/map.ts, packages/client/src/canvas/layers/TerrainLayer.tsx - established patterns

### Secondary (MEDIUM confidence)
- @tweedegolf/storage-abstraction: https://github.com/tweedegolf/storage-abstraction - storage pattern reference (decided against using, but pattern informed DIY interface)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, APIs verified against official docs
- Architecture: HIGH - patterns follow established codebase conventions (Drizzle schema, Hono routes, PixiJS layers, Zustand stores)
- Pitfalls: HIGH - derived from PixiJS rendering order, CORS, and file management experience; verified against official docs

**Research date:** 2026-01-31
**Valid until:** 2026-03-01 (stable stack, no fast-moving dependencies)
