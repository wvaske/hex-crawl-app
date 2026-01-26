# Phase 1: Hex Grid Foundation - Research

**Researched:** 2026-01-26
**Domain:** Hex grid rendering with PixiJS 8, hex coordinate math, pan/zoom navigation, terrain display
**Confidence:** HIGH

## Summary

This research covers everything needed to plan Phase 1: building an interactive hex grid in the browser with terrain textures, pan/zoom navigation, and correct axial/cube coordinate math. The phase is entirely client-side (no server yet) and establishes the rendering and mathematical foundation for all future phases.

The standard approach uses PixiJS 8 (v8.15.0) for WebGL-accelerated rendering via `@pixi/react` (v8.0.5) as the React bridge, honeycomb-grid (v4.1.5) for all hex coordinate math, pixi-viewport (v6.0.3) for pan/zoom/drag camera control, and Zustand (v5.0.10) for client state management. Tailwind CSS 4 handles the non-canvas UI (side panel, creation dialog, terrain palette). The monorepo uses pnpm workspaces with Vite 7.3.1.

The most critical architectural decision is **rendering hexes as Sprites with pre-rendered terrain textures** rather than drawing hex polygons with the Graphics API on every frame. This is the difference between 60 FPS and janky rendering at 500+ hexes. Honeycomb-grid provides all the hex math (coordinate conversions, neighbor finding, distance calculations) without coupling to any renderer.

**Primary recommendation:** Use Sprite-based hex rendering with a texture atlas for terrain tiles, honeycomb-grid for coordinate math, pixi-viewport for pan/zoom, and implement application-level viewport culling by calculating which hex coordinates fall within the visible area.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pixi.js | 8.15.0 | WebGL/WebGPU 2D rendering engine | 60 FPS with 8,000+ sprites. v8 is a full rewrite with 3x CPU improvement for moving sprites, 175x for static sprites. Built-in texture management, batching, and culling. |
| @pixi/react | 8.0.5 | React-PixiJS bridge | Built from scratch for PixiJS v8 + React 19. JSX proxies via `extend()` API. Tree-shakeable. Inspired by @react-three/fiber. |
| honeycomb-grid | 4.1.5 | Hex grid math (coordinates, traversals, conversions) | TypeScript hex grid library based on Red Blob Games reference. Handles axial/cube/offset conversions, neighbor finding, distance, line drawing, rings, spirals. Renderer-agnostic. |
| pixi-viewport | 6.0.3 | Pan/zoom/drag camera for PixiJS canvas | Highly configurable viewport/2D camera. Built-in drag, pinch-to-zoom, wheel zoom, deceleration, clamping, bounce. v6.0.0+ supports PixiJS v8. |
| zustand | 5.0.10 | Client state management | 3KB bundle. Centralized store for map state, selected hex, UI state. `useShallow` for selective re-renders. |
| React | 19.x | UI framework | Required by @pixi/react v8.0.5 (React 19 exclusive). |
| Vite | 7.3.1 | Build tool / dev server | Sub-second HMR. SPA-first (no SSR needed for canvas app). Requires Node.js 20.19+ or 22.12+. |
| TypeScript | 5.9.x | Type safety | Non-negotiable for hex coordinate math and PixiJS scene graph. |
| Tailwind CSS | 4.x | Utility CSS for non-canvas UI | v4 Vite plugin. CSS-first config. Used for side panel, creation dialog, terrain palette. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tailwindcss/vite | latest | Tailwind CSS Vite plugin | Always -- use instead of PostCSS for best performance |
| react-router | 7.x | Client-side routing | Route between map view, campaign list (future phases will need this) |
| zod | 4.x | Runtime validation | Validate import/export JSON format, creation dialog inputs |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pixi-viewport | Custom pan/zoom on Container transforms | pixi-viewport handles edge cases (deceleration, clamping, pinch-to-zoom) that take hundreds of lines to hand-roll. Use pixi-viewport. |
| honeycomb-grid | Hand-rolled hex math from Red Blob Games | honeycomb-grid already implements the Red Blob Games algorithms in TypeScript. The math is stable and complete. Only hand-roll if you need algorithms honeycomb-grid doesn't provide. |
| Sprite-based hex rendering | Graphics API (drawPolygon per hex) | Graphics requires triangulation per shape, breaks GPU batching at scale. Sprites batch efficiently -- up to 16 textures per batch. Use Sprites for hex tiles. |
| @pixi/react | Direct PixiJS imperative API | @pixi/react allows declarative JSX for the scene graph, which integrates cleanly with React state. Use @pixi/react for the overall structure, drop to imperative PixiJS for performance-critical rendering. |

**Installation:**

```bash
# From monorepo root
pnpm create vite packages/client --template react-ts

# In packages/client
pnpm add pixi.js@^8.15.0 @pixi/react@^8.0.5 honeycomb-grid@^4.1.5 pixi-viewport@^6.0.3 zustand@^5.0.10 react-router@^7.13.0 zod@^4.3.6
pnpm add -D tailwindcss @tailwindcss/vite typescript

# In packages/shared (create manually)
pnpm add honeycomb-grid@^4.1.5 zod@^4.3.6
```

## Architecture Patterns

