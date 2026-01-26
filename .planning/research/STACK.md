# Stack Research

**Domain:** Real-time collaborative hex crawl web application (canvas-based map rendering, WebSocket multiplayer, image handling, fog of war)
**Researched:** 2026-01-26
**Confidence:** HIGH (all core technologies verified via npm registry + official docs + multiple community sources)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **React** | 19.2.3 | UI framework | Industry standard. PixiJS React v8 is built exclusively for React 19. Largest ecosystem of libraries, hiring pool, and community support. The canvas rendering layer (PixiJS) has first-class React bindings. | HIGH |
| **TypeScript** | 5.9.3 | Type safety | Non-negotiable for a project with real-time state sync, WebSocket message contracts, and canvas rendering. Catches entire categories of bugs at compile time (wrong message types, missing hex coordinates, invalid state transitions). | HIGH |
| **Vite** | 7.3.1 | Build tool / dev server | SPA-first architecture is correct for a real-time game app: no SSR needed, no SEO required, canvas content is not indexable. Vite 7 offers sub-second HMR, ESM-only distribution, and the upcoming Vite 8 will use Rolldown for even faster builds. Next.js would add SSR complexity that actively harms this use case (adds latency, irrelevant for authenticated canvas app). | HIGH |
| **Hono** | 4.11.5 | Backend HTTP + WebSocket framework | Built-in WebSocket support without additional packages. TypeScript-first with real type inference (route params, context variables auto-typed). 14KB minified with zero dependencies vs Express's 500KB+. 4x faster request throughput than Express in benchmarks. Runs on Node.js, Bun, Deno, and edge runtimes with zero code changes. Includes built-in CORS, JWT, logger middleware. For a greenfield TypeScript project, there is no reason to start with Express in 2026. | HIGH |
| **PostgreSQL** | 16+ | Primary database | Concurrent multi-user writes are a hard requirement for real-time multiplayer. SQLite's single-writer constraint is a dealbreaker. PostgreSQL handles thousands of concurrent connections, supports JSONB for flexible hex metadata, array types for fog-of-war state, and has PostGIS if geo features are ever needed. | HIGH |
| **Drizzle ORM** | 0.45.1 | Database ORM | SQL-transparent: generates queries that map 1:1 to SQL, critical for debugging real-time state issues. Zero binary dependencies (7KB minified+gzipped) vs Prisma's heavier footprint. Schema defined in TypeScript files (no separate DSL). Excellent support for PostgreSQL, Neon, Supabase. For a performance-sensitive real-time app, Drizzle's lower overhead and SQL transparency win over Prisma's DX conveniences. | HIGH |
| **PixiJS** | 8.15.0 | Canvas/WebGL rendering engine | WebGL-accelerated 2D rendering with WebGPU fallback. Benchmarks show 60 FPS with 8,000+ animated sprites in Chrome (Konva: 23 FPS, raw Canvas: 19 FPS). PixiJS v8 is a generational rewrite: single-package architecture, 3x CPU improvement for moving sprites, 175x improvement for static sprites. Hex maps with fog of war, tokens, overlays, and zoom levels demand this level of rendering performance. Has dedicated React bindings (`@pixi/react` v8). | HIGH |
| **Socket.IO** | 4.8.3 | Real-time WebSocket communication | Built-in rooms (perfect for campaign sessions: DM + players in one room), automatic reconnection with exponential backoff, namespace support for separating concerns (map updates vs chat vs tokens). The raw `ws` library is faster for latency-critical FPS games, but a hex crawl is turn-based/DM-driven where Socket.IO's room management and reliability features matter more than microsecond latency. The event-based API (`emit('hexRevealed', data)`) maps naturally to game events. | HIGH |
| **Better Auth** | 1.4.17 | Authentication | The Auth.js (NextAuth) team joined Better Auth in September 2025; Auth.js is now in maintenance mode. Better Auth is TypeScript-first, framework-agnostic (works with Hono, Express, anything), plugin-based architecture (add MFA, multi-tenancy later), and has built-in email/password auth (Auth.js intentionally discourages passwords). For an invite-based campaign system, Better Auth's flexibility is ideal. | HIGH |

### Rendering & Game Libraries

