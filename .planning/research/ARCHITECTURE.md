# Architecture Research

**Domain:** Real-time collaborative hex crawl web application (virtual tabletop)
**Researched:** 2026-01-26
**Confidence:** MEDIUM-HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                            │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Auth / UI   │  │  State Store │  │   Canvas Renderer        │  │
│  │  (React)     │  │  (Zustand /  │  │   (PixiJS + Layers)      │  │
│  │              │  │   signals)   │  │                          │  │
│  │  - Login     │  │              │  │  ┌─────────────────────┐ │  │
│  │  - Campaign  │  │  - Map state │  │  │ Background Layer    │ │  │
│  │    browser   │  │  - Fog state │  │  │ Hex Grid Layer      │ │  │
│  │  - Session   │  │  - Token     │  │  │ Token Layer         │ │  │
│  │    controls  │  │    positions │  │  │ Fog of War Layer    │ │  │
│  │  - Encounter │  │  - UI state  │  │  │ Marker/Note Layer   │ │  │
│  │    tables    │  │  - Role      │  │  │ UI Overlay Layer    │ │  │
│  └──────┬───────┘  └──────┬───────┘  │  └─────────────────────┘ │  │
│         │                 │          └──────────┬───────────────┘  │
│         └────────┬────────┘                     │                  │
│                  │                              │                  │
│         ┌────────┴──────────────────────────────┴───────────┐      │
│         │              WebSocket Client                      │      │
│         │   (Socket.IO / native WS + reconnect logic)       │      │
│         └────────────────────────┬───────────────────────────┘      │
└──────────────────────────────────┼──────────────────────────────────┘
                                   │ WSS (persistent connection)
                                   │
┌──────────────────────────────────┼──────────────────────────────────┐
│                          SERVER (Node.js)                           │
│                                                                     │
│  ┌───────────────────────────────┴───────────────────────────────┐  │
│  │                   WebSocket Gateway                            │  │
│  │   - Connection registry (Map<sessionId, Set<Socket>>)         │  │
│  │   - Room management (1 room per active session)               │  │
│  │   - Role-based message filtering (DM gets all, players get    │  │
│  │     filtered view based on fog state)                         │  │
│  │   - Reconnection / state replay                               │  │
│  └───────┬───────────────────────┬──────────────────┬────────────┘  │
│          │                       │                  │               │
│  ┌───────┴───────┐  ┌───────────┴──────┐  ┌───────┴────────────┐  │
│  │  Session      │  │  Map Engine      │  │  Auth / Access     │  │
│  │  Manager      │  │                  │  │  Control           │  │
│  │               │  │  - Hex grid ops  │  │                    │  │
│  │  - Campaign   │  │  - Fog state     │  │  - JWT auth        │  │
│  │    CRUD       │  │  - Token moves   │  │  - Role enforce    │  │
│  │  - Session    │  │  - Multi-scale   │  │    (DM vs player)  │  │
│  │    lifecycle  │  │    zoom logic    │  │  - Campaign invite  │  │
│  │  - Encounter  │  │  - Content       │  │    codes           │  │
│  │    tables     │  │    visibility    │  │                    │  │
│  │  - Dice       │  │    (range prop)  │  │                    │  │
│  │    rolling    │  │                  │  │                    │  │
│  └───────┬───────┘  └───────┬──────────┘  └───────┬────────────┘  │
│          │                  │                      │               │
│  ┌───────┴──────────────────┴──────────────────────┴────────────┐  │
│  │                    Data Access Layer                           │  │
│  │   - PostgreSQL (campaigns, users, sessions, hex content)      │  │
│  │   - S3-compatible store (map images, uploaded assets)         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| **Canvas Renderer (PixiJS)** | Renders hex grid, map images, fog, tokens, markers via WebGL with layered compositing | State Store (reads), UI (interaction events) |
| **State Store** | Single source of truth on client for map state, fog state, tokens, UI state; syncs with server via WebSocket | Canvas Renderer, WebSocket Client, UI Components |
| **Auth / UI (React)** | Campaign management, session controls, encounter tables, login/signup, DM tools panel | State Store, REST API |
| **WebSocket Client** | Maintains persistent WSS connection; sends player actions, receives state deltas | Server WebSocket Gateway |
| **WebSocket Gateway** | Connection registry, room management, role-based message filtering, reconnection handling | Session Manager, Map Engine, Auth |
| **Session Manager** | Campaign/session CRUD, encounter table logic, dice rolling, session lifecycle | Data Access Layer, WebSocket Gateway |
| **Map Engine** | Hex coordinate math, fog state mutations, token movement validation, multi-scale zoom logic, content visibility by range | Data Access Layer, WebSocket Gateway |
| **Auth / Access Control** | JWT-based authentication, role enforcement (DM vs player), campaign invite codes | Data Access Layer, WebSocket Gateway |
| **Data Access Layer** | PostgreSQL queries, S3 presigned URL generation for image uploads, data serialization | PostgreSQL, S3-compatible storage |