### Recommended Project Structure

```
packages/
  client/
    src/
      main.tsx                  # App entry point
      App.tsx                   # Root component with routing
      canvas/                   # PixiJS rendering layer
        HexMapCanvas.tsx        # @pixi/react Application wrapper
        layers/                 # PixiJS render layers (Containers)
          TerrainLayer.tsx      # Hex terrain sprites
          GridLineLayer.tsx     # Hex border outlines (optional visual layer)
          HighlightLayer.tsx    # Hover/selection highlights
          UIOverlayLayer.tsx    # Coordinate labels on hover
        HexSprite.tsx           # Individual hex tile sprite component
        ViewportContainer.tsx   # pixi-viewport wrapper
      components/               # React UI components
        MapView.tsx             # Main map view (canvas + side panel)
        SidePanel.tsx           # Hex info display panel
        CreationDialog.tsx      # New map creation dialog
        TerrainPalette.tsx      # Terrain type picker for manual assignment
        ImportExportDialog.tsx  # JSON import/export
      stores/                   # Zustand stores
        useMapStore.ts          # Map state (grid data, hex terrain assignments)
        useUIStore.ts           # UI state (selected hex, hover, zoom level)
      hex/                      # Hex math utilities (thin wrappers around honeycomb-grid)
        grid.ts                 # Grid creation, hex definitions
        coordinates.ts          # Coordinate conversion helpers
        terrain.ts              # Terrain type definitions and generation
        neighbors.ts            # Neighbor lookup utilities
      assets/                   # Static assets
        textures/               # Terrain texture images (placeholder PNGs)
        terrain-atlas.json      # Spritesheet manifest
      types/                    # TypeScript types
        hex.ts                  # Hex data types (terrain, coordinates)
        map.ts                  # Map data types
      styles/
        index.css               # @import "tailwindcss"
    vite.config.ts
    index.html
  shared/
    src/
      hex-types.ts              # Shared hex coordinate and terrain types
      map-schema.ts             # Zod schemas for import/export format
    package.json
  server/                       # Placeholder for Phase 2
    package.json
pnpm-workspace.yaml
package.json
```

### Pattern 1: Layered PixiJS Container Architecture

**What:** Organize the hex map as stacked PixiJS Containers, each responsible for one visual concern. Each layer is a Container added to the viewport in z-order.

**When to use:** Always. This is the standard pattern for 2D game maps.

**Example:**

```typescript
// Source: PixiJS 8 docs - Container render groups
import { Container, Sprite, Graphics } from 'pixi.js';
import { extend, Application, useApplication } from '@pixi/react';
import { Viewport } from 'pixi-viewport';

// Register PixiJS components for JSX use
extend({ Container, Sprite, Graphics });

// Layer structure inside the viewport
// viewport (pixi-viewport)
//   -> terrainLayer (Container)      - z:0 - hex terrain sprites
//   -> gridLineLayer (Container)     - z:1 - hex outlines
//   -> highlightLayer (Container)    - z:2 - hover/selection overlays
//   -> uiOverlayLayer (Container)    - z:3 - coordinate text on hover
```

### Pattern 2: Sprite-Based Hex Rendering (Not Graphics)

**What:** Render each hex as a Sprite with a pre-made terrain texture, not as a Graphics polygon drawn each frame. Use a texture atlas (spritesheet) containing all terrain variants to minimize draw calls.

**When to use:** Always for hex terrain tiles. Graphics should only be used for dynamic overlays (hover highlight, selection border).

**Why:** Sprites batch efficiently in PixiJS (up to 16 textures per batch). Graphics requires triangulation and breaks batching. For 500+ hexes, Sprites maintain 60 FPS; Graphics will jank.

**Example:**

```typescript
// Source: PixiJS 8 docs - Sprite, Assets
import { Assets, Sprite, Texture } from 'pixi.js';

// Load terrain spritesheet
const sheet = await Assets.load('assets/terrain-atlas.json');

// Create a hex sprite from the atlas
const hexSprite = new Sprite(sheet.textures['grassland_01.png']);
hexSprite.anchor.set(0.5); // Center anchor for hex positioning
hexSprite.position.set(pixelX, pixelY); // From honeycomb-grid hexToPoint()
```

### Pattern 3: Honeycomb-Grid for All Coordinate Math

**What:** Use honeycomb-grid's `defineHex`, `Grid`, and traversers for all hex coordinate operations. Never hand-roll hex math.

**When to use:** Always. All coordinate conversions, neighbor lookups, distance calculations, and grid creation go through honeycomb-grid.

**Example:**

```typescript
// Source: honeycomb-grid docs - https://abbekeultjes.nl/honeycomb/
import { defineHex, Grid, rectangle, Orientation } from 'honeycomb-grid';

// Define hex class with flat-top orientation
const HexTile = defineHex({
  dimensions: 40,                    // 40px circumradius
  orientation: Orientation.FLAT,     // Flat-top for D&D convention
  origin: 'topLeft',                 // Simplifies PixiJS rendering
});

// Create a rectangular grid
const grid = new Grid(HexTile, rectangle({ width: 15, height: 15 }));

// Access hex data
grid.forEach((hex) => {
  console.log(hex.q, hex.r);        // Axial coordinates
  console.log(hex.corners);         // Array of {x, y} corner points
  // hex.corners gives the 6 vertex positions for rendering
});
```