| Library | Version | Purpose | Why Recommended | Confidence |
|---------|---------|---------|-----------------|------------|
| **@pixi/react** | 8.0.5 | React-PixiJS bridge | Built from scratch for PixiJS v8 + React 19. Uses JSX proxies (inspired by @react-three/fiber) instead of wrapper components. Tree-shakeable via `extend()` API. Allows mixing React UI and PixiJS canvas rendering seamlessly. | HIGH |
| **honeycomb-grid** | 4.1.5 | Hex grid math | Renderer-agnostic hex grid library in TypeScript. Based on Red Blob Games' definitive hex grid reference. Handles all hex math (cube/axial/offset coordinates, neighbor finding, distance, line drawing, rings, spirals, pathfinding support). Zero dependencies. Has documented examples rendering 10,000 hexes with PixiJS. Last published ~2 years ago, but the math is stable and the API is complete; hex coordinate systems don't change. | MEDIUM |

### State Management

| Library | Version | Purpose | Why Recommended | Confidence |
|---------|---------|---------|-----------------|------------|
| **Zustand** | 5.0.10 | Global client state | 3KB bundle. Centralized store pattern is correct for global game state (current campaign, user session, connection status, UI state like selected tools). Built-in devtools middleware, persistence middleware, immer middleware. Simpler mental model than Jotai for state that is interconnected (game config affects rendering affects UI). | HIGH |
| **TanStack Query** | 5.90.20 | Server state / cache | Handles all REST data fetching with caching, background refetching, optimistic updates. Integrates with WebSocket via `queryClient.setQueryData()` for real-time cache invalidation. Manages loading/error states. Separates "server state" (campaigns, user data, saved maps) from "client state" (Zustand). | HIGH |

### Image Processing & Storage

| Library | Version | Purpose | Why Recommended | Confidence |
|---------|---------|---------|-----------------|------------|
| **sharp** | 0.34.5 | Server-side image processing | 4-5x faster than ImageMagick for resizing. Handles JPEG, PNG, WebP, AVIF. Essential for: generating map thumbnails at multiple zoom levels, optimizing uploaded map images, creating tile pyramids for large maps. Uses libvips (C library) for minimal memory usage even with very large images. | HIGH |
| **@aws-sdk/client-s3** | 3.975.0 | S3-compatible object storage client | Works with any S3-compatible storage: AWS S3 in production, MinIO for local dev, Cloudflare R2 for zero-egress CDN delivery. Map images can be large (10-50MB+); object storage is the correct pattern, not database BLOBs. | HIGH |
| **Zod** | 4.3.6 | Runtime validation | Validates WebSocket message payloads, API request bodies, file upload metadata, and environment variables at runtime. TypeScript types alone don't protect against malformed WebSocket messages from clients. Zod schemas can be shared between client and server in a monorepo. | HIGH |

### UI & Styling

| Library | Version | Purpose | Why Recommended | Confidence |
|---------|---------|---------|-----------------|------------|
| **Tailwind CSS** | 4.1.18 | Utility CSS framework | v4 rewrote the engine in Rust (5x faster full builds, 100x faster incremental). CSS-first config via `@theme` (no more `tailwind.config.js`). One-line setup: `@import "tailwindcss"`. Automatic content detection. For the non-canvas UI (campaign management, auth pages, settings, sidebar panels), Tailwind is the fastest path to polished UI. | HIGH |
| **React Router** | 7.13.0 | Client-side routing | Industry standard for React SPA routing. Handles campaign selection, map views, settings pages, auth flows. v7 is the latest stable with improved type safety. | HIGH |

### Development Tools

| Tool | Version | Purpose | Notes | Confidence |
|------|---------|---------|-------|------------|
| **Vitest** | 4.0.18 | Testing | Vite-native test runner. Same config as your app. Fast, parallel, with built-in coverage. | HIGH |
| **Biome** | latest | Linting + formatting | Single tool replaces ESLint + Prettier. 30-50x faster. Oxlint is an alternative (100x faster than ESLint) but Biome covers formatting too. | MEDIUM |
| **Docker** | latest | Containerization | Required for consistent dev/prod parity. Coolify deployment expects Docker containers. | HIGH |

### Infrastructure