## Recommended Project Structure

```
src/
├── client/                    # Frontend application
│   ├── canvas/                # PixiJS rendering engine
│   │   ├── layers/            # Individual render layers
│   │   │   ├── BackgroundLayer.ts
│   │   │   ├── HexGridLayer.ts
│   │   │   ├── TokenLayer.ts
│   │   │   ├── FogLayer.ts
│   │   │   ├── MarkerLayer.ts
│   │   │   └── UIOverlayLayer.ts
│   │   ├── HexRenderer.ts     # Hex drawing primitives
│   │   ├── Camera.ts          # Pan/zoom/viewport management
│   │   └── CanvasApp.ts       # PixiJS Application bootstrap
│   ├── hex/                   # Hex math (shared with server)
│   │   ├── coordinates.ts     # Axial/cube coordinate system
│   │   ├── conversions.ts     # Hex-to-pixel, pixel-to-hex
│   │   ├── algorithms.ts      # Neighbors, distance, range, ring
│   │   └── multi-scale.ts     # Scale transitions, parent/child hex mapping
│   ├── state/                 # Client state management
│   │   ├── mapStore.ts        # Hex content, fog state, tokens
│   │   ├── sessionStore.ts    # Active session, connected players
│   │   └── uiStore.ts        # Tool selection, panel visibility
│   ├── sync/                  # WebSocket sync layer
│   │   ├── wsClient.ts        # Connection, reconnection, heartbeat
│   │   ├── protocol.ts        # Message types and serialization
│   │   └── deltaApply.ts      # Apply server deltas to local state
│   ├── components/            # React UI components
│   │   ├── auth/              # Login, signup, invite acceptance
│   │   ├── campaign/          # Campaign browser, creation, settings
│   │   ├── session/           # Session controls, player list
│   │   ├── dm-tools/          # DM-only panels (fog, encounters, tokens)
│   │   └── shared/            # Common UI components
│   └── App.tsx                # Root component
│
├── server/                    # Backend application
│   ├── ws/                    # WebSocket layer
│   │   ├── gateway.ts         # Connection handling, room management
│   │   ├── rooms.ts           # Session room lifecycle
│   │   ├── messageRouter.ts   # Route inbound messages to handlers
│   │   └── roleFilter.ts     # Filter outbound state by player role
│   ├── services/              # Business logic
│   │   ├── campaign.ts        # Campaign CRUD
│   │   ├── session.ts         # Session lifecycle, join/leave
│   │   ├── mapEngine.ts       # Fog mutations, token moves, hex content
│   │   ├── encounterTable.ts  # Random encounter configuration + rolls
│   │   ├── dice.ts            # Dice rolling engine
│   │   └── imageUpload.ts     # Presigned URL generation for S3
│   ├── auth/                  # Authentication + authorization
│   │   ├── jwt.ts             # Token generation/validation
│   │   ├── middleware.ts      # Express + WS auth middleware
│   │   └── roles.ts           # Role definitions and permission checks
│   ├── db/                    # Data access
│   │   ├── schema/            # Database migrations
│   │   ├── queries/           # Query modules per entity
│   │   └── connection.ts      # PostgreSQL connection pool
│   └── index.ts               # Server bootstrap
│
├── shared/                    # Code shared between client and server
│   ├── hex/                   # Hex coordinate math (isomorphic)
│   ├── protocol.ts            # WebSocket message type definitions
│   └── types.ts               # Domain types (Campaign, Session, Hex, etc.)
│
└── assets/                    # Static assets (hex sprites, UI icons)
```