### Pattern 4: Viewport Culling by Hex Coordinates

**What:** Instead of relying on PixiJS built-in culling (which traverses the scene graph), calculate which hex coordinates are visible based on the viewport bounds and only create/show Sprites for those hexes.

**When to use:** When the grid is larger than the viewport (always, once grid sizes exceed ~100 hexes).

**Why:** Application-level culling is O(1) per hex coordinate check vs O(n) scene graph traversal. For hex grids, you can compute the visible range of q,r coordinates from the viewport bounds using honeycomb-grid's `pointToCube()`.

**Example:**

```typescript
// Source: Red Blob Games hex guide + honeycomb-grid API
import { pointToCube } from 'honeycomb-grid';

function getVisibleHexRange(viewport: Viewport, hexSettings: any) {
  // Get viewport bounds in world coordinates
  const topLeft = { x: viewport.left, y: viewport.top };
  const bottomRight = { x: viewport.right, y: viewport.bottom };

  // Convert viewport corners to hex coordinates
  const tlHex = pointToCube(hexSettings, topLeft);
  const brHex = pointToCube(hexSettings, bottomRight);

  // Return range of q,r coordinates to render (with padding)
  return {
    minQ: Math.floor(tlHex.q) - 1,
    maxQ: Math.ceil(brHex.q) + 1,
    minR: Math.floor(tlHex.r) - 1,
    maxR: Math.ceil(brHex.r) + 1,
  };
}
```

### Pattern 5: Zustand Store for Map State

**What:** Use Zustand to manage all map state: hex terrain data, selected hexes, hover state, zoom level. The PixiJS layer reads from the store; React UI reads from the store; both update it.

**When to use:** Always for state that spans both the canvas and React UI.

**Example:**

```typescript
// Source: Zustand 5.x docs
import { create } from 'zustand';

interface HexData {
  q: number;
  r: number;
  terrain: string;
}

interface MapStore {
  hexes: Map<string, HexData>;        // key: "q,r"
  selectedHexes: Set<string>;
  hoveredHex: string | null;
  gridWidth: number;
  gridHeight: number;
  setTerrain: (key: string, terrain: string) => void;
  selectHex: (key: string) => void;
  toggleSelectHex: (key: string) => void;   // For shift-click
  clearSelection: () => void;
  setHoveredHex: (key: string | null) => void;
}

const useMapStore = create<MapStore>((set) => ({
  hexes: new Map(),
  selectedHexes: new Set(),
  hoveredHex: null,
  gridWidth: 15,
  gridHeight: 15,
  setTerrain: (key, terrain) =>
    set((state) => {
      const hexes = new Map(state.hexes);
      const hex = hexes.get(key);
      if (hex) hexes.set(key, { ...hex, terrain });
      return { hexes };
    }),
  selectHex: (key) => set({ selectedHexes: new Set([key]) }),
  toggleSelectHex: (key) =>
    set((state) => {
      const selected = new Set(state.selectedHexes);
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      return { selectedHexes: selected };
    }),
  clearSelection: () => set({ selectedHexes: new Set() }),
  setHoveredHex: (key) => set({ hoveredHex: key }),
}));
```

### Pattern 6: @pixi/react Application Setup with extend()

**What:** Use the `extend()` API to register only the PixiJS components you need, then use JSX to compose the scene graph.

**When to use:** Always when using @pixi/react v8.

**Example:**

```typescript
// Source: @pixi/react v8 docs - https://react.pixijs.io/
import { Application, extend, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';

// Register components for JSX use
extend({ Container, Sprite, Graphics, Text });

function HexMapCanvas() {
  return (
    <Application
      resizeTo={window}
      background={0x1a1a2e}
      antialias
    >
      <HexMapContent />
    </Application>
  );
}

function HexMapContent() {
  const { app } = useApplication();  // Access PIXI.Application
  // app.renderer.events needed for pixi-viewport
  return (
    <pixiContainer>
      {/* Viewport and layers go here */}
    </pixiContainer>
  );
}
```

### Pattern 7: pixi-viewport Integration

**What:** Use pixi-viewport as a custom component in @pixi/react for pan/zoom/drag behavior.

**When to use:** Always for the map viewport.

**Example:**

```typescript
// Source: pixi-viewport docs + @pixi/react custom component pattern
import { Viewport } from 'pixi-viewport';
import { extend, useApplication } from '@pixi/react';

// Register Viewport as a custom component
extend({ Viewport });

function MapViewport({ children }: { children: React.ReactNode }) {
  const { app } = useApplication();

  return (
    <viewport
      screenWidth={app.screen.width}
      screenHeight={app.screen.height}
      worldWidth={2000}
      worldHeight={2000}
      events={app.renderer.events}  // REQUIRED for pixi-viewport v6
      ref={(viewport: Viewport | null) => {
        if (viewport) {
          viewport.drag().pinch().wheel().decelerate()
            .clampZoom({ minScale: 0.25, maxScale: 4 });
        }
      }}
    >
      {children}
    </viewport>
  );
}
```