| Technology | Purpose | Why Recommended | Confidence |
|------------|---------|-----------------|------------|
| **Coolify** (self-hosted PaaS) | Deployment & hosting | Open-source Heroku alternative. Runs on any VPS ($4-5/month). Git-push auto-deploy, built-in Traefik reverse proxy with automatic Let's Encrypt SSL, WebSocket support out of the box, real-time container logs and metrics. Perfect for "personal use first, public later" — no vendor lock-in, trivially migrateable. | HIGH |
| **MinIO** (local dev) | S3-compatible object storage | Run locally via Docker for development. Same S3 API as production storage. Free, open-source. | HIGH |
| **Cloudflare R2** (production) | Object storage with CDN | Zero egress fees. Global edge caching for map images. S3-compatible API (same `@aws-sdk/client-s3` code works). For a map tool serving large images to multiple connected players, zero egress is critical for cost control. | MEDIUM |

## Monorepo Structure

Use a **pnpm workspace monorepo** with shared types between client and server:

```
hex-crawl/
  packages/
    client/        # Vite + React + PixiJS SPA
    server/        # Hono + Socket.IO + Drizzle
    shared/        # Zod schemas, TypeScript types, hex math utilities
  docker-compose.yml
  pnpm-workspace.yaml
```

**Why pnpm:** Faster installs, strict dependency isolation, built-in workspace support. npm and yarn workspaces work but pnpm is the standard for TypeScript monorepos in 2025/2026.