### Structure Rationale

- **`client/canvas/`:** Isolates the PixiJS rendering engine from React. The canvas is a single PixiJS Application with stacked layers, not React components. React controls the UI chrome around the canvas.
- **`client/hex/` and `shared/hex/`:** Hex coordinate math is isomorphic -- the same algorithms run on client (for rendering, hit-testing, local preview) and server (for validation, fog computation, range queries). Share the code.
- **`client/sync/`:** Encapsulates all WebSocket communication behind a clean interface. The state store subscribes to sync events; the canvas reads from the state store. No direct WebSocket calls from UI components or canvas layers.
- **`server/ws/`:** Separates WebSocket transport concerns (connection, rooms, routing) from business logic (services). The `roleFilter` is a critical component: it inspects outbound messages and strips information the receiving player should not see.
- **`server/services/mapEngine.ts`:** The server is the authority on fog state and token positions. All mutations go through this service, get validated, then get broadcast. The client can optimistically render, but the server confirms.

## Architectural Patterns

### Pattern 1: Server-Authoritative State with Optimistic Client Rendering

**What:** The server owns the canonical game state. Clients send intents ("DM reveals hex at q:3,r:5"); the server validates, mutates state, persists, and broadcasts the result. The client can optimistically render the change for the acting user before confirmation arrives.

**When to use:** All state mutations -- fog reveals, token moves, hex content edits, encounter rolls. This is non-negotiable for a DM-controlled game where players must not be able to cheat the fog.

**Trade-offs:**
- PRO: Single source of truth prevents desync; DM controls everything
- PRO: Reconnecting clients can receive full current state from server
- CON: Slight latency for non-acting players (typically <100ms on good connections)
- CON: Server must store and manage all session state

**Example:**
```typescript
// Client sends intent
wsClient.send({ type: 'FOG_REVEAL', hexes: [{q: 3, r: 5}, {q: 4, r: 5}] });

// Server validates (is sender the DM? are hexes valid?)
// Server mutates fog state
// Server broadcasts to room with role filtering:
//   DM gets: { type: 'FOG_STATE_DELTA', revealed: [{q:3,r:5}, {q:4,r:5}] }
//   Players get: { type: 'FOG_STATE_DELTA', revealed: [{q:3,r:5}, {q:4,r:5}],
//                  hexContent: [{ q:3, r:5, terrain: 'forest', note: 'Ancient ruins' }] }
```

### Pattern 2: Layered Canvas Compositing

**What:** Render the map as a stack of independent PixiJS containers (layers), each responsible for one visual concern. Layers are composited by the GPU in z-order. Only dirty layers re-render.

**When to use:** Always. This is the standard approach for canvas-based map applications. Foundry VTT, the leading virtual tabletop, uses exactly this architecture with PixiJS.

**Trade-offs:**
- PRO: Changing fog doesn't re-render the map image; moving a token doesn't re-render the grid
- PRO: Layers can use different update frequencies (background: rare, tokens: often, UI: every frame)
- PRO: Easier to reason about rendering concerns in isolation
- CON: Layer interaction (e.g., fog masking tokens) requires careful compositing order

**Layer stack (bottom to top):**
```
1. Background Layer     - Map image(s), tiled at zoom levels
2. Hex Grid Layer       - Grid lines, hex coordinate labels
3. Content Marker Layer - Icons for hex content (towns, dungeons, etc.)
4. Token Layer          - Player/NPC tokens, draggable
5. Fog of War Layer     - Opaque/semi-transparent overlay masking unrevealed hexes
6. UI Overlay Layer     - Selection highlights, measurement tools, cursor
```

### Pattern 3: Room-Based WebSocket with Role-Filtered Broadcasting

