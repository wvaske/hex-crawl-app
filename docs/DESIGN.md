# HexCrawl VTT — Design

A virtual tabletop purpose-built for running hex crawls in D&D-style TTRPGs. The DM
preps maps and content; players explore in real time. The app automates the tedious
parts of exploration — fog of war, discovery checks, encounter rolls — so the table
can focus on the fiction.

This is a ground-up rebuild of the first prototype (see git history before the
"fresh start" commit). The prototype validated the core loop (fog + tokens + real-time
sync) but accumulated structural debt. This document is the source of truth for the
rebuild; GitHub issues track execution.

## Product experience

### Roles

One app, two experiences, enforced server-side:

- **DM view**: sees everything — full map, all tokens, all content, fog state as an
  editable overlay. Has edit tools (terrain paint, fog brush, markers, content editor),
  the encounter roller, the session log, and per-player knowledge controls.
- **Player view**: sees only what their character knows — revealed hexes, visible
  tokens, shared markers, and the discoveries their character has made. Has their
  character sheet (skills), a journal of discoveries, and control of their own token.

### Zero-friction access

No accounts. A DM creates a campaign and receives two links:

- **DM link** — contains a DM secret; opening it grants the DM role.
- **Player link** — shareable; opening it shows the character roster, and a player
  claims (or creates) a character seat. A signed httpOnly cookie remembers the seat.

Right for personal-group use; role checks still happen on every server command.

### The core loop

1. DM preps: uploads a map image and/or paints terrain, aligns the hex grid, drops
   content into hexes (lairs, ruins, towns, lore) with visibility gates, builds
   encounter tables per terrain.
2. Session: players move tokens hex to hex. Movement drives everything:
   - Fog auto-reveals around tokens (configurable sight radius; DM can also brush).
   - The **knowledge engine** evaluates every content gate against each character's
     passive skills and distance — discoveries are delivered privately to that player
     and logged for the DM.
   - The DM rolls for wandering encounters (or has the app roll on a travel cadence).
3. Everything persists; next session picks up exactly where it left off.

## Feature set (v1)

### Map & grid
- Campaign contains **many maps** (e.g. region map at 24-mi hexes, local map at 1-mi).
  One map is *active* per campaign at a time; DM switches.
- Per-map hex grid: flat-top or pointy-top, hex size, origin offset, grid line
  color/opacity/width. Axial (q,r) coordinates everywhere.
- Background **image layers**: upload PNG/JPG/WebP, scale/offset alignment controls,
  z-order, per-layer DM-only toggle.
- **Terrain painting**: per-hex terrain (plains, forest, hills, mountains, desert,
  swamp, water, tundra, jungle, urban…) with color fill + pattern at configurable
  opacity. Brush paint for the DM. Terrain feeds encounter tables and travel pace.
- Pan (drag) and zoom (wheel/pinch), 60fps with thousands of hexes via culling.
- **Map manager dialog** (DM): every map with a thumbnail, its settings, ordering,
  rename/activate/delete. Shareable settings (sight radius, fog mode/decay, move
  mode/approval, miles per hex, encounter check) have **campaign defaults**
  (`settings.mapDefaults`) that each map either follows or overrides per field
  (`MapInfo.inheritedFields`). Inheritance is resolved *on write*: changing a
  default immediately writes it into every map that follows it, so map values are
  always concrete.

### Fog of war
- Three per-hex states: **hidden** (opaque to players), **explored** (terrain visible,
  dimmed, no dynamic entities), **visible** (full detail).
- DM tools: single-hex toggle, brush radius, reveal-all/hide-all region select.
- Auto-reveal: token movement reveals hexes within the token's sight radius
  (per-map config; can be disabled). Previously-visible hexes decay to *explored*
  when no token sees them (configurable: persistent vs. line-of-presence).
- Server never sends players data about hidden hexes. Ever.

### Tokens
- PC tokens (one per character, movable by the owning player and the DM) and
  DM tokens (NPCs, monsters, party marker) with a player-visible toggle.
- Drag with hex snap; server validates ownership + adjacency rules (configurable
  free-move vs adjacent-step mode).
- Labels, colors, initials or emoji glyphs; size (1 hex default).

### Effect markers
- A curated emoji/glyph marker library (fire, storm, camp, skull, lair, quest,
  danger, treasure, portal, note…), placeable on any hex.
- Each marker: DM-only or player-visible; optional label; optional expiry note.
- Used for weather effects, ongoing hazards, party camp, plot pins, etc.

### Characters & skills
- A character = name, color/glyph, speed, and skill modifiers (Perception, Survival,
  Nature, Arcana, Religion, History, Investigation, Insight, Stealth + custom).
  Passive score = 10 + modifier.
- Owned by a claimed seat; DM can edit all.

### Hex content & the knowledge engine
- **Content** attaches to a hex: type (lair, dungeon, settlement, ruin, landmark,
  lore, hazard, cache), title, DM notes, optional marker glyph.
- Content holds **clues** — units of player-facing information, each with a gate:
  - `auto` — revealed to anyone whose token enters/sees the hex.
  - `skill` — requires passive `skill ≥ DC` (or an active roll, DM-triggered)
    within `maxDistance` hexes. E.g. *"DC 14 Survival within 2 hexes: dead
    vegetation in a widening cone — something poisons this land."*
  - `manual` — DM reveals by hand.
- On every token move (and on gate edits), the server re-evaluates gates for each
  character: distance from that character's token to the content hex, passive skill
  vs DC. Newly-passed gates create **discoveries** — persisted per character,
  delivered privately over WS, and logged in the DM feed with the roll math.