**Why monorepo:** WebSocket message schemas (Zod), hex coordinate types, and game event types MUST be shared between client and server. A monorepo makes this trivial with workspace imports.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative Instead |
|-------------|-------------|-------------------------------|
| **Vite** | Next.js | If the app later needs public-facing SEO pages (marketing site, public campaign galleries). In that case, add a separate Next.js marketing site; keep the app as a Vite SPA. |
| **Hono** | Express | If you need a specific Express middleware with no Hono equivalent (rare in 2026, but possible for niche integrations). |
| **Hono** | Fastify | If you need the most mature plugin ecosystem on Node.js specifically. Fastify is excellent but Hono's multi-runtime support and smaller size win for greenfield. |
| **PixiJS** | Konva | If the app were primarily a drag-and-drop diagram editor with few animated elements. Konva's declarative API and built-in event system are easier for UI-heavy, low-animation use cases. Not this project. |
| **PixiJS** | Raw Canvas 2D | If the hex grid were simple, static, and had <100 hexes. Raw Canvas avoids a dependency but requires reimplementing sprite batching, texture management, zoom/pan, and hit testing. |
| **Socket.IO** | Raw `ws` | If the game had frame-by-frame real-time requirements (60 FPS state sync, like a shooter). For a DM-driven hex crawl with event-based updates, Socket.IO's rooms and reliability features provide more value than `ws`'s raw speed. |
| **Socket.IO** | Liveblocks / PartyKit | If you want a managed real-time service and are willing to pay per-connection fees. Good for startups optimizing dev speed over infrastructure control. |
| **Drizzle ORM** | Prisma | If the team prefers Prisma's migration tooling and schema DSL, and the project doesn't have serverless/edge deployment requirements. Prisma's DX is excellent; Drizzle wins on performance and bundle size. |
| **Better Auth** | Clerk / Auth0 | If you want zero auth code and are willing to pay per-MAU. Good for rapid prototyping, but adds vendor dependency and monthly cost. |
| **Zustand** | Jotai | If individual hex tile state needs to update independently at high frequency (e.g., animated fog particles per-hex). Jotai's atomic model would minimize re-renders. Can be added alongside Zustand later if needed. |
| **PostgreSQL** | SQLite (via Turso) | Only if the app is single-user with no concurrent writes. SQLite's single-writer constraint is incompatible with real-time multiplayer. |
| **Coolify** | Railway / Render / Fly.io | If you want managed hosting without maintaining a VPS. Higher cost, less control, but zero ops overhead. Good "scale up" option if the app goes public. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Next.js** (for this app) | SSR adds latency to a real-time canvas app. SEO is irrelevant behind auth. App Router complexity is unnecessary for an SPA. File-based routing constrains game state management. | Vite + React Router |
| **Express** | Legacy API design from 2010. No built-in TypeScript support. No WebSocket support without `ws` or `socket.io` as separate packages. 500KB+ with no middleware included. Hono does everything Express does, faster, smaller, with better types. | Hono |
| **Konva** | 23 FPS on 8,000 sprites vs PixiJS's 60 FPS. Event handler overhead on many shapes causes noticeable lag. Canvas 2D only (no WebGL acceleration). For a hex map with hundreds of hexes, tokens, fog overlays, and zoom — Konva will bottleneck. | PixiJS |
| **Auth.js / NextAuth** | Development team joined Better Auth (September 2025). Now in maintenance mode (security patches only). Intentionally discourages email/password auth. Primarily designed for Next.js; clunky with other frameworks. | Better Auth |
| **Lucia Auth** | Deprecated as of March 2025. The author recommends it only as an educational resource. Do not use for new projects. | Better Auth |
| **Redux / Redux Toolkit** | Massive boilerplate for what Zustand does in 3KB. Reducers, action creators, slices, middleware setup — all unnecessary overhead for this project's scale. Community has largely moved on for new projects. | Zustand |
| **Prisma** (for this specific project) | Rust query engine adds cold start latency (though improved in 2026). Separate schema DSL adds a build step. Heavier bundle. Drizzle's SQL transparency is more valuable when debugging real-time state sync issues. | Drizzle ORM |
| **MongoDB** | Schema-less design invites data inconsistencies in a game with strict state (hex coordinates, fog state, campaign progression). PostgreSQL's JSONB gives document flexibility where needed while enforcing structure everywhere else. | PostgreSQL |
| **Firebase / Firestore** | Vendor lock-in. Real-time sync is Firebase's strength, but you lose control over the sync protocol, and costs scale unpredictably with concurrent connections. Building on Socket.IO + PostgreSQL gives equivalent functionality with full ownership. | Socket.IO + PostgreSQL |
| **Three.js** | 3D rendering engine. Hex crawl is 2D. Three.js would add massive complexity (cameras, materials, lighting) for zero benefit. PixiJS is purpose-built for 2D. | PixiJS |
| **Phaser** | Full game engine with physics, audio, scene management. Overkill for a map tool. Phaser would fight against React's rendering model. PixiJS + React gives you rendering without the game-engine opinions. | PixiJS + @pixi/react |
| **Canvas 2D API** (raw) | No sprite batching, no texture atlases, no WebGL acceleration, no built-in zoom/pan. You'd rebuild half of PixiJS manually. | PixiJS |
| **Tailwind CSS v3** | v4 is a complete rewrite: 5x faster builds, CSS-first config, automatic content detection. No reason to start a new project on v3 in 2026. | Tailwind CSS v4 |

## Stack Patterns by Variant

**If the app stays personal-use only:**
- Skip Cloudflare R2; use MinIO on the same VPS as the app
- Use SQLite for development speed, PostgreSQL for production
- Deploy everything on a single $5/month Hetzner VPS via Coolify

**If the app goes public:**
- Add Cloudflare R2 for image CDN (zero egress)
- Add Redis for WebSocket session affinity across multiple server instances
- Add a separate Coolify server for horizontal scaling
- Consider adding rate limiting middleware to Hono

**If map images exceed 50MB regularly:**
- Implement tile-pyramid generation with sharp (pre-render zoom levels as tile grids)
- Serve tiles from R2 with aggressive caching headers
- Load tiles on-demand in PixiJS based on viewport

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| @pixi/react 8.x | PixiJS 8.x + React 19.x | v8 is React 19 ONLY. Will NOT work with React 18. |
| Drizzle ORM 0.45.x | drizzle-kit (latest) | Always keep drizzle-orm and drizzle-kit versions in sync. |
| Tailwind CSS 4.x | Vite 6+ via @tailwindcss/vite | Use the official Vite plugin, not PostCSS, for best performance. |
| Socket.IO 4.x | socket.io-client 4.x | Server and client major versions must match. |
| Better Auth 1.x | Hono, Express, any framework | Framework-agnostic. Has official Hono adapter. |
| Vite 7.x | Node.js 20.19+ or 22.12+ | Node.js 18 dropped in Vite 7. Use Node.js 22 LTS. |
| honeycomb-grid 4.x | Any renderer | Renderer-agnostic. Works with PixiJS, Canvas, SVG, anything. |
| sharp 0.34.x | Node.js 18+ | Uses native C bindings (libvips). Docker images need appropriate base. |