**What:** Each active game session is a WebSocket "room." When the server broadcasts state changes, it runs each outbound message through a role filter that strips information based on the recipient's role (DM vs player) and the current fog state.

**When to use:** All real-time communication. The room isolates sessions; the role filter enforces the core "DM sees everything, players see only revealed" invariant.

**Trade-offs:**
- PRO: Clean separation -- transport layer handles rooms, application layer handles filtering
- PRO: DM can always see the full map state for authoring
- PRO: Adding new roles (e.g., "spectator") is just a new filter
- CON: Role filter must be kept in sync with fog state (if fog changes, filter changes)
- CON: Per-player message construction is more work than broadcast-to-all

**Example:**
```typescript
// Server broadcasts to a room
function broadcastToSession(sessionId: string, event: GameEvent) {
  const room = rooms.get(sessionId);
  for (const socket of room.sockets) {
    const filtered = roleFilter(event, socket.role, room.fogState);
    socket.send(filtered);
  }
}

// Role filter logic
function roleFilter(event: GameEvent, role: Role, fogState: FogState): GameEvent {
  if (role === 'dm') return event; // DM sees everything
  // Players only see content in revealed hexes
  if (event.type === 'HEX_CONTENT_UPDATE') {
    return {
      ...event,
      hexes: event.hexes.filter(h => fogState.isRevealed(h.q, h.r))
    };
  }
  return event;
}
```

### Pattern 4: Multi-Scale Hex Grid with Parent-Child Mapping

**What:** Represent the world as multiple hex grid layers at different scales (e.g., continent at 60mi/hex, region at 6mi/hex, local at 1mi/hex). Each parent hex at a coarser scale maps to a fixed set of child hexes at the finer scale. Zooming in/out transitions between scales.

**When to use:** This is the core navigation model for a hex crawl. The DM defines content at each scale; players explore by zooming from continent to region to local.

**Trade-offs:**
- PRO: Matches traditional tabletop hex crawl conventions (D&D 5e DMG scales)
- PRO: Content can be authored at the appropriate scale (a kingdom is a continent hex, a town is a local hex)
- PRO: "Visible at range" property naturally maps to "visible at coarser zoom levels"
- CON: Coordinate mapping between scales requires careful math
- CON: Transition animations between scales add UI complexity
- CON: Fog state must be tracked independently per scale level

**Coordinate approach:**
```typescript
// Use axial coordinates (q, r) at each scale level
// Each hex at scale N contains a grid of hexes at scale N+1
interface HexAddress {
  scale: 'continent' | 'region' | 'local';
  q: number;
  r: number;
}

// Parent-child mapping
// A continent hex at (q, r) contains a region-scale grid
// centered on that hex's world position
function getChildHexes(parent: HexAddress): HexAddress[] {
  // Returns the set of finer-scale hexes contained within parent
  // Exact count depends on scale ratios (e.g., 60mi / 6mi = ~10:1 ratio)
}
```

## Data Flow

### Real-Time State Sync Flow

```
DM Action (e.g., reveal hex)
    │
    ▼
[Client State Store] ──optimistic update──▶ [Canvas Renderer]
    │
    ▼
[WebSocket Client] ──intent message──▶ [WS Gateway]
                                           │
                                           ▼
                                    [Message Router]
                                           │
                                           ▼
                                    [Map Engine] ──validate + mutate──▶ [PostgreSQL]
                                           │
                                           ▼
                                    [Role Filter] ──per-socket──▶ [WS Gateway]
                                                                      │
                           ┌──────────────────────────────────────────┤
                           │                                          │
                           ▼                                          ▼
                    [DM Client]                               [Player Client(s)]
                    full state delta                           filtered state delta
                           │                                          │
                           ▼                                          ▼
                    [State Store]                              [State Store]
                           │                                          │
                           ▼                                          ▼
                    [Canvas Renderer]                          [Canvas Renderer]
                    (confirms optimistic)                      (applies revealed content)
```

### Image Upload Flow