- Active checks: DM can trigger "roll Survival for everyone near hex X" — the server
  rolls d20+modifier per character, results go to the DM, who releases the clue(s).
- Discoveries accumulate in each player's **journal**.

### Encounters
- **Encounter tables**: named, bound to terrain types and/or explicit hex regions;
  entries with dice ranges (e.g. 2d6: 2 = dragon, 3–5 = bandits…), text, and an
  optional quantity roll.
- **Check procedure** (DMG-style): configurable trigger die (e.g. "encounter on
  18–20 of d20"), rolled on demand or automatically per party move / watch.
- Roll results go to the DM privately with the full dice math; DM can then
  narrate/share text to players and/or spawn a token at the party's hex.
- All rolls (encounter + skill) are server-side, seeded RNG, appended to the session log.

### Real-time & persistence
- Single WebSocket per client. Every mutation is a **command** message; the server
  validates (zod + role), applies to SQLite, and broadcasts **events** filtered
  per recipient role/character.
- Reconnect with backoff; on (re)connect the server sends a full role-filtered
  snapshot. Presence indicators for connected seats.
- SQLite database file + uploaded images directory = full campaign state. Trivial
  to back up.

### Session log & journal
- DM feed: every reveal, move, roll, discovery, encounter — timestamped.
- Player journal: their own discoveries and shared narration, grouped by hex.

## Out of scope (v1)

Combat runner, character sheets beyond skills, chat/voice, multi-scale coordinate
linking between maps (maps are independent; the DM switches), procedural map
generation, accounts/multi-tenant hosting hardening, mobile-native.

## Architecture

### Stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces: `shared`, `server`, `client` | proven in prototype |
| Shared | TypeScript + zod | one contract for both sides |
| Server | Node 20+, Hono, `ws`, Drizzle ORM, **better-sqlite3** | zero-infra persistence |
| Client | React 19, Vite, Zustand, Tailwind v4 | proven in prototype |
| Canvas | **PixiJS 8 (plain)** + pixi-viewport | imperative engine class; no @pixi/react |
| Tests | vitest (shared + server logic), Playwright-less manual + browser-pane checks | pure logic gets unit tests |

### Corrections from the prototype

1. **Hex math lives in `shared`** (axial/cube conversion, neighbors, distance, rings,
   range, line) — imported by client rendering and server rules alike. No duplication.
2. **One mutation path.** No REST mutations that side-channel into WS broadcasts.
   REST exists only for bootstrap (campaign fetch, image upload — multipart needs
   HTTP) and upload endpoints dispatch through the same command pipeline.
3. **Command registry, not a switch.** Each WS command is a module:
   `{schema, authorize, apply, broadcast}`. The dispatcher is ~50 lines.
4. **Canvas engine is a class**, owning the Pixi Application, viewport, and layer
   objects (image → terrain → grid → fog → markers → tokens → overlay). It
   subscribes to Zustand stores and applies diffs. React never touches Pixi.
5. **Everything scoped correctly**: fog, tokens, terrain, markers, content are
   per-**map**; characters, seats, tables, log are per-**campaign**.
6. **Player filtering is a pure function** `filterStateForSeat(state, seat)` in
   shared, unit-tested, used for both snapshots and event broadcast.

### Data model (SQLite via Drizzle)

```
campaign      id, name, dmSecret, playerSecret, activeMapId, settings(json), createdAt
seat          id, campaignId, name, kind(dm|player), token(cookie secret), characterId?
character     id, campaignId, name, color, glyph, speed, skills(json {skill: mod})
map           id, campaignId, name, orientation, hexSize, originX/Y, gridStyle(json),
              sightRadius, fogMode, encounterDie(json), sortOrder
image_layer   id, mapId, path, x, y, scale, opacity, z, dmOnly
hex           mapId, q, r, terrain, note?            (sparse: only painted hexes)
fog           mapId, q, r, state(hidden|explored|visible)   (sparse; default hidden)
token         id, mapId, q, r, kind(pc|npc), characterId?, label, color, glyph,
              playerVisible, size
marker        id, mapId, q, r, glyph, label?, dmOnly, createdAt
content       id, mapId, q, r, type, title, dmNotes, glyph?, discovered-marker?
clue          id, contentId, text, gate(json: {kind, skill?, dc?, maxDistance?, mode?})
discovery     id, clueId, characterId, at, how(json roll/derivation)
enc_table     id, campaignId, name, terrains(json), die, entries(json)
log           id, campaignId, at, kind, payload(json), visibility(dm|all|seatId)
```

### WS protocol (shared/zod)

- Client→server: `command` envelope `{id, kind, payload}` — kinds mirror features:
  `token.move`, `fog.set`, `terrain.paint`, `marker.place`, `content.upsert`,
  `clue.reveal`, `check.roll`, `encounter.roll`, `map.update`, …
- Server→client: `snapshot` (on connect), `event` (broadcast diffs, role-filtered),
  `ack`/`error` (per command id), `presence`.

### Directory sketch

```
packages/shared/src/    hex/  protocol/  rules/  (math, schemas, fog+knowledge+dice rules)
packages/server/src/    db/  commands/  ws/  http/  engine/ (knowledge, encounters)
packages/client/src/    engine/ (pixi)  stores/  views/ (dm, player, join)  ui/ (primitives)
data/                   campaign.db, uploads/   (gitignored)
```

## Delivery plan

Tracked as GitHub issues under milestone **VTT Rebuild v1**; each issue lists its
acceptance criteria. Rough order: scaffold → shared foundations → server core →
client shell + canvas → terrain/images → fog → tokens → markers → characters →
content/knowledge → encounters → log/journal → polish → hardening.
