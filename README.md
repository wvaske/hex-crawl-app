# HexCrawl VTT

A self-hosted virtual tabletop purpose-built for **hex crawl exploration** in
D&D-style TTRPGs. Not a generic battle-map tool — it is built around the loop
of travelling an unknown wilderness: fog of war that lifts as the party moves,
clues that surface automatically when a character's passive Perception is good
enough, wandering-encounter tables bound to terrain, and a strict server-side
boundary that means players are never sent information they haven't earned.

One container, one volume, no accounts. The DM shares a link; players open it,
pick a character, and play.

## What it does

- **Fog of war** — auto-reveals around party tokens at a configurable sight
  radius; hexes optionally fade to "explored" once left behind. Fog is a dark
  sheet with per-hex holes cut out, so players physically cannot see under it.
- **Knowledge / clue engine** — attach clues to any hex, each with a gate:
  *auto* (on entry), *skill* (e.g. "DC 14 Perception within 2 hexes", evaluated
  continuously against each character's passive score as tokens move), or
  *manual*. Qualifying players get a private discovery and journal entry; the DM
  gets the full derivation in the log.
- **Trails** — tracks and spoor left behind, discoverable by the same gating.
- **Encounters** — DMG-style wandering-encounter tables (dice range → result,
  optional quantity dice) bound to terrain types; roll trigger die, table entry,
  and quantity in one click, DM-only until you share.
- **Time** — travel and watch tracking that drives encounter checks.
- **Multi-scale hexes** — three hex scales built from 7-hex superclusters
  (H3-style): base (e.g. 6 mi), ×√7 (≈16 mi), ×7 (42 mi). The scale follows your
  zoom, or lock one (travel at 16, search at 6).
- **Maps** — paint 12 terrain types with brushes, or upload a map image and
  align the grid over it. Multiple maps per campaign.
- **Party** — characters with skill modifiers (Perception, Survival, Nature,
  Arcana, Religion, plus custom skills). Players can create and edit their own.
- **Group skill checks, markers, measurement** — d20-per-character checks with
  DM-only results, effect markers (🔥 ⛈️ ⛺ 🐉) that are player-visible or not,
  and a ruler.
- **Real-time for the whole table** over WebSockets, with separate DM and player
  views.

## Screenshots

<!--
TODO: add screenshots. Suggested set, dropped in docs/screenshots/ and linked here:
  1. DM view mid-crawl — painted terrain, fog, party token, content pins.
  2. The same moment from a player's browser, showing how much less they see.
  3. The clue editor with a skill gate (DC / skill / radius).
  4. A wandering-encounter roll in the DM log.
-->

_Screenshots coming soon._

## Quick start

### Docker (one command)

```bash
docker run -d --name hex-crawl \
  -p 3000:3000 \
  -v hexcrawl_data:/data \
  ghcr.io/wvaske/hex-crawl-app:latest
```

Open <http://localhost:3000>, create a campaign, and you're at the DM table.
There are no accounts: the **Setup tab** gives you a private **DM link** and a
shareable **player link**. Players open the player link, enter a name, and claim
a character.

Everything persists in the `hexcrawl_data` volume (SQLite database + uploaded
map images). Back a campaign up by copying that volume; restore it by putting it
back.

### Docker Compose

For a longer-lived deployment — including an optional Caddy reverse proxy that
gets you HTTPS on a real domain automatically:

```bash
curl -O https://raw.githubusercontent.com/wvaske/hex-crawl-app/main/deploy/docker-compose.example.yml
curl -o .env https://raw.githubusercontent.com/wvaske/hex-crawl-app/main/.env.example
docker compose -f docker-compose.example.yml up -d
```

See [`deploy/docker-compose.example.yml`](deploy/docker-compose.example.yml) for
the reverse-proxy block and a backup one-liner. The other files in `deploy/`
(`docker-compose.yml`, `traefik-hex-crawl.yml`, `RUNBOOK.md`) are the
maintainer's homelab deployment — useful as advanced examples, but not the place
to start.

Images are published for `linux/amd64` and `linux/arm64` on every release tag
(`:1.2.3`, `:1.2`, `:latest`) and every push to `main` (`:main`).

## Configuration

All runtime config is environment variables with working defaults — the app runs
with none of them set. Copy [`.env.example`](.env.example) to `.env` and edit;
the server reads it at startup, and real environment variables always take
precedence over the file. **Never commit `.env`.**

| Variable | Default | What it is |
|---|---|---|
| `PORT` | `3000` | TCP port for HTTP + WebSocket. |
| `HOST` | `0.0.0.0` | Bind interface. `0.0.0.0` inside Docker; `127.0.0.1` to accept only local connections behind a host reverse proxy. |
| `DATA_DIR` | `./data` (`/data` in the image) | All persistent state: SQLite db and uploaded images. Back up this directory. |
| `CLIENT_DIST` | unset (`/app/client-dist` in the image) | Path to the built client. When set, the server serves the web UI too; unset means API/WebSocket only (development, where Vite serves the client). |

Optional, for the AI integration bridge (`mcp/hexcrawl-mcp.mjs`) rather than the
app server:

| Variable | Default | What it is |
|---|---|---|
| `HEXCRAWL_URL` | `http://localhost:3000` | Base URL of your instance. |
| `HEXCRAWL_CAMPAIGN` | — | Campaign id, from the DM link. |
| `HEXCRAWL_TOKEN` | — | **Secret.** The campaign DM key — full DM access to that campaign. |

`.env.example` also reserves names for planned integrations
(`WIKI_API_URL`, `WIKI_BOT_USER`, `WIKI_BOT_PASSWORD`, `DATABASE_URL`,
`PUBLIC_URL`); nothing reads them yet.

Per-campaign DM and player join secrets are generated by the app and live in the
database under `DATA_DIR` — they are never configuration.

## Running a hex crawl

**Prep (DM):**

1. **Map** — paint terrain with the 🖌️ tool (12 terrain types, brush sizes
   1/7/19), and/or upload a map image in the *Maps* tab, then nudge the grid
   origin and hex size until the grid lines up.
2. **Party** — create characters in the *Party* tab and enter their skill
   modifiers.
3. **Content** — with the 📖 tool, click a hex to add content (lair, dungeon,
   settlement, ruin, lore…) and give it clues with gates.
4. **Encounters** — build encounter tables in the *Encounters* tab, bound to
   terrain types.

**Play:** drop PC tokens from the *Tokens* tab; players drag their own token and
fog auto-reveals around it. As tokens move, the knowledge engine checks every
clue gate. Roll wandering encounters with one button. Trigger group skill checks,
then reveal clues per character, narrate to everyone, or whisper to one player.
Drop effect markers on hexes, visible to players or DM-only.

**Player view:** only revealed hexes, only visible tokens, only their own
character's discoveries. The server filters every byte a player receives — hidden
content never crosses the wire.

Each location's "Visible at hex scales" setting controls the coarsest scale its
pin appears at: cities and major regions show everywhere, hidden sites only when
searching fine hexes.

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

## Development

Requires Node 22+ and pnpm (via corepack).

```bash
corepack enable
pnpm install
pnpm dev        # server :3000 + Vite client :5173, both on 0.0.0.0
```

```bash
pnpm test       # vitest across packages (hex math, rules, command pipeline)
pnpm typecheck  # strict TS everywhere
pnpm build      # production build
```

State lands in `./data/` (gitignored). To test the full stack without Vite:
`pnpm build`, then run the server with `CLIENT_DIST=../client/dist`.

Two browser sessions against one dev server need two hostnames — seat cookies
are per-hostname, so open the DM on `localhost` and a player on `127.0.0.1`.

### Workspace

| Package | Purpose |
|---|---|
| `packages/shared` | Hex math, domain schemas (zod), WS protocol, dice, game rules, player filter |
| `packages/server` | Hono + `ws`, SQLite (better-sqlite3) write-through state, command pipeline, knowledge/fog/trail/encounter engines |
| `packages/client` | React 19 + PixiJS 8 canvas engine, Zustand stores, DM and player UI |

### Architecture

- **One mutation path.** Every change is a zod-validated WebSocket command. The
  server applies it to SQLite synchronously, then rebroadcasts full,
  role-filtered snapshots (coalesced at ~40ms). There are no incremental
  updates, and no client ever receives unfiltered state.
- **One security boundary.** `filterStateForViewer` in
  `packages/shared/src/rules/filter.ts` is a pure, unit-tested function; it is
  the only thing standing between DM knowledge and a player's browser.
- **Seat auth.** Campaign links carry a role secret; claiming a seat sets an
  httpOnly cookie. Roles are enforced server-side per command.
- **Canvas.** A plain PixiJS 8 engine class subscribed to Zustand — React never
  touches the scene graph.

Full design rationale: **[docs/DESIGN.md](docs/DESIGN.md)**.
Conventions, gotchas, and workflow for AI-assisted contributions (which is how
most of this was built): **[docs/AI-DEVELOPMENT.md](docs/AI-DEVELOPMENT.md)**.

## Integration API + MCP

Other tools — e.g. a DM-companion agent that maintains a campaign wiki — can
manage map locations, trails, and settlement clues through
`/api/integration/campaigns/:id/...` using the campaign DM key as a Bearer
token. `mcp/hexcrawl-mcp.mjs` is a dependency-free stdio MCP server wrapping
that API so any MCP-capable AI assistant can be wired to a deployment in
minutes:

```bash
claude mcp add hexcrawl \
  -e HEXCRAWL_URL=https://hexcrawl.example.com \
  -e HEXCRAWL_CAMPAIGN=<campaignId> \
  -e HEXCRAWL_TOKEN=<dm key> \
  -- node /path/to/hex-crawl-app/mcp/hexcrawl-mcp.mjs
```

Locations can carry a `wikiPage`; players get a "wiki ↗" link on discovered
content (base URL configurable in Setup).

## AI integration

Full setup (env contract, registration for Claude Code/opencode/generic
stdio clients, tool reference, REST API reference, troubleshooting) lives in
**[docs/MCP.md](docs/MCP.md)**. If you're connecting an assistant to
maintain campaign content, also hand it
**[docs/skills/hexcrawl-campaign-assistant.md](docs/skills/hexcrawl-campaign-assistant.md)**
— it covers the knowledge model, spoiler hygiene, and upsert semantics an
assistant needs to avoid leaking DM-only information to players.

## License

**TBD** — a license has not been chosen yet, which means the code is currently
"all rights reserved" by default and nobody else has permission to use, modify,
or redistribute it. This is a maintainer decision that needs making before the
repo is genuinely usable by others.

Worth noting when picking: the choice also governs any bundled art and map
assets, which may want different terms (e.g. code under a permissive or copyleft
software license, art under a Creative Commons license). Contributions are
welcome once this is settled.

### Credits

The map-marker sticker icons are from [game-icons.net](https://game-icons.net),
used under CC BY 3.0 — per-icon authors and licence links are listed in
[packages/client/src/assets/stickers/ATTRIBUTION.md](packages/client/src/assets/stickers/ATTRIBUTION.md).