```
DM selects map image
    │
    ▼
[Client] ──POST /api/upload/presign──▶ [Auth Middleware] ──▶ [Image Upload Service]
                                                                    │
                                                             generates presigned PUT URL
                                                                    │
                                                                    ▼
[Client] ◀──presigned URL + asset ID────────────────────────────────┘
    │
    ▼
[Client] ──PUT (binary)──▶ [S3-compatible storage]
    │
    ▼ (on upload success)
[Client] ──POST /api/assets/confirm──▶ [Server]
                                          │
                                   stores asset metadata
                                   (campaign, scale, position)
                                          │
                                          ▼
                                   [WebSocket broadcast]
                                   "new background image available"
                                          │
                                          ▼
                                   [All clients load image from S3 URL]
```

### Session Join Flow

```
Player opens invite link
    │
    ▼
[Auth] ──validate invite code──▶ [Campaign lookup]
    │                                    │
    ▼                                    ▼
[JWT issued with role=player]    [Session state snapshot]
    │                                    │
    ▼                                    ▼
[WebSocket connect with JWT]     [Full state sent to new player]
    │                            (filtered by role + fog)
    ▼
[Added to session room]
    │
    ▼
[Existing clients notified: "Player X joined"]
```

### Key Data Flows

1. **Fog reveal:** DM clicks hex -> intent sent to server -> server validates DM role, updates fog state in DB, computes newly visible content -> broadcasts fog delta to all players (with hex content that was hidden) and confirmation to DM.

2. **Token movement:** Player drags token -> client sends move intent -> server validates (is it their token? is destination valid? is destination revealed?) -> updates position in DB -> broadcasts new position to all clients.

3. **Zoom transition:** Player zooms past threshold -> client requests finer-scale hex data for the visible area -> server returns hex content (filtered by fog state and role) -> client renders new scale grid with content.

4. **Encounter roll:** DM triggers encounter check for a hex -> server looks up encounter table for that hex's terrain type -> server rolls dice -> broadcasts result to DM (full table entry) and optionally to players (narrative description only).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 DM + 6 players (target) | Single Node.js process handles everything. SQLite or PostgreSQL. No Redis needed. In-memory session state is fine. |
| 5-10 concurrent sessions | Still single process. PostgreSQL recommended. Session rooms isolate memory. Monitor WebSocket connection count. |
| 50+ concurrent sessions | Add Redis for session state and pub/sub. Allows horizontal scaling to multiple Node.js processes behind a load balancer with sticky sessions. |
| 1000+ concurrent sessions | Dedicated WebSocket servers behind a load balancer. Redis Cluster for pub/sub. CDN for map images. Consider separating REST API from WebSocket servers. |

### Scaling Priorities

1. **First bottleneck: Map image loading.** Large map images (10+ MB) will be the first pain point. Solve with: serve images from S3/CDN, generate multiple resolution tiles on upload, load only visible tiles.

2. **Second bottleneck: WebSocket memory per session.** Each active session holds fog state and token positions in memory. For the target scale (1 session), this is trivial. At 50+ sessions, externalize to Redis.

3. **Third bottleneck: Database writes.** Frequent token movements can generate many writes. Batch/debounce position updates (e.g., write final position, not every intermediate drag position). At high scale, consider a write-ahead buffer.

## Anti-Patterns

### Anti-Pattern 1: Client-Authoritative Fog State

**What people do:** Let the client manage fog state and just hide/show hexes locally based on a fog mask received once at session start.
**Why it's wrong:** A player can inspect the browser's memory/network traffic and see all hex content, defeating the entire purpose of fog of war. The DM has no real-time control.
**Do this instead:** Server is the authority. Players never receive hex content data for unrevealed hexes. The fog layer on the client is a visual representation of the server's fog state, not the source of truth.

### Anti-Pattern 2: Rendering Every Hex Every Frame

**What people do:** Loop through all hexes in the world and draw them on every animation frame, even hexes far outside the viewport.
**Why it's wrong:** Performance degrades linearly with world size. A continent-scale map with thousands of hexes will drop to single-digit FPS.
**Do this instead:** Implement viewport culling. Calculate which hexes are visible at the current pan/zoom, and only render those. Use PixiJS container culling or a spatial index (R-tree) for fast viewport queries. Pre-render static layers (grid, background) to cached textures and only re-render on zoom/pan changes.