### Anti-Patterns to Avoid

- **Drawing hex polygons with Graphics every frame:** Use Sprites with pre-rendered textures. Graphics.drawPolygon requires triangulation and breaks sprite batching. Only use Graphics for dynamic overlays (hover highlight, selection border).
- **Storing hex state in PixiJS objects:** Store all game state in Zustand. PixiJS objects are rendering targets, not data stores. This makes serialization (import/export), state synchronization (future phases), and debugging trivial.
- **Using offset coordinates internally:** Always use axial/cube coordinates (q, r) for internal math. Offset coordinates break vector operations (add, subtract, distance). Only use offset for human-readable display if needed.
- **Re-creating the Grid object on every render:** Create the honeycomb-grid Grid once and store it. It's a stateful object with a backing store of hex instances.
- **Using PixiJS built-in culling for hex grids:** PixiJS culling traverses the scene graph (O(n)). For hex grids, compute visible hex range from viewport bounds using coordinate math (O(1) per check). This is dramatically faster for large grids.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hex coordinate math | Custom axial/cube conversion functions | honeycomb-grid's `defineHex`, `pointToCube`, `hexToPoint`, `toCube` | Hex math has subtle edge cases (rounding fractional hex coordinates, offset alignment). honeycomb-grid handles all of them correctly based on Red Blob Games algorithms. |
| Pan/zoom/drag viewport | Custom mouse event handlers on Container transforms | pixi-viewport v6.0.3 | pixi-viewport handles inertial scrolling, pinch-to-zoom, zoom clamping, bounce-back, deceleration. Hand-rolling this takes hundreds of lines and misses edge cases on touch devices. |
| Hex-to-pixel / pixel-to-hex conversion | Manual formulas from Red Blob Games | honeycomb-grid's `hexToPoint()` and `pointToCube()` | The formulas differ between flat-top and pointy-top, and between different origin settings. honeycomb-grid abstracts this correctly. |
| Hex neighbor finding | Direction offset arrays | honeycomb-grid traversers (`ring`, `line`, `spiral`) | Direction offsets differ for flat-top vs pointy-top and for odd vs even rows in offset coords. Traversers handle all variants. |
| Texture atlas loading | Manual image loading and UV mapping | PixiJS Assets API + spritesheet JSON | PixiJS Assets handles caching, resolution scaling, format fallbacks. Spritesheet JSON (from tools like TexturePacker or manual) defines sub-textures automatically. |
| React-PixiJS integration | useRef + useEffect to mount PIXI.Application | @pixi/react's `<Application>` component | @pixi/react handles initialization, cleanup, React 19 reconciliation, and provides hooks (useApplication, useTick, useAssets). |

**Key insight:** The hex grid domain has well-solved problems. Every piece of math is documented by Red Blob Games and implemented by honeycomb-grid. Every rendering optimization is handled by PixiJS's batching and sprite system. Every viewport interaction is solved by pixi-viewport. The planning should focus on composing these libraries correctly, not on implementing algorithms.

## Common Pitfalls

### Pitfall 1: Using Graphics Instead of Sprites for Hex Tiles

**What goes wrong:** Drawing 500+ hex polygons with PixiJS Graphics causes frame drops below 30 FPS. Adding stroke (border) to Graphics dramatically increases geometry, making performance worse.
**Why it happens:** Graphics.drawPolygon requires earcut triangulation per shape. Each Graphics object with different fill colors breaks GPU batching. Stroke geometry roughly doubles the vertex count.
**How to avoid:** Pre-render hex terrain as PNG textures (one per terrain type variant). Load as a spritesheet/texture atlas. Render each hex as a Sprite. Sprites batch efficiently -- PixiJS can batch up to 16 textures per draw call.
**Warning signs:** Frame rate drops when scrolling over dense areas. GPU profiler shows high draw call count.

### Pitfall 2: PixiJS v8 Async Initialization

**What goes wrong:** Passing options directly to `new Application()` constructor -- v8 requires async `init()`.
**Why it happens:** PixiJS v8 uses WebGPU which has an async initialization API. The constructor no longer accepts options.
**How to avoid:** Use `@pixi/react`'s `<Application>` component, which handles async init internally. If using PixiJS directly: `const app = new Application(); await app.init({ ... });`
**Warning signs:** Application fails to render, no error in console (silent failure), or "Application not initialized" errors.

### Pitfall 3: Missing `events` Parameter in pixi-viewport v6

**What goes wrong:** Viewport does not respond to mouse/touch events.
**Why it happens:** pixi-viewport v6 removed the `interaction` option (from PixiJS v7) and requires `events: app.renderer.events` instead.
**How to avoid:** Always pass `events={app.renderer.events}` when creating the Viewport. Access `app` via `useApplication()` hook.
**Warning signs:** Drag, zoom, and click events silently fail. No errors in console.

### Pitfall 4: Wrong Hex Origin for Rendering

