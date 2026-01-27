# Requirements: HexCrawl

**Defined:** 2026-01-26
**Core Value:** Real-time hex crawl exploration with fog of war — the DM controls what players see, and when hexes are revealed, every connected player sees it instantly.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Map Rendering

- [ ] **MAP-01**: Hex grid renders on a canvas with configurable hex sizes
- [ ] **MAP-02**: Each hex displays a terrain type visually (forest, desert, grassland, mountain, water, swamp)
- [ ] **MAP-03**: DM can upload a map image that displays as a background layer beneath the hex grid
- [ ] **MAP-04**: Hex grid overlays transparently on uploaded map images with alignment controls
- [ ] **MAP-05**: User can pan the map by dragging and zoom with scroll wheel
- [ ] **MAP-06**: Hex grid uses axial/cube coordinate system for consistent math

### Fog of War

- [ ] **FOG-01**: DM can reveal or hide individual hexes for players
- [ ] **FOG-02**: Players see an opaque overlay on unrevealed hexes (no content or terrain detail visible)
- [ ] **FOG-03**: When DM reveals a hex, all connected players see it update in real time
- [ ] **FOG-04**: Fog state persists across sessions (previously revealed hexes stay revealed)
- [ ] **FOG-05**: Server never sends unrevealed hex content to player clients

### Hex Content

- [ ] **HEX-01**: DM can attach structured content to any hex (encounters, lore, dungeons, towns, POIs)
- [ ] **HEX-02**: DM can edit or remove hex content at any time
- [ ] **HEX-03**: When a hex is revealed, players see the content the DM has assigned
- [ ] **HEX-04**: DM can selectively control what content details players see per hex
- [ ] **HEX-05**: Hex content supports an influence radius — nearby hexes display proximity effects (e.g., "dead vegetation" near a dragon lair) when revealed
- [ ] **HEX-06**: DM can assign skill check requirements to hex content (e.g., "DC 15 Perception: hidden cave entrance")
- [ ] **HEX-07**: When a player enters a hex with skill checks, the app automatically rolls D20 + skill modifier for each relevant skill
- [ ] **HEX-08**: Skill check rolls and results are visible only to the DM
- [ ] **HEX-09**: DM decides what information to reveal to players based on skill check results

### Real-Time Multiplayer

- [ ] **RT-01**: All map changes (fog reveals, token movement, content updates) propagate to connected users in real time via WebSocket
- [ ] **RT-02**: DM sees the full map with all content and all hexes visible
- [ ] **RT-03**: Players see only revealed hexes and their assigned content
- [ ] **RT-04**: All connected users see all character tokens on the map in real time
- [ ] **RT-05**: Reconnecting clients receive current session state without data loss

### Tokens

- [ ] **TOK-01**: Each player controls their own character token on the map
- [ ] **TOK-02**: Players move their tokens by dragging to adjacent hexes
- [ ] **TOK-03**: Token positions update in real time for all connected users
- [ ] **TOK-04**: Token positions persist across sessions

### Authentication & Campaigns

- [ ] **AUTH-01**: User can create an account with email and password
- [ ] **AUTH-02**: User can log in and maintain a session across browser refreshes
- [ ] **AUTH-03**: DM can create a campaign with a name
- [ ] **AUTH-04**: DM can invite players to a campaign by email
- [ ] **AUTH-05**: Players can accept invitations and join campaigns
- [ ] **AUTH-06**: Campaign state (fog, hexes, tokens, content) persists between sessions automatically

### Character Skills

- [ ] **CHAR-01**: Each player can enter skill modifiers for their character (e.g., Survival +4, Perception +3, Nature +2)
- [ ] **CHAR-02**: Character skill data persists with the campaign

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multi-Scale Maps

- **ZOOM-01**: Multi-scale hex maps with seamless zoom between continent, region, and local hex sizes
- **ZOOM-02**: Consistent player/token positioning across zoom levels
- **ZOOM-03**: Influence radius bleeds across zoom levels (dragon corruption visible at zoomed-out scale)

### Encounter System

- **ENC-01**: DM-configurable encounter tables per terrain type with monster difficulty ratings
- **ENC-02**: Dice rolling per DMG rules with suggested encounters from terrain tables

### Map Editing

- **PAINT-01**: DM can paint terrain types onto hexes with a brush tool

### Travel Mechanics

- **TRAVEL-01**: Travel/time tracking with movement costs per terrain type
- **TRAVEL-02**: Navigation and getting lost mechanics (failed check = silent veer)

### Weather

- **WEATHER-01**: Per-session weather generation affecting travel and encounters

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| AI map processing (text/marker removal) | Too complex for v1; may revisit in future |
| Combat grid / tactical map | Scope explosion — this is an exploration tool, not a combat VTT. DMs use other tools for combat. |
| Character sheet management | D&D Beyond and other tools handle this. We store skill modifiers only. |
| General-purpose dice rolling | Not core to hex exploration. Encounter dice deferred to v2. Skill check rolls are the exception (HEX-07). |
| Chat / messaging system | Users have Discord. Building chat adds significant scope with moderation implications. |
| Voice/video integration | Discord/Zoom do this better. Massive to build and maintain. |
| Mobile native app | Web-first. Desktop for DM tools. Tablet player view is a future consideration. |
| Procedural world generation | Deep rabbit hole. DMs populate hexes manually or import from other tools. |
| Marketplace / content store | Business, not a feature. Requires content pipeline, licensing, payments. |
| System-specific rules automation | Product is system-agnostic. Skill modifiers are generic, not tied to D&D 5e specifically. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MAP-01 | Phase 1 | Pending |
| MAP-02 | Phase 1 | Pending |
| MAP-03 | Phase 6 | Pending |
| MAP-04 | Phase 6 | Pending |
| MAP-05 | Phase 1 | Pending |
| MAP-06 | Phase 1 | Pending |
| FOG-01 | Phase 4 | Pending |
| FOG-02 | Phase 4 | Pending |
| FOG-03 | Phase 4 | Pending |
| FOG-04 | Phase 4 | Pending |
| FOG-05 | Phase 4 | Pending |
| HEX-01 | Phase 7 | Pending |
| HEX-02 | Phase 7 | Pending |
| HEX-03 | Phase 7 | Pending |
| HEX-04 | Phase 7 | Pending |
| HEX-05 | Phase 7 | Pending |
| HEX-06 | Phase 8 | Pending |
| HEX-07 | Phase 8 | Pending |
| HEX-08 | Phase 8 | Pending |
| HEX-09 | Phase 8 | Pending |
| RT-01 | Phase 3 | Pending |
| RT-02 | Phase 3 | Pending |
| RT-03 | Phase 3 | Pending |
| RT-04 | Phase 5 | Pending |
| RT-05 | Phase 3 | Pending |
| TOK-01 | Phase 5 | Pending |
| TOK-02 | Phase 5 | Pending |
| TOK-03 | Phase 5 | Pending |
| TOK-04 | Phase 5 | Pending |
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| AUTH-05 | Phase 2 | Complete |
| AUTH-06 | Phase 2 | Complete |
| CHAR-01 | Phase 8 | Pending |
| CHAR-02 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0

---
*Requirements defined: 2026-01-26*
*Last updated: 2026-01-26 after roadmap creation*