### Anti-Pattern 3: Storing Fog as a Single Bitmap

**What people do:** Represent fog of war as a pixel-level bitmap overlay, like a Photoshop layer.
**Why it's wrong:** Hex crawl fog is inherently hex-granular, not pixel-granular. A bitmap fog doesn't map cleanly to hex coordinates, makes it hard to query "is hex (q,r) revealed?", wastes memory, and doesn't translate across zoom levels.
**Do this instead:** Store fog state as a Set of revealed hex coordinates per scale level: `Set<"q,r">`. Render the fog layer by drawing opaque hexes for unrevealed coordinates. This is storage-efficient, query-efficient, and maps directly to the hex grid.

### Anti-Pattern 4: Tightly Coupling React and Canvas

**What people do:** Try to render the hex map using React components (one component per hex) or manage PixiJS objects through React state.
**Why it's wrong:** React's reconciliation is designed for DOM updates, not 60fps canvas rendering. Thousands of hex components will cause massive re-render overhead. React and PixiJS have fundamentally different update models.
**Do this instead:** React owns the UI chrome (panels, buttons, forms). PixiJS owns the canvas. They communicate through the state store: React dispatches actions that update state; the canvas reads state and renders. A thin bridge layer subscribes the canvas to state changes. Interaction events from the canvas (hex clicks, token drags) dispatch to the state store, not to React.

### Anti-Pattern 5: Broadcasting Full State on Every Change

**What people do:** On any state mutation, send the complete session state (all hexes, all fog, all tokens) to every client.
**Why it's wrong:** Wastes bandwidth, causes UI jank as clients must diff and re-render everything, and scales poorly with map size.
**Do this instead:** Send state deltas. When a hex is revealed, broadcast only the newly revealed hex coordinates and their content. When a token moves, broadcast only that token's new position. Clients apply deltas to their local state incrementally.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| S3-compatible storage (AWS S3, Cloudflare R2, MinIO) | Presigned URLs for upload; direct client download via CDN URL | Never proxy image bytes through the app server. CORS must be configured on the bucket. |
| PostgreSQL | Connection pool via `pg` or Prisma/Drizzle ORM | JSONB columns for flexible hex content (terrain type, notes, encounter table refs). Relational tables for campaigns, users, sessions. |
| (Optional) Redis | Pub/sub for multi-process WebSocket; session state externalization | Not needed at initial scale. Add when horizontal scaling is required. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| React UI <-> Canvas | State store (read) + event dispatch (write) | Never import PixiJS in React components. Never import React in canvas code. |
| Client <-> Server (real-time) | WebSocket (binary or JSON messages with typed protocol) | All messages follow a discriminated union pattern: `{ type: string, payload: T }` |
| Client <-> Server (REST) | HTTP REST for campaign CRUD, auth, image upload presign | Keep REST for operations that don't need real-time: login, campaign management, asset management |
| Server WS Gateway <-> Services | Direct function calls (same process at initial scale) | If scaling to microservices later, this boundary becomes an internal API. Design service interfaces as if they were remote. |
| Map Engine <-> Hex Math | Pure function imports from shared hex library | The shared hex library has zero dependencies and no I/O. It is pure math. |

## Database Schema (Conceptual)

```
campaigns
  id, name, owner_id, created_at, settings (JSONB)

campaign_members
  campaign_id, user_id, role (dm|player), invite_code

sessions
  id, campaign_id, name, status (active|ended), started_at, ended_at

hex_maps
  id, campaign_id, scale (continent|region|local), parent_hex_id (nullable)

hexes
  id, hex_map_id, q, r, terrain_type, content (JSONB), visible_at_range (int)

fog_state
  session_id, hex_map_id, revealed_hexes (JSONB array of {q,r} or bitmap)

tokens
  id, session_id, hex_map_id, q, r, name, image_url, owner_id

map_images
  id, hex_map_id, s3_key, width, height, position_offset_x, position_offset_y

encounter_tables
  id, campaign_id, name, terrain_type, entries (JSONB array of {weight, description, ...})

users
  id, email, password_hash, display_name
```