## Installation

```bash
# Initialize monorepo
mkdir hex-crawl && cd hex-crawl
pnpm init
# Create pnpm-workspace.yaml with packages/*

# Client (packages/client)
pnpm create vite client --template react-ts
cd packages/client
pnpm add pixi.js @pixi/react react-router socket.io-client zustand @tanstack/react-query zod
pnpm add -D tailwindcss @tailwindcss/vite vitest

# Server (packages/server)
cd ../server
pnpm add hono @hono/node-server socket.io drizzle-orm postgres better-auth sharp @aws-sdk/client-s3 zod
pnpm add -D drizzle-kit tsx vitest

# Shared (packages/shared)
cd ../shared
pnpm add zod honeycomb-grid
```

## Sources

- npm registry (direct CLI queries) -- all version numbers verified 2026-01-26 (HIGH)
- [PixiJS v8 launch blog](https://pixijs.com/blog/pixi-v8-launches) -- architecture, WebGPU support (HIGH)
- [PixiJS React v8 announcement](https://pixijs.com/blog/pixi-react-v8-live) -- React 19 exclusive, extend API (HIGH)
- [Canvas engine benchmarks](https://github.com/slaylines/canvas-engines-comparison) -- PixiJS vs Konva vs raw Canvas FPS (MEDIUM)
- [Honeycomb hex grid docs](https://abbekeultjes.nl/honeycomb/) -- API, rendering examples (HIGH)
- [Better Auth vs NextAuth comparison](https://betterstack.com/community/guides/scaling-nodejs/better-auth-vs-nextauth-authjs-vs-autho/) -- Auth.js team joining Better Auth (MEDIUM)
- [Drizzle vs Prisma 2026](https://medium.com/@thebelcoder/prisma-vs-drizzle-orm-in-2026-what-you-really-need-to-know-9598cf4eaa7c) -- performance, architecture comparison (MEDIUM)
- [Hono vs Express comparison](https://khmercoder.com/@stoic/articles/25847997) -- performance benchmarks, feature comparison (MEDIUM)
- [Best TypeScript Backend Frameworks 2026](https://encore.dev/articles/best-typescript-backend-frameworks) -- Hono positioning (MEDIUM)
- [Vite 7 announcement](https://vite.dev/blog/announcing-vite7) -- Node.js requirements, breaking changes (HIGH)
- [Tailwind CSS v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4) -- Oxide engine, CSS-first config (HIGH)
- [Socket.IO vs WebSocket guide](https://velt.dev/blog/socketio-vs-websocket-guide-developers) -- rooms, reconnection, performance tradeoffs (MEDIUM)
- [ws vs Socket.IO real-world comparison](https://dev.to/alex_aslam/nodejs-websockets-when-to-use-ws-vs-socketio-and-why-we-switched-di9) -- 50K+ connection benchmarks (MEDIUM)
- [Zustand vs Jotai performance guide](https://www.reactlibraries.com/blog/zustand-vs-jotai-vs-valtio-performance-guide-2025) -- render optimization, game state patterns (MEDIUM)
- [TanStack Query + WebSocket integration](https://blog.logrocket.com/tanstack-query-websockets-real-time-react-data-fetching/) -- cache invalidation pattern (MEDIUM)
- [Sharp official docs](https://sharp.pixelplumbing.com/) -- API, performance claims (HIGH)
- [Coolify documentation](https://coolify.io/docs/applications/) -- deployment, WebSocket config, SSL (HIGH)
- [Vite vs Next.js for SPAs](https://strapi.io/blog/vite-vs-nextjs-2025-developer-framework-comparison) -- when to use each (MEDIUM)
- [Red Blob Games hex grid reference](https://www.redblobgames.com/grids/hexagons/) -- definitive hex math resource (HIGH)

---
*Stack research for: Real-time collaborative hex crawl web application*
*Researched: 2026-01-26*
