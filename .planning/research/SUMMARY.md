# Project Research Summary

**Project:** Real-time Collaborative Hex Crawl Exploration Tool
**Domain:** Web-based virtual tabletop (VTT) for hex crawl campaigns
**Researched:** 2026-01-26
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a purpose-built hex crawl exploration tool for tabletop RPG campaigns, competing in a space currently dominated by general-purpose VTTs (Roll20, Foundry) that treat hex crawls as afterthoughts requiring multiple modules. The recommended approach is a modern TypeScript monorepo using React 19 + PixiJS 8 for WebGL-accelerated canvas rendering on the frontend, Hono + Socket.IO for real-time multiplayer on the backend, and PostgreSQL for structured campaign data. The architecture centers on server-authoritative state with role-filtered WebSocket broadcasting—the DM sees everything, players see only revealed hexes—enforced through a projection layer that never sends unrevealed content to player clients.

The core technical challenge is real-time fog of war with hex-native rendering at scale. Roll20's fog is notoriously bad (square-grid-based internally), and Foundry requires cobbling together 3-4 modules to achieve basic hex crawl functionality. The key differentiator is multi-scale zoom (continent → region → local hexes) with consistent coordinate mapping across scales, which no existing tool provides seamlessly. Critical risks include fog positional drift under coordinate transforms, canvas memory exhaustion from large map images, server-client state desync on reconnection, and DM-only state leaking to players via DevTools—all of which have detailed mitigation strategies from Foundry VTT's issue history and Riot Games' fog of war engineering blog.

The roadmap should prioritize hex math foundation and static canvas rendering first (everything else depends on correct coordinate systems), then add real-time WebSocket infrastructure, then fog of war (the convergence point requiring canvas, server, and sync all working), then tokens and map images. Multi-scale zoom, while the strongest differentiator, is VERY HIGH complexity and should be deferred to v2+ after core exploration loop is validated. The MVP is "DM reveals hex fog in real-time, players see content instantly"—this validates the value proposition before adding architectural complexity.

## Key Findings

### Recommended Stack

The research converged on a modern TypeScript monorepo with separation of concerns between rendering (PixiJS), UI (React 19), and real-time sync (Socket.IO). React 19 is non-negotiable because PixiJS React v8 is built exclusively for React 19 and provides the cleanest canvas-React integration. Vite 7 is the correct build tool for an SPA—Next.js would add SSR overhead that harms a real-time canvas app behind auth with no SEO requirements. Hono replaces Express as the modern TypeScript-first backend framework with built-in WebSocket support, 4x faster throughput, and 14KB minified vs Express's 500KB+.