**Key design decisions:**
- `hexes.content` is JSONB because hex content is flexible (a town has different fields than a dungeon).
- `fog_state.revealed_hexes` is stored per-session so different sessions in the same campaign can have different exploration progress.
- `hex_maps` form a hierarchy via `parent_hex_id`, supporting the multi-scale structure.
- `hexes.visible_at_range` enables the "influence radius" feature: a mountain visible at 3 hexes becomes visible on the region map before players arrive.

## Suggested Build Order

The following order reflects component dependencies. Each phase produces a working, testable artifact.

### Phase 1: Hex Math Foundation + Static Canvas Rendering
**Build:** Shared hex coordinate library (axial/cube), hex-to-pixel conversion, neighbor/distance/range algorithms. PixiJS canvas bootstrap with hex grid layer rendering a static grid.
**Why first:** Everything else depends on hex math. Rendering a visible grid proves the coordinate system works. No server needed.
**Dependency:** None (foundation).

### Phase 2: Multi-Scale Hex Maps + Camera Controls
**Build:** Multi-scale hex grid data structures (continent/region/local), zoom-triggered scale transitions, pan/zoom camera with viewport culling.
**Why second:** The map is the product. Multi-scale zoom is the core UX and the hardest rendering challenge. Solve it early before adding layers of complexity.
**Dependency:** Phase 1.

### Phase 3: Server Foundation + Data Persistence
**Build:** Node.js server, PostgreSQL schema, campaign/hex map CRUD via REST API, user authentication (JWT), basic role model.
**Why third:** The canvas can render hardcoded data for Phases 1-2. Phase 3 introduces real persistence so hex content survives across sessions.
**Dependency:** Phase 1 (shared hex types).

### Phase 4: Real-Time WebSocket Infrastructure
**Build:** WebSocket gateway, room management, connection registry, message protocol, basic state sync (e.g., broadcast a "ping" to prove the pipe works).
**Why fourth:** Real-time sync is the second core value proposition. Building the WebSocket infrastructure before specific features lets all subsequent features use it.
**Dependency:** Phase 3 (server exists).

### Phase 5: Fog of War (Core Feature)
**Build:** Fog state storage (per-session, per-scale), fog layer rendering (opaque overlay with hex-shaped cutouts), DM reveal/hide tools, role-filtered broadcasting (players receive content only when fog lifts).
**Why fifth:** This is the highest-value differentiating feature. It requires the canvas (Phase 1-2), server (Phase 3), and WebSocket (Phase 4) to all be working.
**Dependency:** Phases 1-4.

### Phase 6: Tokens + Real-Time Movement
**Build:** Token rendering layer, drag-and-drop movement, server-validated position updates, real-time broadcast of token positions to all players.
**Why sixth:** Tokens are the primary player interaction with the map. They require fog awareness (tokens in fog are hidden from players).
**Dependency:** Phases 4-5.

### Phase 7: Map Image Upload + Background Layer
**Build:** Image upload via presigned S3 URLs, background layer rendering (map image behind hex grid), image positioning/scaling tools for the DM.
**Why seventh:** Map images are a visual upgrade but not structurally necessary. The hex grid is functional without images. This phase can be deferred if needed.
**Dependency:** Phases 2-3.

### Phase 8: Hex Content + Encounter Tables + Dice
**Build:** Hex content CRUD (terrain, notes, points of interest), encounter table configuration, dice rolling engine, encounter check triggered by DM or movement.
**Why eighth:** Content management is DM tooling that layers on top of the working map. Encounter tables are campaign-specific configuration.
**Dependency:** Phases 3-5.

### Phase 9: Campaign Management + Access Control
**Build:** Campaign creation/browsing, invite code generation, session lifecycle (start/end), player roster management, DM transfer.
**Why ninth:** The DM can run sessions with direct URL sharing initially. Full campaign management is quality-of-life.
**Dependency:** Phase 3.