**What goes wrong:** Hexes render at wrong positions -- offset by half a hex width/height.
**Why it happens:** honeycomb-grid defaults to origin at hex center `{x: 0, y: 0}`. When rendering with PixiJS Sprites (which default to top-left anchor), the positions are off by the hex's half-width/half-height.
**How to avoid:** Either set `origin: 'topLeft'` in `defineHex()` (convenient if treating hexes like DOM elements), OR set Sprite `anchor.set(0.5)` to center the sprite on the hex center point. Choose one approach consistently.
**Warning signs:** Hexes appear shifted from their expected positions. Grid lines don't align with terrain tiles.

### Pitfall 5: Honeycomb-grid Stateless vs Stateful Grid

**What goes wrong:** `grid.getHex()` returns undefined because the grid was created without a traverser (stateless).
**Why it happens:** `new Grid(HexClass)` creates a stateless grid with no stored hexes. You need `new Grid(HexClass, rectangle({ width, height }))` to create a stateful grid with hexes in its store.
**How to avoid:** Always pass a traverser as the second argument to populate the grid store. Use `rectangle()` for standard rectangular grids.
**Warning signs:** `grid.getHex({q, r})` returns undefined. `grid.forEach()` never executes.

### Pitfall 6: Zustand Re-renders on Map/Set Mutations

**What goes wrong:** Modifying a Map or Set in Zustand without creating a new reference does not trigger re-renders.
**Why it happens:** Zustand uses reference equality by default. `map.set(key, value)` mutates in place -- same reference, no re-render.
**How to avoid:** Always create new Map/Set instances in state updates: `set({ hexes: new Map(state.hexes) })`. Use `useShallow` selector for components that only need a subset of state.
**Warning signs:** State updates happen in devtools but UI/canvas does not reflect changes.

### Pitfall 7: Forgetting to Destroy PixiJS Resources

**What goes wrong:** Memory leaks when navigating away from the map view or recreating the grid.
**Why it happens:** PixiJS textures and containers are not garbage collected automatically. They must be explicitly destroyed.
**How to avoid:** @pixi/react handles cleanup of components in the scene graph. For manually created resources, call `texture.destroy()` and `container.destroy({ children: true })` in cleanup effects.
**Warning signs:** Memory usage grows over time. Browser tab becomes sluggish after navigating between views.

### Pitfall 8: useTick Callback Not Memoized

**What goes wrong:** Tick callback is removed and re-added every frame, causing performance issues or missed frames.
**Why it happens:** @pixi/react's `useTick` does not memoize the callback. If the component re-renders (e.g., from state changes), a new function reference is created.
**How to avoid:** Wrap the tick callback in `useCallback` with appropriate dependencies.
**Warning signs:** Animations stutter or skip frames. Performance degrades when state updates frequently.

## Code Examples

### Defining a Flat-Top Hex Grid with Honeycomb-Grid

```typescript
// Source: honeycomb-grid docs - https://abbekeultjes.nl/honeycomb/guide/custom-hexes.html
import { defineHex, Grid, rectangle, Orientation } from 'honeycomb-grid';

// Flat-top hex, 40px radius, with terrain data
class GameHex extends defineHex({
  dimensions: 40,
  orientation: Orientation.FLAT,
  origin: 'topLeft',
  offset: -1,
}) {
  terrain: string = 'grassland';
  terrainVariant: number = 0;
}

// Create a 15x15 rectangular grid
const grid = new Grid(GameHex, rectangle({ width: 15, height: 15 }));

// Access hex by coordinates
const hex = grid.getHex({ q: 3, r: 5 });
if (hex) {
  console.log(hex.q, hex.r, hex.s);         // Axial + derived cube
  console.log(hex.corners);                   // 6 corner points [{x,y}...]
  console.log(hex.col, hex.row);              // Offset coordinates (read-only)
}
```

### Pixel-to-Hex Conversion (for mouse hover)

```typescript
// Source: honeycomb-grid docs - https://abbekeultjes.nl/honeycomb/api/
import { pointToCube } from 'honeycomb-grid';

function getHexAtScreenPoint(
  worldX: number,
  worldY: number,
  hexSettings: typeof GameHex.settings
): { q: number; r: number } | null {
  const cubeCoords = pointToCube(hexSettings, { x: worldX, y: worldY });
  // pointToCube returns fractional coordinates -- round to nearest hex
  const q = Math.round(cubeCoords.q);
  const r = Math.round(cubeCoords.r);
  return { q, r };
}
```

### Loading Terrain Textures with PixiJS Assets

```typescript
// Source: PixiJS 8 docs - https://pixijs.com/8.x/guides/components/assets
import { Assets, Texture } from 'pixi.js';

// Initialize asset system with base path
await Assets.init({ basePath: '/assets/textures/' });

// Load spritesheet (JSON + PNG atlas)
const sheet = await Assets.load('terrain-atlas.json');

// Access individual terrain textures from the atlas
const grassTexture1 = sheet.textures['grassland_01.png'];
const grassTexture2 = sheet.textures['grassland_02.png'];
const forestTexture1 = sheet.textures['forest_01.png'];
// ... etc for all terrain variants

// Create sprite with terrain texture
const hexSprite = new Sprite(grassTexture1);
hexSprite.anchor.set(0.5);
hexSprite.position.set(hex.x, hex.y);  // hex from honeycomb-grid with topLeft origin
```

### Terrain Atlas JSON Format (Manual Spritesheet)