**Core technologies:**
- **PixiJS 8 + @pixi/react 8**: WebGL-accelerated 2D rendering with 60 FPS on 8,000+ sprites (vs Konva's 23 FPS). Purpose-built for layered canvas compositing (background, grid, tokens, fog, UI). React 19 exclusive.
- **Socket.IO 4**: Real-time WebSocket communication with built-in rooms (1 room = 1 campaign session), automatic reconnection, namespace support. Optimized for DM-player scenarios over raw `ws` latency.
- **PostgreSQL 16+**: Concurrent multi-user writes are non-negotiable for real-time multiplayer. SQLite's single-writer constraint is a dealbreaker. JSONB for flexible hex content, array types for fog state.
- **Drizzle ORM**: SQL-transparent queries critical for debugging real-time state sync issues. 7KB vs Prisma's heavier footprint. Zero binary dependencies.
- **Hono 4**: TypeScript-first backend with built-in WebSocket, 14KB minified, auto-typed route params. 4x faster than Express. Runs on any runtime (Node, Bun, Deno, edge).
- **Zustand 5**: 3KB centralized state for global game state (campaign, session, fog, UI). Pairs with TanStack Query 5 for server state caching and WebSocket cache invalidation.
- **Better Auth 1.4**: Auth.js team joined Better Auth (Sept 2025), Auth.js is now maintenance-only. Framework-agnostic, plugin-based, supports email/password (which Auth.js discourages).
- **honeycomb-grid 4**: Renderer-agnostic hex grid math based on Red Blob Games' definitive reference. Handles cube/axial/offset coordinates, neighbors, distance, rings, pathfinding.

**Critical version constraints:**
- @pixi/react 8.x ONLY works with React 19. Will NOT work with React 18.
- Vite 7 requires Node.js 20.19+ or 22.12+ (Node 18 dropped).
- Tailwind CSS 4 (Rust engine, 5x faster builds, CSS-first config) should be used over v3 for new projects.

### Expected Features

Research identified a clear MVP boundary: the exploration loop (hex grid + fog + roles + real-time sync + tokens + content reveal) is table stakes and validates the value proposition. Everything else is polish or differentiation that can be added post-validation.

**Must have (table stakes):**
- **Hex-native fog of war (DM-controlled, per-hex)**: This IS the product. Roll20's fog is square-grid-based and terrible. Foundry requires modules. No existing tool does hex-native fog as first-class with real-time sync.
- **DM/player roles with filtered views**: DM sees full map + notes, players see only revealed hexes. Every VTT separates perspectives.
- **Real-time sync (WebSocket)**: DM reveals hex, players see it instantly (<100ms). Any lag breaks immersion.
- **Token placement and movement**: Visual "you are here" marker. Snap-to-hex-center.
- **Hex content/notes (DM-side)**: Attach encounters, lore, descriptions to hexes. DM-only until revealed.
- **Hex content reveal**: Staged disclosure—DM controls what players see about each hex independently of fog.
- **Terrain types**: Color-coded or icon-based (forest, mountain, plains, desert, swamp, water). Hex crawls are defined by terrain.
- **Campaign persistence**: Map state, fog, tokens, content must survive between sessions.
- **Account-based auth**: DM owns campaign, players join via invite.

**Should have (competitive advantage):**
- **Two-stage fog reveal**: Terrain silhouette first, then full detail (HEXROLL does this, compelling UX).
- **DM-configurable encounter tables with dice rolling**: Foundry's Hex-Assist does this via macro (bolt-on), not first-class. Built-in terrain-aware generation with DMG-compatible dice (d6, d8, d12, d20, percentile) is differentiator.
- **Travel/time tracking**: Movement cost per terrain, pace (careful/normal/fast), watch-based time (morning/afternoon/evening/night).
- **Weather generation**: Per-day or per-watch weather affecting travel speed and encounters.
- **Upload custom map images**: DMs have existing maps. Refusing to support imports will cause revolt.
- **Session URL sharing**: HEXROLL does this—click Share, get link, players join. No account required for players. Lowers friction.

**Defer (v2+):**
- **Multi-scale hex zoom (continent/region/local)**: VERY HIGH complexity. Hex nesting is geometrically hard (multiples of 3 work cleanly: 6mi → 18mi → 54mi). Coordinate mapping between scales requires canonical coordinate system. This is the strongest differentiator but also highest risk. Defer until core loop validated.
- **Influence radius / content bleed across scales**: Dragon's lair in 1-mile hex affects adjacent hexes and parent 6-mile hex. Depends entirely on multi-scale zoom working.
- **Navigation/getting lost mechanics**: Failed navigation = silent veer to adjacent hex (DM sees true position, players see intended). Powerful but niche. Alexandrian framework documents this.
- **Paint terrain collaboratively**: Live terrain painting during session. Collaborative editing is harder than single-user.

**Anti-features (deliberately NOT building):**
- **Combat grid / tactical map**: Scope explosion (initiative, range, AoE, conditions, LOS, walls). This is what makes VTTs take years. Product is exploration tool, not combat tool. Link out to existing VTTs or provide simple "zoom into hex" theater-of-mind view.
- **Character sheets**: Massive scope, system-specific (5e/PF2e/OSR all different). D&D Beyond, Foundry, Roll20 do this better. Integration point: link to D&D Beyond or simple name/class/HP on tokens.
- **General-purpose dice rolling**: Scope creep toward full VTT. Dice ONLY for encounter tables (DM-side). Not for players.
- **Chat / video / voice**: Users have Discord. Building messaging is significant effort with moderation implications. Assume external voice chat.
- **Procedural world generation**: HEXROLL, Azgaar, Worldographer do this. Deep rabbit hole. Product's value is exploration experience, not generating worlds. Support importing content.
- **Mobile-first design**: Hex maps require precision (clicking hexes, painting terrain, fog management). Touch interfaces for map editors are frustrating. Desktop-first. Player view tablet-usable (view-only + token movement).

### Architecture Approach

The architecture follows proven VTT patterns from Foundry VTT and real-time multiplayer patterns from Riot Games and Figma. Server-authoritative state is non-negotiable—the server owns canonical game state, clients send intents, server validates/mutates/persists/broadcasts. The client can optimistically render for the acting user, but server confirms. This prevents fog cheating (players inspecting DevTools to see hidden hexes) and ensures DM control.

**Major components:**
1. **Layered Canvas (PixiJS)**: Stack of independent containers (Background → Hex Grid → Content Markers → Tokens → Fog → UI Overlay). Only dirty layers re-render. Changing fog doesn't re-render map image; moving token doesn't re-render grid. Foundry VTT uses exactly this architecture.
2. **WebSocket Gateway (Server)**: Connection registry, room management (1 room per session), role-based message filtering (DM gets all, players get filtered by fog state), reconnection/state replay with monotonic sequence numbers.
3. **Map Engine (Server)**: Server authority on fog state and token positions. All mutations validated here, then broadcast. Handles hex coordinate math (axial/cube), fog state mutations, token movement validation, content visibility by range.
4. **State Store (Client)**: Single source of truth on client (Zustand). Syncs with server via WebSocket. Canvas reads from store, never from network directly. React UI dispatches actions to store.
5. **Role Filter (Server)**: Inspects outbound messages and strips information based on recipient's role and current fog state. Players never receive hex content data for unrevealed hexes. This is the security boundary.

**Key patterns:**
- **Server-authoritative state with optimistic client rendering**: Client sends intent → server validates → mutates → persists → broadcasts result. Client can optimistically render before confirmation.
- **Room-based WebSocket with role-filtered broadcasting**: Each session is a room. Every broadcast runs through role filter (DM sees everything, players see only revealed).
- **Layered canvas compositing**: Render as GPU-composited stack. Background layer: map image (rarely changes). Grid layer: hex lines/labels. Token layer: draggable sprites. Fog layer: opaque hex mask with composite cutouts. UI layer: selection highlights (every frame).
- **Viewport culling**: Only render hexes visible in current pan/zoom. Use spatial index (R-tree or hash grid aligned to hex grid) for O(1) visibility checks. Performance degrades without this at >200 hexes.

**Data flow:**
- Fog reveal: DM clicks hex → intent to server → server validates DM role → updates fog in DB → computes newly visible content → broadcasts fog delta (with hex content that was hidden) to players, confirmation to DM.
- Token movement: Player drags token → client sends move intent → server validates (is it their token? destination valid? destination revealed?) → updates position in DB → broadcasts to all clients.
- Reconnection: Client sends last-seen sequence number → server replays events after that number → if gap >500 events, send full state snapshot instead.

### Critical Pitfalls

Seven critical pitfalls extracted from Foundry VTT's issue tracker (6+ fog-related architectural bugs over 3 years) and Riot Games' fog of war postmortem:

1. **Fog positional drift under scene offsets**: Fog bitmap gradually shifts out of alignment with hex grid when maps have offsets/padding/zoom. Foundry VTT issue #6983 confirmed this. **Avoid:** Store fog in hex coordinates, not pixel coordinates. Derive pixel positions at render time. Never cache pixel positions. Test with scene offsets applied.

2. **Wrong hex coordinate system (offset vs axial/cube)**: Offset coordinates (row/col) make every algorithm require odd/even branching. Distance, neighbors, pathfinding, multi-scale mapping all break. Red Blob Games: "offset coordinates make algorithms complex because arithmetic doesn't preserve distance/rotation." **Avoid:** Use cube coordinates (q,r,s where q+r+s=0) for algorithms, axial (q,r) for storage. Never expose offsets in data model. Convert only at rendering boundary.

3. **Server-client state desync on WebSocket reconnection**: Gaps between disconnect and reconnect are blind spots. Events during gap are lost. Race condition between fetching initial state and establishing WebSocket. **Avoid:** Server-side event log with monotonic sequence numbers. On reconnect, client sends last-seen sequence, server replays. If gap >500 events, send full snapshot. Exponential backoff with jitter (start 1s, max 30s).

4. **Canvas memory exhaustion from large map images**: 4000x4000px map = 64MB raw RGBA per canvas layer. iOS Safari: "Total canvas memory exceeds maximum limit" error. Desktop: tab crashes. **Avoid:** Max upload dimensions (4096x4096), reject/resize server-side. Generate multi-resolution tiers (thumbnail, medium, full). Tile-based rendering: 512x512 tiles, load only visible tiles. Monitor `performance.memory`, implement LRU cache eviction.

5. **DM-only state leaking to player clients**: Sending all state to all clients and filtering in UI is simpler but leaks hidden content via DevTools. Player can see full map, encounters, notes. Breaks entire fog value proposition. **Avoid:** Server is authority on what each client can see. Never send unrevealed hex content to players. State projection layer filters outgoing state by role + fog visibility. When fog reveals, server pushes content as delta event.

6. **Fog rendering performance collapse at scale**: Per-hex fog entities (one sprite per hex) works at 20 hexes, collapses at 500+. Blur effects are quadratic with resolution (Riot Games learned this). **Avoid:** Single full-screen fog texture (bitmap mask), not per-hex entities. Punch holes with `globalCompositeOperation: 'destination-out'`. Use separable blur (two-pass H+V) not single-pass Gaussian. Only re-render fog on visibility change, not every frame. Cache fog texture, composite as static layer.

7. **Multi-scale position inconsistency across zoom levels**: Region hex doesn't consistently map to local hexes. Party icon at region zoom points to one area, zooming in shows them elsewhere. **Avoid:** Define single canonical coordinate system (cube/axial) consistent across all scales. Express zoom relationship as integer ratio (e.g., 1 region hex = 7 local hexes: center + 6 neighbors). Store positions in canonical coords, derive display positions at render time from canonical + zoom level.

## Implications for Roadmap

Research indicates a clear dependency chain: hex math foundation → canvas rendering → server persistence → WebSocket infrastructure → fog of war (convergence point) → tokens → content management. Multi-scale zoom, while the strongest differentiator, is VERY HIGH complexity and should be deferred until core loop validated.

### Suggested Phase Structure

#### Phase 1: Hex Math Foundation + Static Rendering
**Rationale:** Everything depends on correct hex coordinate systems. All research sources (Red Blob Games, Foundry VTT, honeycomb-grid) emphasize getting coordinates right from day one. Migration cost from offset to axial is HIGH (2-4 weeks, rewrite every algorithm). Canvas rendering proves the coordinate system works visually.

**Delivers:**
- Shared hex coordinate library (axial/cube, conversions, neighbors, distance, range algorithms)
- PixiJS canvas bootstrap with hex grid layer rendering static grid
- Hex-to-pixel conversion with viewport culling
- No server needed (can render hardcoded test data)

**Addresses:** Hex grid display (table stakes), hex numbering (P2 feature), foundation for all other features

**Avoids:** Pitfall #2 (wrong coordinate system), Pitfall #7 (multi-scale position inconsistency foundation)

**Research flag:** SKIP—Red Blob Games is definitive, honeycomb-grid is proven, well-documented patterns

---

#### Phase 2: Server Foundation + Data Persistence
**Rationale:** Real persistence enables campaign continuity (table stakes). Auth and role model are prerequisites for fog of war (Phase 5). Database schema must exist before WebSocket sync can layer on top. Building server early allows testing data model with real use cases before complexity increases.

**Delivers:**
- Node.js server (Hono), PostgreSQL schema (campaigns, hexes, fog_state, tokens, users)
- Campaign/hex map CRUD via REST API
- User authentication (Better Auth, JWT)
- Basic role model (DM vs player)
- S3-compatible storage integration (presigned URLs for map images)

**Uses:** Hono (backend framework), PostgreSQL (database), Drizzle ORM (SQL-transparent), Better Auth (authentication)

**Implements:** Data Access Layer, Auth/Access Control components

**Avoids:** Technical debt pattern (in-memory state only—only acceptable first week of prototyping)

**Research flag:** SKIP—standard CRUD patterns, well-documented

---

#### Phase 3: Real-Time WebSocket Infrastructure
**Rationale:** Real-time sync is the second core value proposition (after fog). Building WebSocket infrastructure before specific features lets all subsequent features (fog, tokens, encounters) use it. Reconnection handling must be architectural from start—retrofitting is expensive.

**Delivers:**
- WebSocket gateway (Socket.IO), connection registry, room management
- Message protocol (discriminated union pattern: `{ type: string, payload: T }`)
- Event log with monotonic sequence numbers for replay
- Reconnection handling with exponential backoff, state replay
- Basic broadcast to prove pipe works (e.g., "player joined" notifications)

**Uses:** Socket.IO 4 (rooms, reconnection), shared protocol types (Zod schemas)

**Implements:** WebSocket Gateway, Session Manager components

**Addresses:** Real-time sync (table stakes)

**Avoids:** Pitfall #3 (state desync on reconnection), anti-pattern (polling instead of WebSocket)

**Research flag:** MODERATE—reconnection patterns documented but need testing under real network conditions

---

#### Phase 4: Fog of War (Core Feature)
**Rationale:** This is the highest-value differentiating feature and the convergence point requiring canvas (Phase 1), server (Phase 2), and WebSocket (Phase 3) all working. Fog validates the entire value proposition: "DM reveals hex, players see it instantly, no leaks." This is the point where the product becomes uniquely valuable vs Roll20/Foundry.

**Delivers:**
- Fog state storage (per-session, per-scale in PostgreSQL)
- Fog layer rendering (texture-based with composite cutouts, not per-hex entities)
- DM reveal/hide tools (click hex, batch reveal adjacent)
- Role-filtered broadcasting (players receive content ONLY when fog lifts)
- Two-stage reveal (terrain first, then details—HEXROLL pattern)

**Uses:** PixiJS layered canvas (Phase 1), role-based auth (Phase 2), WebSocket rooms (Phase 3)

**Implements:** Map Engine (fog mutations), Role Filter (security boundary)

**Addresses:** Fog of war (table stakes), hex content reveal (table stakes), two-stage reveal (differentiator)

**Avoids:** Pitfall #1 (fog positional drift), #5 (DM state leaking), #6 (fog rendering performance collapse)

**Research flag:** HIGH—fog is the hardest feature, multiple architectural decisions (texture vs geometry, coordinate storage, performance optimization). Likely needs `/gsd:research-phase` for fog rendering optimization and coordinate transform chain.

---

#### Phase 5: Tokens + Real-Time Movement
**Rationale:** Tokens are the primary player interaction with the map. They require fog awareness (tokens in fog are hidden from players). Movement validation (is destination revealed? is it their token?) exercises the role filter built in Phase 4.

**Delivers:**
- Token rendering layer (PixiJS sprites, draggable)
- Drag-and-drop movement with snap-to-hex
- Server-validated position updates (is destination valid? revealed?)
- Real-time broadcast of token positions to all players (filtered by fog)
- Party token (single marker) vs individual tokens (toggle)

**Uses:** Token Layer (canvas), Map Engine (position validation), WebSocket broadcast (Phase 3)

**Addresses:** Token placement (table stakes), token movement (table stakes)

**Avoids:** Security mistake (client-authoritative positions—must be server-validated)

**Research flag:** SKIP—standard drag-and-drop with server validation, documented patterns

---

#### Phase 6: Map Image Upload + Background Layer
**Rationale:** Map images are a visual upgrade but not structurally necessary—hex grid is functional without images. Can be deferred if needed. However, "upload custom map" is high user value (DMs have existing maps) and unlocks real-world testing.

**Delivers:**
- Image upload via presigned S3 URLs (direct client → S3, not proxied through server)
- Server-side image processing (sharp): resize, generate thumbnails, tile pyramids for large maps
- Background layer rendering (map image behind hex grid)
- DM tools: image positioning/scaling, grid overlay alignment

**Uses:** S3-compatible storage (@aws-sdk/client-s3), sharp (image processing), Background Layer (canvas)

**Addresses:** Upload map images (table stakes)

**Avoids:** Pitfall #4 (canvas memory exhaustion), integration gotcha (client-side image processing)

**Research flag:** MODERATE—tile pyramid generation and viewport-based tile loading need implementation research if map images regularly exceed 4096px

---

#### Phase 7: Hex Content + Encounter Tables + Dice
**Rationale:** Content management is DM tooling that layers on top of the working map. Encounter tables are campaign-specific configuration. This phase makes the tool useful for running actual sessions, not just revealing fog.

**Delivers:**
- Hex content CRUD (terrain types, notes, POIs, encounter refs)
- Terrain painting tool (DM clicks/drags to assign terrain)
- Encounter table configuration (per-terrain-type, DMG dice expressions)
- Dice rolling engine (d6, d8, d12, d20, d100)
- Encounter check triggered by DM or movement
- Content markers layer (icons for towns, dungeons, etc.)

**Uses:** Map Engine (hex content), Session Manager (encounter tables), Content Marker Layer (canvas)

**Implements:** Encounter table and dice services

**Addresses:** Hex content/notes (table stakes), terrain types (table stakes), encounter tables (differentiator), weather generation (P2), travel/time tracking (P2)

**Avoids:** Pitfall #8 (encounter table edge cases—needs 200-roll testing)

**Research flag:** LOW—encounter table dice mechanics are well-documented (Alexandrian framework, DMG)

---

#### Phase 8: Campaign Management + Session Lifecycle
**Rationale:** DM can run sessions with direct URL sharing initially. Full campaign management (creation/browsing, invite codes, session start/end, player roster, DM transfer) is quality-of-life. By Phase 8, core features validated, this adds production polish.

**Delivers:**
- Campaign creation/browsing UI (React components)
- Invite code generation and acceptance
- Session lifecycle (start/end, player roster management)
- DM transfer (ownership change)
- Session URL sharing (HEXROLL pattern—players join with link, no account required)

**Uses:** Auth (Phase 2), React UI, Session Manager

**Addresses:** Campaign persistence (table stakes), session URL sharing (differentiator)

**Research flag:** SKIP—standard CRUD UI, documented patterns

---

#### Phase 9: Polish + Production Readiness
**Rationale:** Polish depends on all features being stable. Reconnection edge cases, error recovery, performance optimization, deployment pipeline. This makes the product reliable enough for real DM sessions.

**Delivers:**
- Reconnection edge case handling (mid-fog-reveal disconnect, etc.)
- Error recovery (server crash → state reload from DB)
- Performance optimization (tile caching, lazy loading, layer pre-rendering)
- Responsive UI (desktop-first, tablet-usable player view)
- Deployment pipeline (Docker, Coolify config, SSL, WebSocket proxy)
- "Looks done but isn't" checklist validation (see PITFALLS.md)

**Addresses:** Connection status indicator, fog reveal animation, zoom transition smoothness (UX pitfalls)

**Avoids:** All "looks done but isn't" items (fog persistence across sessions, reconnection handling, mobile testing, DevTools audit, crash recovery)

**Research flag:** MODERATE—Coolify deployment with WebSocket support needs configuration research

---

### Phase Ordering Rationale

- **Hex math must be first**: Migration from wrong coordinate system is 2-4 weeks HIGH cost. Get it right day one.
- **Server before WebSocket**: WebSocket syncs state that must be persisted. Database schema foundational.
- **Fog after both**: Fog is convergence point. Requires canvas (render fog), server (store fog state), WebSocket (sync fog reveals), and roles (filter by player). Cannot start until infrastructure exists.
- **Tokens after fog**: Token visibility depends on fog state. Tokens exercise the role filter built for fog.
- **Content/encounters after core loop working**: No point configuring encounters if exploration loop broken.
- **Multi-scale zoom deferred to v2+**: VERY HIGH complexity (coordinate mapping, influence radius, content bleed). Strongest differentiator but also highest risk. Validate core loop first. If core loop fails, multi-scale doesn't save it.

**Dependency chain:**
```
Phase 1 (Hex Math) → Phase 2 (Server) → Phase 3 (WebSocket) → Phase 4 (Fog) → Phase 5 (Tokens)
                                                                   ↓
                                          Phase 6 (Map Images) ←─┘
                                                                   ↓
                                          Phase 7 (Content/Encounters)
                                                                   ↓
                                          Phase 8 (Campaign Mgmt)
                                                                   ↓
                                          Phase 9 (Polish)
```

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 4 (Fog of War):** Complex integration. Needs research on fog rendering optimization (texture-based compositing, separable blur), coordinate transform chain (avoiding positional drift), and performance profiling at scale (1000+ hexes). Recommend `/gsd:research-phase` for fog implementation patterns.
- **Phase 6 (Map Images):** If supporting very large maps (>4096px), needs research on tile pyramid generation strategies and viewport-based tile loading. Canvas memory limits vary by browser/device.
- **Phase 9 (Production):** Coolify deployment with WebSocket requires Traefik reverse proxy config for WSS. Needs infrastructure research.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Hex Math):** Red Blob Games is definitive. honeycomb-grid proves the patterns. No unknowns.
- **Phase 2 (Server):** CRUD + auth is well-documented. Hono, Drizzle, Better Auth all have clear docs.
- **Phase 3 (WebSocket):** Socket.IO room patterns documented. Reconnection with sequence numbers is standard pattern (Twitch, websockets library, Ably all document this).
- **Phase 5 (Tokens):** Drag-and-drop with server validation is standard. PixiJS interaction events well-documented.
- **Phase 7 (Encounters):** Dice mechanics well-documented (Alexandrian, DMG). Encounter table data structures straightforward.
- **Phase 8 (Campaign):** Standard CRUD UI. No unknowns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm registry 2026-01-26. PixiJS v8, React 19, Hono 4, Socket.IO 4, Better Auth 1.4, Drizzle 0.45, honeycomb-grid 4.1 all confirmed. Official docs consulted for PixiJS, Hono, Better Auth. Version compatibility verified (@pixi/react 8 requires React 19 exactly). |
| Features | MEDIUM | Based on survey of existing products (Foundry modules, Roll20, Owlbear Rodeo, HEXROLL, Worldographer) and community discussions. No single authoritative source for "hex crawl exploration tool" as standalone product category. Table stakes vs differentiators derived from competitive analysis and user complaints (Roll20 fog is bad, Foundry requires modules). MVP boundary clear. |
| Architecture | MEDIUM-HIGH | Foundry VTT provides production VTT reference architecture (layered PixiJS canvas, server-authoritative state). Riot Games and Figma provide real-time multiplayer patterns. Red Blob Games provides hex coordinate system authority. All major patterns have precedent. Multi-scale zoom has limited precedent (Worldographer does child maps but not seamless zoom). |
| Pitfalls | HIGH | Seven critical pitfalls extracted from Foundry VTT issue tracker (6+ fog-related architectural bugs: #6983, #8581, #7231, #8122 + release notes for 0.5.0, 0.7.5) and Riot Games engineering blog (fog rendering performance). Canvas memory limits documented by PQINA and Trailhead. WebSocket reconnection patterns from Ably, Twitch, websockets library. All pitfalls have confirmed real-world occurrence + documented mitigation. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Multi-scale zoom implementation details**: Coordinate mapping between scales (continent/region/local) has clear theory (Red Blob Games, H3 hierarchical hex) but limited production examples. Worldographer does 3-level child maps but they are disconnected views, not seamless zoom. When implementing Phase 10+ (v2), likely needs dedicated research on hierarchical hex coordinate systems and zoom transition UX.

- **Fog rendering performance at extreme scale**: Research provides clear patterns (texture-based, viewport culling, separable blur) but actual FPS targets at 1000+ hexes will need profiling with real PixiJS implementation. Foundry VTT and Riot Games provide mitigation strategies, but each rendering engine has different performance characteristics. Plan to profile early in Phase 4.

- **Encounter table balance and mechanics**: Alexandrian framework provides procedural structure, but encounter table design is campaign-specific and system-specific (5e vs OSR vs PF2e have different encounter math). The tool can provide dice mechanics and terrain-aware generation, but encounter *content* and difficulty tuning is DM responsibility. Not a technical gap, but a product scope clarification: the tool is system-agnostic, DM configures tables for their system.

- **Mobile/tablet experience boundaries**: Research indicates desktop-first is correct (precision hex interaction requires mouse/trackpad), but player view "should be usable on tablet" is underspecified. During Phase 9, needs UX research on what "usable" means: view-only + token drag? Or also fog reveal for DM on tablet? Recommend scoping to "player view-only on tablet, DM requires desktop" initially.

## Sources

### Primary (HIGH confidence)
- npm registry (direct CLI queries) — all version numbers verified 2026-01-26
- [Red Blob Games: Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/) — definitive hex coordinate system reference, algorithms, pixel mapping
- [PixiJS v8 launch blog](https://pixijs.com/blog/pixi-v8-launches) — architecture, WebGPU support, performance claims
- [PixiJS React v8 announcement](https://pixijs.com/blog/pixi-react-v8-live) — React 19 exclusive, extend API
- [Foundry VTT Canvas Layers](https://foundryvtt.com/article/canvas-layers/) — production VTT architecture using PixiJS layered canvas
- [Foundry VTT API: Canvas](https://foundryvtt.com/api/classes/foundry.canvas.Canvas.html) — Canvas group hierarchy and rendering pipeline
- [Foundry VTT issue #6983: Fog of War positional drift](https://github.com/foundryvtt/foundryvtt/issues/6983)
- [Foundry VTT issue #8581: Fog rendering performance](https://github.com/foundryvtt/foundryvtt/issues/8581)
- [Foundry VTT Release 0.5.0 - Vision and Fog Overhaul](https://foundryvtt.com/releases/5.63)
- [Riot Games: A Story of Fog and War](https://technology.riotgames.com/news/story-fog-and-war) — fog rendering optimization, separable blur
- [Hono official docs](https://hono.dev) — WebSocket support, TypeScript inference
- [Better Auth documentation](https://www.better-auth.com) — framework-agnostic auth
- [Vite 7 announcement](https://vite.dev/blog/announcing-vite7) — Node.js requirements, breaking changes
- [Tailwind CSS v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4) — Oxide engine, CSS-first config
- [Sharp official docs](https://sharp.pixelplumbing.com/) — API, performance claims
- [Coolify documentation](https://coolify.io/docs/applications/) — deployment, WebSocket config, SSL

### Secondary (MEDIUM confidence)
- [Honeycomb hex grid docs](https://abbekeultjes.nl/honeycomb/) — API, rendering examples
- [Canvas engine benchmarks](https://github.com/slaylines/canvas-engines-comparison) — PixiJS vs Konva vs raw Canvas FPS
- [Better Auth vs NextAuth comparison](https://betterstack.com/community/guides/scaling-nodejs/better-auth-vs-nextauth-authjs-vs-autho/)
- [Drizzle vs Prisma 2026](https://medium.com/@thebelcoder/prisma-vs-drizzle-orm-in-2026-what-you-really-need-to-know-9598cf4eaa7c)
- [Hono vs Express comparison](https://khmercoder.com/@stoic/articles/25847997)
- [Socket.IO vs WebSocket guide](https://velt.dev/blog/socketio-vs-websocket-guide-developers)
- [Zustand vs Jotai performance guide](https://www.reactlibraries.com/blog/zustand-vs-jotai-vs-valtio-performance-guide-2025)
- [TanStack Query + WebSocket integration](https://blog.logrocket.com/tanstack-query-websockets-real-time-react-data-fetching/)
- [The Alexandrian: Hexcrawl series](https://thealexandrian.net/wordpress/17308/roleplaying-games/hexcrawl) — definitive hex crawl framework
- [Worldographer: How Map Levels Work](https://worldographer.com/instructions/how-map-levels-work/) — multi-level/child map documentation
- [HEXROLL 2E](https://hexroll.app/) — procedural hex sandbox with built-in VTT
- [Owlbear Rodeo: Fog documentation](https://docs.owlbear.rodeo/docs/fog/)
- [Roll20 community: Fog of War on hex maps](https://app.roll20.net/forum/post/10529444/fog-of-war-on-hex-map-deserves-some-tough-love) — user complaints
- [Ably: WebSocket Architecture Best Practices](https://ably.com/topic/websocket-architecture-best-practices)
- [Hathora: Scalable WebSocket Architecture](https://blog.hathora.dev/scalable-websocket-architecture/)
- [MDN: Optimizing Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [web.dev: Improving HTML5 Canvas Performance](https://web.dev/canvas-performance/)
- [PQINA: Total Canvas Memory Use Exceeds the Maximum Limit](https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit)
- [Trailhead: Safely Process Images](https://trailheadtechnology.com/safely-process-images-in-the-browser-without-memory-overflows/)
- [H3: Uber's Hierarchical Hex Grid](https://h3geo.org/docs/core-library/coordsystems/) — multi-resolution hex coordinate system
- [Figma: How multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

### Tertiary (LOW confidence)
- [MiniVTT GitHub](https://github.com/SamsterJam/MiniVTT) — lightweight VTT reference, small project
- Various community forums (RPG PUB, EN World) for hex crawl preferences and discussion

---
*Research completed: 2026-01-26*
*Ready for roadmap: yes*