### Phase 10: Polish + Production Readiness
**Build:** Reconnection handling, state replay on rejoin, error recovery, responsive UI, performance optimization (tile caching, lazy loading), deployment pipeline.
**Why last:** Polish depends on all features being stable.
**Dependency:** All phases.

## Sources

- [Red Blob Games: Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/) -- definitive reference for hex coordinate systems, algorithms, and pixel mapping. HIGH confidence.
- [Foundry VTT Canvas Layers](https://foundryvtt.com/article/canvas-layers/) -- production VTT architecture using PixiJS layered canvas. HIGH confidence.
- [Foundry VTT API: Canvas](https://foundryvtt.com/api/classes/foundry.canvas.Canvas.html) -- Canvas group hierarchy and rendering pipeline. HIGH confidence.
- [Foundry VTT Community Wiki: Document](https://foundryvtt.wiki/en/development/api/document) -- Document-based data model with embedded documents. HIGH confidence.
- [PixiJS Performance Tips](https://pixijs.com/8.x/guides/concepts/performance-tips) -- Culling, batching, mask costs, filter optimization. HIGH confidence.
- [PixiJS Render Layers](https://pixijs.com/8.x/guides/concepts/render-layers) -- Render layer system for z-order independent of scene graph. HIGH confidence.
- [Honeycomb: Rendering-agnostic hex grids](https://medium.com/@Flauwekeul/honeycomb-hexagon-grids-in-javascript-555d2f9ac54f) -- Library separating hex grid logic from rendering. MEDIUM confidence.
- [Ably: WebSocket Architecture Best Practices](https://ably.com/topic/websocket-architecture-best-practices) -- Connection management, scaling, rooms. MEDIUM confidence.
- [Hathora: Scalable WebSocket Architecture](https://blog.hathora.dev/scalable-websocket-architecture/) -- Stateful routing, room-per-server scaling. MEDIUM confidence.
- [Socket.IO + Redis multiplayer game architecture](https://dev.to/dowerdev/building-a-real-time-multiplayer-game-server-with-socketio-and-redis-architecture-and-583m) -- Room management, pub/sub scaling pattern. MEDIUM confidence.
- [IBM: Canvas HTML5 Layering](https://developer.ibm.com/tutorials/wa-canvashtml5layering/) -- Multi-canvas layering for performance. MEDIUM confidence.
- [MDN: Optimizing Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) -- Pre-rendering, culling, requestAnimationFrame. HIGH confidence.
- [SeatGeek: High-Performance Map Canvas](https://chairnerd.seatgeek.com/high-performance-map-interactions-using-html5-canvas/) -- R-tree spatial indexing, tile-based rendering, 60fps map interactions. MEDIUM confidence.
- [H3: Uber's Hierarchical Hex Grid](https://h3geo.org/docs/core-library/coordsystems/) -- Multi-resolution hex coordinate system with parent-child relationships. HIGH confidence.
- [Welsh Piper: Hex-Based Campaign Design](https://welshpiper.com/hex-based-campaign-design-part-1/) -- Multi-scale hex mapping for tabletop RPGs. MEDIUM confidence.
- [Red Ragged Fiend: D&D Hex Mapping](https://www.redraggedfiend.com/introduction-hex-mapping/) -- Hierarchical hex scales matching D&D tiers of play. MEDIUM confidence.
- [Amazon S3: Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) -- Direct client upload pattern. HIGH confidence.
- [Fog of War Canvas Implementation](https://medium.com/@travnick/fog-of-war-282c8335a355) -- Multi-canvas fog rendering with globalCompositeOperation. MEDIUM confidence.
- [MiniVTT](https://github.com/SamsterJam/MiniVTT) -- Lightweight VTT with real-time sync via WebSockets. LOW confidence (small project).
- [Foundry VTT Wikipedia](https://en.wikipedia.org/wiki/Foundry_VTT) -- Foundry architecture overview, hosting models. MEDIUM confidence.

---
*Architecture research for: Real-time collaborative hex crawl web application*
*Researched: 2026-01-26*
