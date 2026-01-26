# Pitfalls Research

**Domain:** Real-time collaborative hex crawl / VTT-style web application
**Researched:** 2026-01-26
**Confidence:** MEDIUM-HIGH (synthesized from Foundry VTT issue tracker, Riot Games engineering blog, Red Blob Games, MDN, and multiple domain-specific sources)

## Critical Pitfalls

### Pitfall 1: Fog of War Positional Drift Under Scene Offsets

**What goes wrong:**
The fog of war bitmap gradually shifts out of alignment with the hex grid as tokens explore the map. This was a confirmed bug in Foundry VTT (issue #6983): saved FogExploration render positions became incorrect when scenes included offset values (shiftX/shiftY). Players see fog edges that do not match hex boundaries, and revealed areas appear to "slide" relative to the map.

**Why it happens:**
Fog state is stored as a texture/bitmap at a fixed coordinate origin. When the underlying map has any offset, padding, or zoom transform applied, the fog texture must be transformed identically. Developers often apply transforms to the map layer but forget to propagate the same transform to the fog persistence layer. The mismatch compounds over time as more fog is revealed.

**How to avoid:**
- Store fog state in the same coordinate space as the hex grid (logical hex coordinates), not in pixel/screen coordinates.
- When rendering fog, derive pixel positions from hex coordinates at render time, never cache pixel positions.
- Write a regression test that applies scene offsets (shiftX, shiftY, zoom) and verifies fog alignment after 50+ reveals.

**Warning signs:**
- Fog edges look correct at default zoom but misalign at other zoom levels.
- Fog "works fine" in development (no offsets) but breaks when real map images are loaded with padding or margins.
- QA reports that fog "drifts" slowly during extended sessions.

**Phase to address:**
Fog of war implementation phase. This must be baked into the fog storage model from the start, not patched later.

---

### Pitfall 2: Choosing the Wrong Hex Coordinate System

**What goes wrong:**
Using offset coordinates (the "obvious" row/column approach) for the hex grid makes algorithms for distance, pathfinding, neighbor lookup, line-of-sight, and multi-scale zoom painfully complex. Every algorithm requires special-casing for odd vs. even rows/columns, and the math breaks when you try to correlate positions across zoom levels.

**Why it happens:**
Offset coordinates map directly to 2D arrays, so they feel natural to developers who think in terms of `grid[row][col]`. But offset coordinates do not support standard vector operations (add, subtract, multiply, divide), which means every hex algorithm needs branching logic. Red Blob Games documents this extensively: "offset coordinates make many algorithms more complex because the underlying arithmetic doesn't preserve properties like distance calculation or rotation."

**How to avoid:**
- Use cube coordinates (q, r, s where q + r + s = 0) for all algorithms.
- Use axial coordinates (q, r) for storage and serialization (since s is derived).
- Never expose offset coordinates in the data model. Convert to/from offsets only at the rendering boundary.
- For multi-scale hex maps, define a hierarchical coordinate system where each zoom level's hex coordinates derive from the parent level via a consistent mathematical transform (e.g., a region hex at zoom level 0 maps to a known set of hexes at zoom level 1).

**Warning signs:**
- Helper functions have `if (row % 2 === 0)` branches.
- Distance calculation between two hexes requires more than a one-liner.
- Porting an algorithm to work at a different zoom level requires rewriting the coordinate math.

**Phase to address:**
Data model / hex grid foundation phase. This is architectural and must be decided before any hex-related code is written.

---

### Pitfall 3: Server-Client State Desync on WebSocket Reconnection

**What goes wrong:**
When a player's connection drops and reconnects, their game state diverges from other players. They miss fog reveals, hex discoveries, or encounter state changes. The reconnecting client either shows stale state or receives a burst of replayed events that arrive out of order, causing visual glitches or logical inconsistencies.

**Why it happens:**
WebSockets have no built-in replay mechanism. The gap between disconnection and reconnection is a blind spot. Without explicit handling, events that occurred during the gap are lost forever. Additionally, there is a race condition window between fetching initial state and establishing the WebSocket connection where events can be missed.

**How to avoid:**
- Implement a server-side event log with monotonically increasing sequence numbers for all state-changing events.
- On reconnection, the client sends its last-seen sequence number; the server replays all events after that number.
- If the gap exceeds the replay buffer (e.g., >500 events), fall back to sending a full state snapshot instead of replaying individual events.
- Use the double-fetch pattern for initial connection: fetch state, connect WebSocket, fetch state again, then replay queued events.
- Implement exponential backoff with jitter for reconnection attempts (start 1s, max 30s) to prevent reconnection storms.

**Warning signs:**
- During development, everything works because the connection never drops on localhost.
- Players report seeing different fog states from each other after one person's connection briefly hiccuped.
- Refresh (full page reload) "fixes" state issues, indicating the reconnection path is broken.

**Phase to address:**
Real-time multiplayer infrastructure phase. The event log and replay mechanism must be part of the WebSocket layer's core design.

---

### Pitfall 4: Canvas Memory Exhaustion from Large Map Images

**What goes wrong:**
When a DM uploads a high-resolution map image (e.g., a 4000x4000px scan at 300 DPI), the browser's canvas memory is exhausted. A 15MB JPEG can consume 800MB+ of uncompressed pixel memory in the canvas. On iOS Safari, this triggers the "Total canvas memory use exceeds the maximum limit" error, rendering the map invisible. On desktop, it causes severe frame drops or tab crashes.

**Why it happens:**
Developers test with small placeholder images during development. Real DMs upload massive, lovingly crafted battle maps. The file size (compressed) gives no indication of the uncompressed bitmap memory required: a 4000x4000px image = 64MB of raw RGBA pixel data per canvas, and the application may have 3+ canvas layers (map, fog, UI overlay).

**How to avoid:**
- Set maximum upload dimensions (e.g., 4096x4096) and reject or resize on the server before delivery to clients.
- Generate multiple resolution tiers server-side (thumbnail, medium, full) and serve the appropriate tier for the current zoom level.
- Never load the full-resolution image into a canvas at once. Use tile-based rendering: slice the image into 512x512 tiles and only render tiles visible in the current viewport.
- On the client, monitor `performance.memory` (Chrome) and implement a tile cache eviction strategy (LRU).
- Use CSS `background-image` on a `<div>` for the static map layer instead of drawing it to a canvas every frame.

**Warning signs:**
- App works fine with placeholder images but crashes with real map scans.
- iOS Safari shows blank canvas with no JavaScript error.
- Memory profiler shows canvas memory growing without bound as the user zooms and pans.

**Phase to address:**
Image handling / map rendering phase. Server-side image processing pipeline must exist before map upload is feature-complete.

---

### Pitfall 5: DM-Only State Leaking to Player Clients

**What goes wrong:**
Hidden hex content, unrevealed encounters, secret notes, or the full map state are sent to all clients and merely hidden in the UI. A player who opens browser DevTools can see the full game state, including unexplored hexes, upcoming encounters, and DM notes. This breaks the core value proposition of fog of war.

**Why it happens:**
It is dramatically simpler to send all state to all clients and filter in the UI. This works for development and demos. The alternative -- server-side filtering of state per role before transmission -- requires maintaining separate state projections for DM and players, which adds complexity to every feature.

**How to avoid:**
- The server must be the authority on what each client can see. Never send unrevealed hex content to player clients.
- Implement a state projection layer on the server that filters outgoing state based on the connected user's role and their current fog-of-war visibility.
- When fog is revealed, the server pushes the newly visible hex content to player clients as a delta event. Before that event, the data does not exist on the client.
- Use a centralized authorization engine rather than scattering role checks throughout the codebase. As one RBAC source notes: "you're not just maintaining the product, you're maintaining a second invisible product called 'the authorization system' and it's leaking into everything."

**Warning signs:**
- The client-side store contains hex data for hexes the player hasn't visited.
- A `console.log(store.getState())` in the browser reveals the full campaign map.
- Developers justify client-side filtering as "temporary" but ship it to users.

**Phase to address:**
Real-time multiplayer / state management phase. The server-side projection model must be the default from day one. Retrofitting is extremely expensive because every feature built on the "send everything" model must be rearchitected.

---

### Pitfall 6: Fog of War Rendering Performance Collapse at Scale

**What goes wrong:**
The fog of war layer becomes a frame-rate killer on large maps. Rendering a per-hex fog overlay for hundreds or thousands of hexes, especially with soft edges or gradient transitions, drops FPS below 10. Blur effects, which make fog look good, are computationally expensive and scale quadratically with resolution.

**Why it happens:**
Developers implement fog as individual graphical entities (one sprite per hex, or one canvas shape per hex). This worked for the 20-hex test map but collapses at 500+ hexes. Additionally, naive blur implementations process every pixel of the fog texture, and doubling the fog resolution quadruples the CPU cost (as Riot Games discovered with League of Legends fog of war).

**How to avoid:**
- Use a single full-screen fog texture (bitmap mask) rather than per-hex entities. Foundry VTT's team chose texture-based over geometry-based fog because it was "very fast, easy to maintain, and scalable."
- Punch holes in the fog using `globalCompositeOperation: 'destination-out'` with pre-rendered hex shapes, not by redrawing the entire fog layer.
- Use separable blur (two-pass, horizontal then vertical) instead of a single-pass Gaussian blur. Riot Games achieved major performance gains with this technique.
- Only re-render the fog when visibility state changes, not every frame. Cache the fog texture and composite it as a static layer.
- For WebGL renderers, use shader-based fog with a visibility texture lookup rather than geometry-based masking.

**Warning signs:**
- Frame rate drops during fog reveal animations.
- FPS is fine with fog disabled but tanks when enabled.
- Performance degrades linearly with map size.

**Phase to address:**
Fog of war implementation phase. The rendering strategy (texture-based vs. geometry-based) must be decided upfront. Switching from geometry to texture later requires rewriting the entire fog system.

---

### Pitfall 7: Multi-Scale Position Inconsistency Across Zoom Levels

**What goes wrong:**
A hex at the "region" zoom level does not consistently correspond to the correct set of hexes at the "local" zoom level. The party icon on the zoomed-out map points to one region, but zooming in places them in a different area. Influence radius (hex content bleeding across zoom levels) produces contradictory information when the coordinate mapping is wrong.

**Why it happens:**
Each zoom level is implemented as an independent map with its own coordinate system, and the "mapping" between levels is done ad hoc or based on pixel positions rather than a formal mathematical relationship. Floating-point rounding during coordinate transforms introduces drift that compounds at each level transition.

**How to avoid:**
- Define a single canonical coordinate system (cube/axial) that is consistent across all zoom levels. Each zoom level is a projection of this canonical space, not an independent space.
- Express the zoom-level relationship as an integer ratio: e.g., one region hex = 7 local hexes (center + 6 neighbors). This keeps the mapping exact and avoids floating-point drift.
- Store all entity positions in canonical coordinates. Derive display positions at render time from the canonical coordinates + current zoom level.
- Write invariant tests: place an entity at canonical coordinates, render at each zoom level, and verify the visual position is consistent.

**Warning signs:**
- "Off by one hex" bugs when transitioning zoom levels.
- Influence radius calculations at different zoom levels produce different results for the same hex.
- Position corrections "feel right" visually but are hardcoded pixel offsets, not derived from the coordinate system.

**Phase to address:**
Hex grid and multi-scale map architecture phase. Must be designed before any zoom-level rendering or inter-level navigation is built.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Send full state to all clients, filter in UI | Faster initial development; single code path for DM and player | Complete rearchitecture needed before launch; information leaks to players via DevTools | Never for a VTT with fog of war. The entire value proposition is information asymmetry. |
| Store fog state as pixel bitmap only | Easy to implement with canvas; direct screen rendering | Cannot derive fog state for different zoom levels or resolutions; breaks on map resize; requires full fog reset on architectural changes (as happened to Foundry VTT across multiple versions) | Only acceptable as MVP if you commit to migrating to hex-coordinate-based fog before multi-scale maps |
| Use offset coordinates for hex grid | Intuitive for developers; maps directly to 2D arrays | Every algorithm requires odd/even branching; distance calculation is complex; cross-scale coordinate mapping breaks | Never. The migration cost is enormous once algorithms are written against offsets. |
| Skip image preprocessing; render uploads as-is | No server-side pipeline needed | Memory crashes on real maps; mobile devices cannot participate; inconsistent experience across devices | Only for prototype/demo with controlled image sizes |
| Polling instead of WebSocket for state updates | Simpler implementation; no connection management | Latency kills the "real-time reveal" experience; scales poorly; battery drain on mobile | Never for a real-time collaborative application |
| In-memory state only (no persistence) | Fast development; no database schema to manage | Campaign state lost on server restart; no session continuity; no crash recovery | First week of prototyping only |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| WebSocket library (e.g., Socket.IO) | Using Socket.IO's default settings, which include polling fallback and bloated protocol overhead | Evaluate whether you need Socket.IO's features. For a controlled environment (modern browsers only), raw WebSocket or a lightweight wrapper like `ws` + reconnecting-websocket may be simpler. If using Socket.IO, disable polling transport. |
| Canvas/WebGL renderer (e.g., PixiJS) | Assuming `@pixi/tilemap` supports hex grids natively; it is designed for rectangular grids and has known issues with offset rendering and layer sort ordering for hex tiles (pixi-tilemap issue #86) | Implement hex rendering as custom PixiJS display objects with manual viewport culling and layer sorting, rather than relying on the rectangular tilemap package |
| Image upload / processing | Processing image conversion (resize, tile, compress) on the client, where device capabilities are unpredictable | Process images server-side where resource parameters are controllable. Generate tile pyramids and multiple resolutions on upload. Deliver pre-processed tiles to clients. |
| Database (campaign persistence) | Storing game state as a single large JSON blob, making partial updates require read-modify-write of the entire blob | Use a normalized schema where hexes, encounters, fog state, and campaign metadata are separate entities. Enable atomic partial updates. |
| Authentication / Authorization | Embedding role checks in every route handler and component, creating an "invisible second product" of authorization logic scattered throughout the codebase | Use a centralized authorization engine (e.g., CASL or custom policy engine) that answers "can this user see this hex?" in one place. UI and API both query the same engine. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rendering every hex every frame | Smooth at 50 hexes, stutters at 200, unusable at 1000 | Viewport culling: only render hexes visible in the current viewport. Use spatial indexing (hash grid aligned to hex grid) for O(1) visibility checks. | >200 hexes visible simultaneously |
| Per-hex fog entities instead of texture mask | Fog layer consumes more GPU/CPU than the map itself | Single fog texture with composite operations to punch holes. Re-render only on visibility change. | >100 fog-covered hexes |
| Canvas state machine thrashing | Frame time dominated by `fillStyle`/`strokeStyle` changes | Batch hex rendering by visual state (unrevealed, revealed, highlighted). Render all hexes of the same state in one pass, then switch state. | >50 state changes per frame |
| Full state broadcast on every change | Network bandwidth spikes; latency increases with campaign size | Use delta/patch updates (JSON Patch RFC 6902). Send only changed fields. Can reduce bandwidth by 80-85%. | >50 simultaneous state properties |
| Loading full-resolution map at all zoom levels | Mobile devices crash; desktop uses 800MB+ for a single map | Tile-based rendering with zoom-appropriate resolution tiers. Evict off-screen tiles from memory (LRU cache). | Map images >2048x2048px |
| Naive blur for fog edges | Quadratic CPU cost with resolution; Safari performance is especially bad | Separable blur (two-pass H+V). Consider pre-baked soft-edge hex shapes instead of real-time blur. Ship without blur initially. | Any blur on a >1024px texture |
| Re-rendering static layers every frame | GPU spinning on unchanged content | Layer canvases: static map on background `<div>` or separate canvas, fog on middle canvas (re-render only on change), UI/tokens on top canvas (re-render per frame). | Always -- even small maps waste battery/GPU |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Client-side fog of war filtering only | Players see full map/encounters in DevTools; game-breaking for any campaign with mystery/exploration | Server-side state projection: unrevealed content never leaves the server until the DM reveals it |
| Role stored in client-controllable location (cookie, localStorage, query param) | Player promotes themselves to DM role by editing a value | Server-side role verification on every WebSocket message and API call. Role comes from the authenticated session, never from the client payload. |
| Broadcasting DM actions to all clients | Players can see when the DM is interacting with hidden hexes, inferring secrets from activity patterns | DM-only events go only to the DM's socket. Player sockets receive only player-visible events. |
| No rate limiting on WebSocket messages | Malicious client floods the server with fake events, corrupting game state or DoS-ing other players | Server-side message rate limiting per client. Validate every incoming message against the sender's role and permissions. |
| Map image URLs are predictable/guessable | Players bookmark or guess URLs to map images for future sessions, seeing content before the DM reveals it | Use signed, time-limited URLs for map image delivery. Generate unique tokens per session. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No connection status indicator | Players do not realize they are disconnected; they think the game is frozen or the DM stopped playing | Prominent connection status badge. When disconnected, overlay the map with a "Reconnecting..." message. Show reconnection countdown. |
| Fog reveal with no animation or feedback | Players cannot tell that new hexes were just revealed; the map "pops" without context | Animate fog dissolution (fade out over 500ms). Briefly highlight newly revealed hexes. This is the core "wow" moment of the product. |
| Zoom level transitions are jarring | Players lose spatial context when switching between region and local views; they cannot tell where they are relative to the larger map | Animate zoom transitions smoothly. Keep a mini-map or breadcrumb showing position in the parent scale. Highlight the corresponding region hex during transition. |
| Encounter tables have no preview or undo | DM rolls an encounter that does not fit the narrative and has no way to reroll or dismiss without the players seeing | Allow DM to "stage" encounter results privately before revealing to players. Provide reroll and dismiss options in the DM view. |
| Map upload gives no progress feedback | DM uploads a 50MB map image, sees nothing happen for 30 seconds, and refreshes the page (losing the upload) | Show upload progress bar. If server-side processing (tiling, resizing) takes time, show a processing indicator. Provide estimated completion time. |
| Hex content density overwhelms at wide zoom | At region scale, every hex tries to show its content (encounters, notes, terrain), creating an unreadable mess | Progressive disclosure: at wide zoom show only terrain type/color. At medium zoom add icons. At close zoom show full detail. Filter layers by zoom level. |

## "Looks Done But Isn't" Checklist

- [ ] **Fog of war:** Often missing persistence across sessions -- verify that closing and reopening the browser shows previously revealed hexes
- [ ] **Fog of war:** Often missing per-player state -- verify that different players can have different revealed hexes (not just one shared fog state)
- [ ] **Real-time sync:** Often missing reconnection handling -- verify by disconnecting wifi for 30 seconds, reconnecting, and checking state consistency
- [ ] **Real-time sync:** Often missing late-joiner state -- verify that a player who joins mid-session sees the correct current state, not the initial state
- [ ] **Multi-scale maps:** Often missing bidirectional consistency -- verify that zooming out then back in returns to the exact same hex, and that entity positions are identical
- [ ] **Map images:** Often missing mobile testing -- verify on an actual iPad/phone, not just a desktop browser with responsive mode
- [ ] **Role-based views:** Often missing DevTools audit -- verify by opening browser DevTools as a player and confirming no hidden hex data exists in memory/network
- [ ] **Encounter system:** Often missing the "boring middle" -- verify that encounter tables produce reasonable results after 50+ rolls, not just the first 5 (checking for duplicates, inappropriate difficulty spikes, and exhausted unique encounters)
- [ ] **Campaign persistence:** Often missing crash recovery -- verify by killing the server process mid-session and restarting; confirm no data loss
- [ ] **Campaign persistence:** Often missing schema migration -- verify that a campaign saved in version N can be loaded in version N+1 without data corruption

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong hex coordinate system (offsets) | HIGH | Must rewrite every algorithm that touches hex coordinates. Create a migration script to convert stored offset coordinates to axial. Expect 2-4 weeks of work depending on codebase size. |
| Client-side fog filtering (data leaks) | HIGH | Requires rearchitecting the state distribution layer. Every feature that sends state must be audited. Server projection layer must be built. Expect 3-6 weeks and regression risk. |
| Fog positional drift | MEDIUM | Fix the coordinate transform chain. Write a migration to re-derive fog state from hex-coordinate-based records (if fog was stored in hex coords) or reset fog (if stored as pixel bitmap). |
| Canvas memory exhaustion | MEDIUM | Build server-side image processing pipeline. Generate tile pyramids. Update client rendering to tile-based. Existing uploaded images must be reprocessed. |
| WebSocket reconnection desync | MEDIUM | Add event sequence numbers to the server. Build replay buffer. Update client reconnection flow. Must test extensively under real network conditions. |
| Multi-scale position inconsistency | HIGH | Requires defining the canonical coordinate system and rewriting all zoom-level code to derive from it. Existing campaign data may need coordinate migration. |
| Fog rendering performance collapse | MEDIUM | Switch from per-entity to texture-based fog. Existing fog state can be migrated by rendering hex-coordinate fog records into a new texture. However, fog reset may be necessary (as Foundry VTT experienced across multiple versions). |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Wrong hex coordinate system | Hex grid foundation / data model | Distance calculation is a one-liner; no odd/even branching in any algorithm |
| Multi-scale position inconsistency | Hex grid foundation / multi-scale architecture | Place entity at canonical coords, render at all zoom levels, verify pixel positions match expected locations |
| Server-client state desync on reconnection | Real-time multiplayer infrastructure | Kill client network for 30s during active fog reveals; reconnect; verify state matches other connected clients |
| DM-only state leaking to players | Real-time multiplayer / state management | Open DevTools as player; search memory and network traffic for any unrevealed hex data |
| Fog of war positional drift | Fog of war implementation | Apply scene offsets and zoom transforms; verify fog edges align with hex boundaries after 50+ reveals |
| Fog rendering performance collapse | Fog of war implementation | Render 1000-hex map with fog; verify >30 FPS on a mid-range laptop |
| Canvas memory exhaustion | Map image handling / rendering pipeline | Upload a 8000x8000px map image; verify no crash on desktop Chrome and iOS Safari; verify memory stays under 500MB |
| Encounter table edge cases | Encounter system design | Roll 200 encounters on a single region table; verify no duplicates of unique encounters, reasonable difficulty distribution, no empty results |
| Campaign data corruption on schema change | Campaign persistence / data model | Save a campaign, change the schema (add a field, rename a field), load the campaign; verify no data loss or corruption |

## Sources

- [Foundry VTT: Fog of War computing bug (issue #6983)](https://github.com/foundryvtt/foundryvtt/issues/6983)
- [Foundry VTT: Improve rendering and performances of fog of war (issue #8581)](https://github.com/foundryvtt/foundryvtt/issues/8581)
- [Foundry VTT: Fog of War framework performance improvements (issue #7231)](https://github.com/foundryvtt/foundryvtt/issues/7231)
- [Foundry VTT: Handle fog reset at WorldCollection level (issue #8122)](https://github.com/foundryvtt/foundryvtt/issues/8122)
- [Foundry VTT Release 0.5.0 - Vision and Fog Overhaul](https://foundryvtt.com/releases/5.63)
- [Foundry VTT Release 0.7.5 - Dynamic Lighting Refactor](https://foundryvtt.com/releases/7.83)
- [Riot Games: A Story of Fog and War](https://technology.riotgames.com/news/story-fog-and-war)
- [Red Blob Games: Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/)
- [MDN: Optimizing Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [web.dev: Improving HTML5 Canvas Performance](https://web.dev/canvas-performance/)
- [Trailhead: Safely Process Images Without Memory Overflows](https://trailheadtechnology.com/safely-process-images-in-the-browser-without-memory-overflows/)
- [PQINA: Total Canvas Memory Use Exceeds the Maximum Limit](https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit)
- [Ably: WebSocket Architecture Best Practices](https://ably.com/topic/websocket-architecture-best-practices)
- [DEV Community: Handling Race Conditions in Real-Time Apps](https://dev.to/mattlewandowski93/handling-race-conditions-in-real-time-apps-49c8)
- [websockets library tutorial: Route & Broadcast with replay](https://websockets.readthedocs.io/en/stable/intro/tutorial2.html)
- [Twitch: Handling WebSocket Events (reconnection model)](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [PortSwigger: Access Control Vulnerabilities](https://portswigger.net/web-security/access-control)
- [Dantas & Baquero: CRDT-Based Game State Synchronization in P2P VR (2025)](https://arxiv.org/abs/2503.17826)
- [pixi-tilemap: Hex rendering offset issue (issue #86)](https://github.com/pixijs/pixi-tilemap/issues/86)
- [PixiJS: Renderers documentation](https://pixijs.com/8.x/guides/components/renderers)
- [The Alexandrian: Hexcrawl Part 4 - Encounter Tables](https://thealexandrian.net/wordpress/17333/roleplaying-games/hexcrawl-part-4-encounter-tables)
- [The Alexandrian: Hexcrawl Errata - Using Encounter Tables](https://thealexandrian.net/wordpress/46498/roleplaying-games/hexcrawl-errata-using-encounter-tables)
- [Game Save Systems: Complete Data Persistence Guide 2025](https://generalistprogrammer.com/tutorials/game-save-systems-complete-data-persistence-guide-2025)
- [Foundry VTT: Introduction to System Development](https://foundryvtt.com/article/system-development/)
- [ag-Grid: Optimising HTML5 Canvas Rendering](https://blog.ag-grid.com/optimising-html5-canvas-rendering-best-practices-and-techniques/)

---
*Pitfalls research for: Real-time collaborative hex crawl / VTT web application*
*Researched: 2026-01-26*