```json
{
  "frames": {
    "grassland_01.png": {
      "frame": { "x": 0, "y": 0, "w": 80, "h": 70 },
      "sourceSize": { "w": 80, "h": 70 }
    },
    "grassland_02.png": {
      "frame": { "x": 80, "y": 0, "w": 80, "h": 70 },
      "sourceSize": { "w": 80, "h": 70 }
    },
    "forest_01.png": {
      "frame": { "x": 160, "y": 0, "w": 80, "h": 70 },
      "sourceSize": { "w": 80, "h": 70 }
    }
  },
  "meta": {
    "image": "terrain-atlas.png",
    "format": "RGBA8888",
    "size": { "w": 512, "h": 512 },
    "scale": "1"
  }
}
```

### Vite + Tailwind CSS 4 Configuration

```typescript
// vite.config.ts
// Source: Tailwind CSS v4 docs - https://tailwindcss.com/docs/installation/using-vite
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
});
```

```css
/* src/styles/index.css */
/* Source: Tailwind CSS v4 docs */
@import "tailwindcss";
```

### pnpm Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

```json
// Root package.json
{
  "name": "hex-crawl",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter client dev",
    "build": "pnpm --filter client build",
    "dev:all": "pnpm --parallel --filter './packages/*' dev"
  }
}
```

```json
// packages/client/package.json (partial)
{
  "name": "@hex-crawl/client",
  "dependencies": {
    "@hex-crawl/shared": "workspace:*"
  }
}
```

```json
// packages/shared/package.json (partial)
{
  "name": "@hex-crawl/shared",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

### GraphicsContext Sharing for Hex Highlights

```typescript
// Source: PixiJS 8 docs - GraphicsContext
// Use shared GraphicsContext for hover/selection highlights (drawn dynamically)
import { Graphics, GraphicsContext } from 'pixi.js';

// Create a reusable hex outline context
function createHexHighlightContext(corners: { x: number; y: number }[], color: number) {
  const ctx = new GraphicsContext();
  ctx.poly(corners.map(c => [c.x, c.y]).flat());
  ctx.fill({ color, alpha: 0.3 });
  ctx.stroke({ color, width: 3, alpha: 0.8 });
  return ctx;
}

// Reuse context across multiple highlight Graphics objects
const hoverCtx = createHexHighlightContext(hexCorners, 0xffff00);
const hoverGraphic = new Graphics(hoverCtx);
```

### Simple Terrain Generation with Clustering

```typescript
// Clustering algorithm for terrain generation (Claude's discretion area)
// Approach: seed-and-grow -- place terrain seeds, then expand regions

type TerrainType = 'forest' | 'desert' | 'grassland' | 'mountain' |
  'water' | 'swamp' | 'arctic' | 'coast' | 'underdark' | 'urban';

function generateTerrain(grid: Grid<GameHex>): Map<string, TerrainType> {
  const terrainMap = new Map<string, TerrainType>();
  const allHexes = [...grid];
  const terrainTypes: TerrainType[] = [
    'forest', 'desert', 'grassland', 'mountain', 'water', 'swamp',
  ];

  // Phase 1: Assign random seeds (~15% of hexes)
  const seeds: { hex: GameHex; terrain: TerrainType }[] = [];
  for (const hex of allHexes) {
    if (Math.random() < 0.15) {
      const terrain = terrainTypes[Math.floor(Math.random() * terrainTypes.length)];
      terrainMap.set(`${hex.q},${hex.r}`, terrain);
      seeds.push({ hex, terrain });
    }
  }

  // Phase 2: Grow regions from seeds using BFS
  // Each seed expands to adjacent unassigned hexes with decreasing probability
  // Water seeds also assign 'coast' to adjacent land hexes

  // Phase 3: Fill remaining hexes with nearest seed's terrain
  for (const hex of allHexes) {
    const key = `${hex.q},${hex.r}`;
    if (!terrainMap.has(key)) {
      terrainMap.set(key, 'grassland'); // Default fallback
    }
  }

  return terrainMap;
}
```

### JSON Import/Export Format

```typescript
// Source: Claude's discretion (JSON preferred over YAML -- no extra dependency)
import { z } from 'zod';

// Use JSON for import/export (no YAML dependency needed, JSON is native)
const HexDataSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  terrain: z.string(),
  terrainVariant: z.number().int().optional(),
});

const MapExportSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  gridWidth: z.number().int().positive(),
  gridHeight: z.number().int().positive(),
  hexSize: z.number().positive(),
  orientation: z.enum(['flat', 'pointy']),
  hexes: z.array(HexDataSchema),
});

