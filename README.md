# HexCrawl VTT

A virtual tabletop purpose-built for **hex crawl exploration** in D&D-style TTRPGs.
Fog of war, draggable party tokens, effect markers, DMG-style wandering encounters,
and a knowledge engine that automatically reveals information to players based on
their characters' passive skills and distance — all real-time for the whole table,
with strictly separated DM and player views.

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture and design rationale.

## Quick start

```bash
pnpm install
pnpm dev
```

- Client: http://localhost:5173 — Server: http://localhost:3000 (both bind 0.0.0.0)

Open the client, create a campaign, and you're at the DM table. No accounts:
the **Setup tab** gives you two links — a private **DM link** and a shareable
**player link**. Players open the link, enter a name, and claim a character.

All state lives in `./data/` (SQLite + uploaded images). Back up a campaign by
copying that directory; restore it by putting it back.

## Running a hex crawl

**Prep (DM):**
1. **Map** — paint terrain with the 🖌️ tool (12 terrain types, brush sizes 1/7/19),
   and/or upload a map image in the *Maps* tab, then nudge the grid origin and hex
   size until the grid lines up. Multiple maps per campaign; switch the active map
   from the top bar.
2. **Party** — create characters in the *Party* tab and enter their skill modifiers
   (Perception, Survival, Nature, Arcana, Religion, … plus custom skills).
   Players can also create and edit their own.
3. **Content** — with the 📖 tool, click a hex to add content (lair, dungeon,
   settlement, ruin, lore…). Give it **clues**, each with a gate:
   - **auto** — learned when a character enters the hex
   - **skill** — e.g. *DC 14 Perception within 2 hexes*, evaluated automatically
     against each character's **passive** score as they move (or set to
     *active roll* to keep it under your control)
   - **manual** — only you reveal it
4. **Encounters** — build encounter tables in the *Encounters* tab (dice range →
   result, optional quantity dice), bound to terrain types.

**Play:**
- Drop PC tokens from the *Tokens* tab. Players drag their own token; fog
  auto-reveals around it (configurable sight radius; hexes optionally fade to
  "explored" when left behind).
- As tokens move, the **knowledge engine** checks every clue gate. When a
  character qualifies, that player gets a private discovery toast and journal
  entry; you get the full derivation in the DM log
  (*"passive perception 14 vs DC 14 at 2 hexes"*).
- Roll wandering encounters with one button — trigger die, terrain-matched
  table, entry and quantity rolls, all DM-only until you share.
- Trigger group skill checks (d20 + modifier per character, DM-only results),
  then reveal clues per character, narrate to everyone, or whisper to one player.
- Drop effect markers (🔥 ⛈️ ⛺ 🐉 …) on hexes — visible to players or DM-only.

**Player view:** only revealed hexes, only visible tokens, only their own
character's discoveries. The server filters every byte a player receives —
hidden content never crosses the wire (`filterStateForViewer` in
`packages/shared/src/rules/filter.ts` is the single, unit-tested boundary).

### DM keyboard shortcuts

| Key | Tool |
|---|---|
| `V` | Select / pan |
| `B` | Paint terrain |
| `F` | Fog brush |
| `M` | Marker |
| `C` | Content |
| `R` | Measure |
| hold `Space` | Pan with left-drag in any tool |
| `Esc` | Clear selection / close dialog |

## Workspace

| Package | Purpose |
|---|---|
| `packages/shared` | Hex math, domain schemas (zod), WS protocol, dice, game rules, player filter |
| `packages/server` | Hono + `ws`, SQLite (better-sqlite3) write-through state, command pipeline, knowledge/fog/encounter engines |
| `packages/client` | React 19 + PixiJS 8 canvas engine, Zustand stores, DM and player UI |

```bash
pnpm dev        # server + client in watch mode
pnpm test       # vitest across packages (hex math, rules, command pipeline)
pnpm typecheck  # strict TS everywhere
pnpm build      # production build
```

### Architecture notes

- **One mutation path**: every change is a zod-validated WS command; the server
  applies it to SQLite synchronously and rebroadcasts role-filtered snapshots
  (coalesced at ~40ms). No client ever receives unfiltered state.
- **Seat auth**: campaign links carry a role secret; claiming a seat sets an
  httpOnly cookie. Roles are enforced server-side per command.
- **Canvas**: plain PixiJS 8 engine class subscribed to Zustand — React never
  touches the scene graph. Fog is a dark sheet with per-hex holes cut out, so
  players physically cannot see under it.
