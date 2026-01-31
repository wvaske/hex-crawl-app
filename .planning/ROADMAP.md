# Roadmap: HexCrawl

## Overview

HexCrawl delivers a real-time hex crawl exploration tool for tabletop RPGs where the DM controls fog of war and players explore collaboratively. The roadmap builds from hex grid math and rendering upward through server infrastructure, real-time sync, fog of war (the core differentiator), tokens, map images, hex content, and skill checks. Each phase delivers a complete, testable capability that builds on previous phases, culminating in a production-ready tool for running hex crawl sessions.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Hex Grid Foundation** - Interactive hex grid renders in the browser with pan, zoom, terrain display, and correct coordinate math
- [x] **Phase 2: Server & Authentication** - Users create accounts, DMs create campaigns and invite players, all data persists in PostgreSQL
- [x] **Phase 3: Real-Time Infrastructure** - Connected users receive live updates via WebSocket with role-based filtering and reconnection support
- [x] **Phase 4: Fog of War** - DM reveals and hides hexes; players see only what the DM allows, enforced server-side, synced in real time
- [ ] **Phase 5: Tokens & Movement** - Players move character tokens on the map; all connected users see token positions update in real time
- [ ] **Phase 6: Map Image Upload** - DM uploads custom map images that display as background layers beneath the hex grid overlay
- [ ] **Phase 7: Hex Content Management** - DM attaches structured content to hexes (encounters, lore, dungeons, towns, POIs) with selective reveal and influence radius
- [ ] **Phase 8: Skill Checks & Character Data** - Players set skill modifiers; hex content can require skill checks that roll automatically with DM-only results

## Phase Details

### Phase 1: Hex Grid Foundation
**Goal**: A hex grid renders interactively in the browser -- the user can see hexes with terrain types, pan around, and zoom in/out, all built on correct axial/cube coordinate math that every future feature depends on
**Depends on**: Nothing (first phase)
**Requirements**: MAP-01, MAP-02, MAP-05, MAP-06
**Success Criteria** (what must be TRUE):
  1. User sees a hex grid rendered on a canvas with configurable hex sizes
  2. Each hex displays its terrain type visually (distinct colors/styles for forest, desert, grassland, mountain, water, swamp)
  3. User can pan the map by dragging and zoom with scroll wheel smoothly
  4. Hex grid uses axial/cube coordinate system internally (verified by hovering a hex and seeing its coordinates)
  5. Grid renders at 60 FPS with 500+ hexes visible without jank
**Plans**: 4 plans

Plans:
- [ ] 01-01-PLAN.md -- Scaffold pnpm monorepo, install dependencies, hex math foundation, shared types, Zustand stores
- [ ] 01-02-PLAN.md -- PixiJS canvas setup, runtime terrain textures, sprite-based hex rendering with viewport culling
- [ ] 01-03-PLAN.md -- Terrain generation (seed-and-grow BFS), React UI (side panel, creation dialog, terrain palette)
- [ ] 01-04-PLAN.md -- Hex interaction (hover, select, multi-select), highlight layers, JSON import/export, full integration

### Phase 2: Server & Authentication
**Goal**: Users can create accounts, log in, and DMs can create campaigns and invite players -- all campaign data persists in PostgreSQL across browser sessions
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. User can create an account with email and password, then log in and stay logged in across browser refreshes
  2. Logged-in user (as DM) can create a campaign with a name
  3. DM can invite a player by email; the invited player can accept and join the campaign
  4. Campaign state (any data saved) persists between sessions -- closing and reopening the browser shows the same campaign data
  5. DM and player roles are enforced -- a player cannot access DM-only actions
**Plans**: 4 plans

Plans:
- [ ] 02-01-PLAN.md -- PostgreSQL setup, Hono server scaffold, Better Auth + Drizzle ORM foundation
- [ ] 02-02-PLAN.md -- Application schema (campaign, member, invitation) and campaign CRUD routes with auth middleware
- [ ] 02-03-PLAN.md -- Client auth integration (Better Auth React client, login/signup pages, AuthGuard)
- [ ] 02-04-PLAN.md -- Invitation routes, campaign/invitation UI, end-to-end verification

### Phase 3: Real-Time Infrastructure
**Goal**: Multiple users connected to the same campaign session receive live updates via WebSocket -- the DM sees everything, players see only what their role permits, and reconnecting clients recover without data loss
**Depends on**: Phase 2
**Requirements**: RT-01, RT-02, RT-03, RT-05
**Success Criteria** (what must be TRUE):
  1. When the DM makes a change (e.g., updates campaign data), all connected players see the update appear without refreshing
  2. DM client receives the full, unfiltered session state
  3. Player client receives only role-appropriate state (no DM-only data visible)
  4. A client that disconnects and reconnects receives the current session state without missing any changes that occurred during disconnection
**Plans**: 4 plans

Plans:
- [ ] 03-01-PLAN.md -- WebSocket server setup, session/event DB schema, shared message types, Vite WS proxy
- [ ] 03-02-PLAN.md -- Server-side SessionManager with room tracking, message handlers, event logging
- [ ] 03-03-PLAN.md -- Client WebSocket hook with reconnection, session Zustand store, connection/session UI overlays
- [ ] 03-04-PLAN.md -- Integration wiring: DM session controls, player presence list, end-to-end verification