type MapExport = z.infer<typeof MapExportSchema>;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PixiJS `new Application(options)` constructor | `new Application()` + `await app.init(options)` async | PixiJS v8 (2024) | Must use async init. @pixi/react handles this. |
| `@pixi/react` wrapper components (Stage, etc.) | JSX proxies via `extend()` API with `pixi` prefix | @pixi/react v8 (2025) | Complete rewrite. Old tutorials are invalid. Use `<pixiContainer>`, `<pixiSprite>`, etc. |
| `options.interaction` in pixi-viewport | `options.events` from `app.renderer.events` | pixi-viewport v5+ (2024) | Old code silently breaks. Must pass events. |
| Tailwind CSS `tailwind.config.js` + PostCSS | `@import "tailwindcss"` + `@tailwindcss/vite` plugin | Tailwind CSS v4 (2025) | No config file needed. No PostCSS config. Automatic content detection. |
| PixiJS `CacheAsBitmap` | `container.cacheAsTexture()` | PixiJS v8 | Old API renamed. Use `cacheAsTexture()` for static content optimization. |
| Zustand v4 vanilla stores | Zustand v5 with `useSyncExternalStore` | Zustand v5 (2025) | Better React 19 concurrent mode support. Same API surface for basic usage. |

**Deprecated/outdated:**
- PixiJS v7 constructor-based Application init: Use async `init()` in v8
- @pixi/react v7 `<Stage>` component: Replaced by `<Application>` in v8
- pixi-viewport `options.interaction`: Use `options.events` in v6
- Tailwind CSS v3 `tailwind.config.js`: Use CSS-first config in v4
- honeycomb-grid v3 `createHexPrototype`: Use `defineHex` in v4

## Discretion Recommendations

These are areas marked as "Claude's Discretion" in the CONTEXT.md:

### Flat-Top vs Pointy-Top Hex Orientation

**Recommendation: Flat-top (`Orientation.FLAT`)**

Flat-top hexes are the longstanding D&D hex crawl convention, used in classic products like the Known World/Mystara maps, most OSR hex crawl products, and hex mapping tools like Hexographer. The D&D 5e DMG shows flat-top hexes. Pointy-top is more common in wargaming. For a D&D hex crawl tool, flat-top matches user expectations.

Flat-top hex geometry (for reference):
- Horizontal spacing: `3/2 * size`
- Vertical spacing: `sqrt(3) * size`
- Hex width: `2 * size`
- Hex height: `sqrt(3) * size`

### Hover Highlight Style

**Recommendation: Semi-transparent yellow overlay (0xffff00, alpha 0.3) with thick border (3px, alpha 0.8)**

A color overlay is more visible than a border alone, especially over dark terrain textures. Yellow provides strong contrast against all terrain colors (green forest, brown desert, blue water, white arctic). The semi-transparency lets the terrain texture show through.

### Side Panel Layout

**Recommendation: Right-side panel, 300px wide, persistent (always visible)**

Right-side placement is conventional for info/inspector panels (VS Code, Figma, Unity). 300px is wide enough for coordinate display, terrain info, and terrain palette without overwhelming the map canvas. Panel should be collapsible for full-screen map view.

### Zoom Level Bounds

**Recommendation: minScale 0.25, maxScale 4.0**

At 0.25x (25%), a 15x15 hex grid fits entirely on screen with room to spare -- useful for overview. At 4.0x (400%), individual hex textures are clearly visible for detail work. These bounds prevent both "lost in zoom" and "too zoomed out to see anything."

### Clustering Algorithm for Terrain Generation

**Recommendation: Seed-and-grow BFS with adjacency rules**

Place random terrain seeds on ~15% of hexes, then expand each seed's region via breadth-first search with decreasing probability. Adjacency rules: water always gets coast neighbors, mountains neighbor hills/forest, deserts neighbor grassland. This produces natural-looking multi-hex regions without the complexity of noise-based generation (which is deferred).

### Import/Export Format

**Recommendation: JSON (not YAML)**

JSON is natively supported in browsers (`JSON.parse`, `JSON.stringify`) with no additional dependencies. YAML would require a parser library (js-yaml, ~40KB). JSON is also the standard format for web APIs. The export schema should include a version field for future format evolution.

### Placeholder Texture Art Style

**Recommendation: Simple flat-color hexagons with subtle noise/pattern**

For the first pass, create hex-shaped PNG images (matching the hex bounding box dimensions) with flat terrain colors plus a subtle noise overlay for visual variety. Each terrain type gets 2-3 variants with slightly different noise patterns. Colors: forest=#2d5a27, desert=#c4a35a, grassland=#7ec850, mountain=#8b7355, water=#3b7dd8, swamp=#4a6741, arctic=#e8f0f2, coast=#d4bc65, underdark=#2a1a3e, urban=#8a8a8a. These can be generated programmatically during the build or as simple PNGs.

## Open Questions

1. **pixi-viewport as @pixi/react custom component**
   - What we know: @pixi/react supports custom components via `extend()`. pixi-viewport exports a `Viewport` class that extends PixiJS Container.
   - What's unclear: Whether extending Viewport into @pixi/react JSX works seamlessly, or if imperative setup is needed. The @pixi/react docs show custom components but not specifically pixi-viewport.
   - Recommendation: Start with `extend({ Viewport })` and `<viewport>` JSX. If it doesn't work cleanly, fall back to imperative creation with `useEffect` + `useApplication()`. Both approaches are valid; the declarative one is preferred.

2. **honeycomb-grid pointToCube rounding**
   - What we know: `pointToCube()` returns fractional cube coordinates. You need to round to the nearest valid hex.
   - What's unclear: Whether honeycomb-grid has a built-in rounding function or if we must implement cube coordinate rounding manually (round each component, then fix the one with the largest rounding error to satisfy q+r+s=0).
   - Recommendation: Check the honeycomb-grid API for a `round` or `nearest` function. If not available, implement cube rounding per the Red Blob Games algorithm (6 lines of code).

