# HexCrawl VTT

A virtual tabletop purpose-built for hex crawl exploration in D&D-style TTRPGs.
Fog of war, player tokens, effect markers, skill-gated discoveries, and encounter
rolling — real-time for the whole table, with separate DM and player views.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design.

## Quick start

```bash
pnpm install
pnpm dev
```

- Client: http://localhost:5173 (binds 0.0.0.0)
- Server: http://localhost:3000 (binds 0.0.0.0)

Open the client, create a campaign, and you'll get a DM link and a shareable
player link. All state persists in `./data/` (SQLite + uploads).

## Workspace

| Package | Purpose |
|---|---|
| `packages/shared` | Hex math, domain types, zod WS protocol, dice, game rules |
| `packages/server` | Hono + WebSocket server, SQLite (Drizzle), command pipeline |
| `packages/client` | React + PixiJS canvas app (DM and player views) |

## Scripts

```bash
pnpm dev        # run server + client in watch mode
pnpm test       # vitest across packages
pnpm typecheck  # strict TS across packages
pnpm build      # production build
```