### Phase 4: Fog of War
**Goal**: The DM controls what hexes players can see -- unrevealed hexes are opaque to players, the DM can reveal/hide individual hexes, and reveals propagate to all players in real time with no content leakage
**Depends on**: Phase 3
**Requirements**: FOG-01, FOG-02, FOG-03, FOG-04, FOG-05
**Success Criteria** (what must be TRUE):
  1. DM can click a hex to reveal or hide it for players
  2. Players see an opaque overlay on unrevealed hexes -- no terrain detail or content visible through fog
  3. When the DM reveals a hex, all connected players see the fog lift on that hex within one second
  4. Fog state persists across sessions -- previously revealed hexes remain revealed after browser close/reopen
  5. Server never sends unrevealed hex content to player clients (verified by inspecting network traffic in DevTools)
**Plans**: 4 plans

Plans:
- [ ] 04-01-PLAN.md — DB schemas (hex_visibility, campaign_hex), WS message extensions, map REST endpoints
- [ ] 04-02-PLAN.md — Server-side fog logic: adjacency computation, persistent reveal/hide, FOG-05 enforcement
- [ ] 04-03-PLAN.md — FogLayer PixiJS rendering: two-tier fog overlays, session store extensions
- [ ] 04-04-PLAN.md — DM fog controls UI, map sync, end-to-end integration and verification

### Phase 5: Tokens & Movement
**Goal**: Each player controls a character token on the map, moves it by dragging to adjacent hexes, and all connected users see every token position update in real time
**Depends on**: Phase 4
**Requirements**: TOK-01, TOK-02, TOK-03, TOK-04, RT-04
**Success Criteria** (what must be TRUE):
  1. Each player has a character token displayed on the hex map
  2. A player can drag their token to an adjacent hex and it snaps to the hex center
  3. When one player moves their token, all other connected users see the token move in real time
  4. Token positions persist across sessions -- closing and reopening the browser shows tokens where they were left
  5. A player can only move their own token, not other players' tokens
**Plans**: 4 plans

Plans:
- [ ] 05-01-PLAN.md — Token DB schema, shared types, WS message definitions
- [ ] 05-02-PLAN.md — Server-side token handlers (move validation, CRUD, broadcasting)
- [ ] 05-03-PLAN.md — Client token store, TokenLayer rendering, token display objects
- [ ] 05-04-PLAN.md — Token drag interaction, move animation, DM creation UI, integration

### Phase 6: Map Image Upload
**Goal**: The DM can upload a custom map image that displays as a background layer beneath the transparent hex grid, with controls to align the grid to the image
**Depends on**: Phase 1
**Requirements**: MAP-03, MAP-04
**Success Criteria** (what must be TRUE):
  1. DM can upload a map image file (PNG/JPG) that appears as the background of the hex map
  2. The hex grid renders as a transparent overlay on top of the uploaded map image
  3. DM has alignment controls to adjust how the hex grid sits on top of the image (offset, scale)
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Hex Content Management
**Goal**: The DM can attach structured content (encounters, lore, dungeons, towns, points of interest) to any hex, edit it at any time, control what players see, and nearby hexes show proximity effects from content with influence radius
**Depends on**: Phase 4
**Requirements**: HEX-01, HEX-02, HEX-03, HEX-04, HEX-05
**Success Criteria** (what must be TRUE):
  1. DM can attach structured content to any hex, choosing from types: encounter, lore, dungeon, town, or point of interest
  2. DM can edit or remove hex content at any time (before and during sessions)
  3. When a hex is revealed, players see the content the DM has assigned to it
  4. DM can selectively control which content details are visible to players per hex (some details hidden even on revealed hexes)
  5. Hex content with an influence radius causes nearby revealed hexes to display proximity effects (e.g., "dead vegetation" description near a dragon lair)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Skill Checks & Character Data
**Goal**: Players enter skill modifiers for their characters; the DM can assign skill check requirements to hex content; when a player enters such a hex, the app automatically rolls and shows results only to the DM
**Depends on**: Phase 7
**Requirements**: HEX-06, HEX-07, HEX-08, HEX-09, CHAR-01, CHAR-02
**Success Criteria** (what must be TRUE):
  1. A player can enter skill modifiers for their character (e.g., Survival +4, Perception +3) and the data persists with the campaign
  2. DM can assign skill check requirements to hex content (e.g., "DC 15 Perception: hidden cave entrance")
  3. When a player enters a hex with skill checks, the app automatically rolls D20 + the relevant skill modifier for each check
  4. Skill check rolls and results are visible only to the DM, not to the player or other players
  5. DM can decide what information to reveal to players based on the skill check results
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8
Note: Phase 6 (Map Image Upload) depends only on Phase 1 and can execute in parallel with Phases 2-5 if desired.

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Hex Grid Foundation | 0/4 | Planning complete | - |
| 2. Server & Authentication | 4/4 | Complete | 2026-01-27 |
| 3. Real-Time Infrastructure | 4/4 | Complete | 2026-01-30 |
| 4. Fog of War | 4/4 | Complete | 2026-01-31 |
| 5. Tokens & Movement | 0/4 | Planning complete | - |
| 6. Map Image Upload | 0/2 | Not started | - |
| 7. Hex Content Management | 0/3 | Not started | - |
| 8. Skill Checks & Character Data | 0/2 | Not started | - |