3. **Texture atlas generation workflow**
   - What we know: PixiJS loads spritesheets from JSON + PNG. Tools like TexturePacker generate these. For placeholder textures, we could generate them programmatically.
   - What's unclear: Whether to use a build-time tool (TexturePacker, free-tex-packer) or generate placeholder textures at runtime with Canvas 2D and convert to PixiJS textures.
   - Recommendation: For Phase 1 placeholders, generate hex textures at runtime using an offscreen Canvas 2D. This avoids external tool dependencies. Package them into a PixiJS spritesheet programmatically. Replace with proper assets later.

4. **Custom terrain type upload (DM feature)**
   - What we know: CONTEXT.md mentions DMs can create custom terrain types and upload icons. This is also partially deferred.
   - What's unclear: Whether this belongs fully in Phase 1 or later.
   - Recommendation: Build the terrain system to support arbitrary terrain type strings (not a fixed enum). Add the upload UI later. The data model should support it from the start even if the UI is Phase 1-minimal (built-in types only with a "custom" option that accepts a name).

## Sources

### Primary (HIGH confidence)
- PixiJS 8 official docs: [Getting Started](https://pixijs.com/guides/basics/getting-started), [Container](https://pixijs.com/8.x/guides/components/scene-objects/container), [Graphics](https://pixijs.com/8.x/guides/components/scene-objects/graphics), [Sprite](https://pixijs.com/8.x/guides/components/scene-objects/sprite), [Assets](https://pixijs.com/8.x/guides/components/assets), [Performance Tips](https://pixijs.com/8.x/guides/concepts/performance-tips)
- @pixi/react v8 docs: [Getting Started](https://react.pixijs.io/getting-started/), [Application](https://react.pixijs.io/components/application), [Hooks](https://react.pixijs.io/hooks/useTick/)
- honeycomb-grid docs: [Getting Started](https://abbekeultjes.nl/honeycomb/guide/getting-started.html), [Custom Hexes](https://abbekeultjes.nl/honeycomb/guide/custom-hexes.html), [Coordinate System](https://abbekeultjes.nl/honeycomb/guide/coordinate-system.html), [Rendering](https://abbekeultjes.nl/honeycomb/guide/rendering.html), [API Reference](https://abbekeultjes.nl/honeycomb/api/)
- pixi-viewport GitHub: [pixijs-userland/pixi-viewport](https://github.com/pixijs-userland/pixi-viewport) - v6.0.3, PixiJS v8 compatibility
- Red Blob Games: [Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/) - definitive hex math reference
- Tailwind CSS v4: [Installation with Vite](https://tailwindcss.com/docs/installation/using-vite)
- Zustand docs: [zustand.docs.pmnd.rs](https://zustand.docs.pmnd.rs/)

### Secondary (MEDIUM confidence)
- [PixiJS React v8 announcement blog](https://pixijs.com/blog/pixi-react-v8-live) - architecture decisions, extend API rationale
- [PixiJS v8 culling deep dive](https://www.richardfu.net/optimizing-rendering-with-pixijs-v8-a-deep-dive-into-the-new-culling-api/) - culling API changes, performance patterns
- [PixiJS performance discussion #10521](https://github.com/pixijs/pixijs/discussions/10521) - large numbers of Graphics objects, optimization strategies
- [PixiJS camera/viewport discussion #10371](https://github.com/pixijs/pixijs/discussions/10371) - render groups as viewport alternative
- [pnpm workspace docs](https://pnpm.io/workspaces) - workspace protocol, configuration

### Tertiary (LOW confidence)
- [HexPixiJs library](https://github.com/DavidBM/HexPixiJs) - hex grid PixiJS example (alpha, not actively maintained, but useful reference)
- [pixi-hexgrid](https://github.com/kcappieg/pixi-hexgrid) - hex grid PixiJS extension (reference only)
- Flat-top hex convention: multiple RPG forum discussions on Roll20, ENWorld, RPGPub -- consensus but no single authoritative source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All library versions verified via npm registry and official docs on 2026-01-26. PixiJS 8.15.0, @pixi/react 8.0.5, honeycomb-grid 4.1.5, pixi-viewport 6.0.3, Zustand 5.0.10, Vite 7.3.1.
- Architecture: HIGH - Layered container pattern is standard PixiJS practice documented in official guides. @pixi/react extend API verified in official docs. Sprite-based rendering is standard PixiJS performance guidance.
- Pitfalls: HIGH - All pitfalls verified against official documentation (PixiJS v8 async init, pixi-viewport events parameter, honeycomb-grid stateful vs stateless grid).
- Hex math: HIGH - honeycomb-grid implements Red Blob Games algorithms. Coordinate system documented thoroughly. Flat-top orientation confirmed as D&D convention.
- Discretion areas: MEDIUM - Recommendations based on domain knowledge (D&D conventions), multiple sources (RPG forums), and standard UX patterns. No single authoritative source for some decisions (hover style, zoom bounds).

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - all libraries are stable releases, no expected breaking changes)
