# MCP server & AI integration

HexCrawl VTT ships a small **MCP (Model Context Protocol) server** —
[`mcp/hexcrawl-mcp.mjs`](../mcp/hexcrawl-mcp.mjs) — that lets any MCP-capable
AI assistant (Claude Code, opencode, a custom agent, ...) create and update
campaign content: locations, clues, trails. It is a thin, dependency-free
wrapper around the app's own `/api/integration/*` REST API, so anything the
MCP server can do, a script or another tool can also do directly over HTTP.

This document covers:

- [What it is, and what it is not](#what-it-is-and-what-it-is-not)
- [Env contract](#env-contract)
- [Registering the server](#registering-the-server)
- [Tool reference](#tool-reference)
- [REST integration API reference](#rest-integration-api-reference)
- [Troubleshooting](#troubleshooting)

For campaign-content safety rules (spoiler hygiene, what an assistant should
never write into a player-visible field), see the companion document:
[`docs/skills/hexcrawl-campaign-assistant.md`](skills/hexcrawl-campaign-assistant.md).
Hand that file to whatever assistant you connect — it is the "how to behave"
half of this integration; this document is the "how to connect" half.

## What it is, and what it is not

- It is a **stdio MCP server**: a single Node process, no install step beyond
  Node itself, no network listener of its own. An MCP client launches it as a
  subprocess and talks JSON-RPC over its stdin/stdout.
- It is **scoped to one campaign**, chosen by the DM key you configure it
  with. It has no way to list campaigns, create a campaign, or touch any
  campaign it doesn't hold the key for.
- It is **DM-equivalent access** to that one campaign's content: it can read
  and write map locations and trails, including DM-only notes. It has no
  access to characters, party position, encounter tables, session logs, or
  campaign settings — the integration API surface is content-only today.
- It is **optional**. The app and every other feature work with no MCP
  server, no wiki, nothing configured. This bridge exists purely so an AI
  assistant maintaining, say, a campaign wiki can mirror content into the map
  without a human re-typing it.
- It does **not** talk to a wiki. If you use MediaWiki (or any wiki) for
  campaign notes, that's a separate integration on the assistant's side —
  this server only knows about HexCrawl's own data.

## Env contract

The MCP server reads three environment variables, all required. Unlike the
app server (`packages/server`), it does **not** read a `.env` file — set
these when you register the server with your MCP client (see below), or
export them in the environment that launches it. They mirror the
`# MCP server` section of [`.env.example`](../.env.example).

| Variable | Required | What it is |
|---|---|---|
| `HEXCRAWL_URL` | yes | Base URL of your HexCrawl instance, e.g. `https://hex-crawl.example.com` or `http://localhost:3000`. No trailing slash needed. |
| `HEXCRAWL_CAMPAIGN` | yes | The campaign id, from the DM link (`.../c/<id>?key=...`) or the Setup tab. |
| `HEXCRAWL_TOKEN` | yes | The campaign's **DM key**. **This is a secret** — anyone holding it has full DM read/write access to the campaign's content, including everything marked DM-only. Treat it exactly like a password: don't commit it, don't paste it into a shared doc, and pass it only through your MCP client's env-var mechanism (never as a CLI arg that ends up in shell history or `ps`). |

If any of the three is missing, the server refuses to start and prints an
actionable message to stderr instead of starting and failing opaquely on the
first tool call — see [Troubleshooting](#troubleshooting).

## Registering the server

The server is a single file: `mcp/hexcrawl-mcp.mjs` in this repo, requiring
only Node ≥ 18 (no `npm install` needed — it has zero runtime dependencies).
`mcp/package.json` exists so it can also be run via `npx`/`node` with a clean
`bin` entry if you copy/vendor the `mcp/` directory elsewhere, but the
simplest setup just points your MCP client at the file's path in a checkout
of this repo.

### Claude Code

```bash
claude mcp add hexcrawl \
  -e HEXCRAWL_URL=https://hex-crawl.example.com \
  -e HEXCRAWL_CAMPAIGN=<campaign id> \
  -e HEXCRAWL_TOKEN=<campaign DM key> \
  -- node /path/to/hex-crawl-app/mcp/hexcrawl-mcp.mjs
```

Verify with `claude mcp list` — `hexcrawl` should show as connected. Remove
with `claude mcp remove hexcrawl`.

### opencode

Add to `opencode.jsonc` (project or global config):

```jsonc
{
  "mcp": {
    "hexcrawl": {
      "type": "local",
      "command": ["node", "/path/to/hex-crawl-app/mcp/hexcrawl-mcp.mjs"],
      "environment": {
        "HEXCRAWL_URL": "https://hex-crawl.example.com",
        "HEXCRAWL_CAMPAIGN": "<campaign id>",
        "HEXCRAWL_TOKEN": "<campaign DM key>",
      },
      "enabled": true,
    },
  },
}
```

### Generic stdio MCP client

Any client that supports launching a local stdio MCP server needs the same
three things: a command (`node /path/to/hex-crawl-app/mcp/hexcrawl-mcp.mjs`),
no arguments, and the three env vars above set in the subprocess's
environment. The server speaks standard MCP JSON-RPC (`initialize`,
`tools/list`, `tools/call`) with no extensions.

Sanity-check it stand-alone before wiring it into a client:

```bash
HEXCRAWL_URL=https://hex-crawl.example.com \
HEXCRAWL_CAMPAIGN=<id> HEXCRAWL_TOKEN=<key> \
node mcp/hexcrawl-mcp.mjs --version   # prints the server version, exits 0

node mcp/hexcrawl-mcp.mjs --help      # usage, works with no env set
```

Running it with no arguments and incomplete env prints the missing-variable
error and exits `1` immediately, without trying to read stdin — that's the
expected failure mode when a client is misconfigured.

## Bootstrap a campaign from a sourcebook map

The fastest way to get a real campaign started. Many published sourcebooks —
on D&D Beyond and other sites — ship each map twice: a **player version**
with no labels, and a **DM version** with every settlement, ruin, and region
named. That pair is exactly what this app wants: the player version becomes
what your players crawl across, and the labeled version is both your DM
reference layer and something a vision-capable AI assistant can read to
populate the whole campaign in one pass.

**One-time setup, in the app:**

1. Create a campaign and open *Build → Maps*. Upload the **player** map,
   then the **labeled** map as a second image layer and mark it **DM only**
   — players see clean art, you see the names.
2. Align the **hex grid** over the art (grid origin + hex size), and leave
   the image layers themselves at their default position and scale. This
   matters: `upsert_location`'s `x`/`y` are raw image pixels, which only
   line up with the world while the image sits at `(0, 0)` scale `1`. Align
   the grid to the image, never the image to the grid.
3. Register the MCP server against this campaign
   ([above](#registering-the-server)) and hand the assistant
   [`docs/skills/hexcrawl-campaign-assistant.md`](skills/hexcrawl-campaign-assistant.md).

**The extraction pass.** Give the assistant the labeled map image file and a
prompt along the lines of:

> Here is the labeled DM version of the map I uploaded. Extract every named
> place — cities, towns, villages, ruins, forts, dungeons, named regions —
> with its pixel position on this image. Classify each one, then create them
> all in my campaign with `upsert_location` (pixel `x`/`y`; pick sensible
> `type`, `scaleVisibility`, `showLabel`, and `knownLocation` — major cities
> are common knowledge, hidden sites are not). When you're done, run
> `generate_settlement_clues` so every settlement can be found by its smoke.

The assistant calls `list_maps` for the map id and grid geometry, upserts
each place with pixel coordinates (the server converts them to hexes), and
one `generate_settlement_clues` call at the end gives every settlement its
smoke/din/smell discovery clues. Upserts match by title case-insensitively,
so re-running the pass refines placements instead of duplicating pins.

**What to expect, honestly:**

- **Placement is good, not perfect.** A vision model estimating label
  positions on a 4000-pixel map is usually within a few hexes. Accuracy
  improves a lot if the assistant works from zoomed crops of the image
  rather than the whole map at once. Budget a cleanup pass afterwards —
  every pin has a *📍 Move* button, so nudging the misses takes minutes,
  and re-running the extraction updates in place.
- **Region footprints stay in-app.** The assistant can create a named
  region's anchor pin ("Fields of the Dead"), but painting its multi-hex
  area is a job for the Region tool's auto-detect (terrain or color match),
  which needs your eyes on the proposal overlay.
- **Respect the source.** Sourcebook maps are licensed for your table's
  use — upload them to your own private instance, don't redistribute them.

## Tool reference

Call `tools/list` for the authoritative, always-current schemas (each
description embeds the coordinate-frame and merge-semantics notes below in
full) — this section is a human-readable summary.

### `list_maps`

No arguments. Returns each map's id, name, `milesPerHex`, and grid geometry
(`hexSize`, `orientation`, `originX`/`originY` — the basis `upsert_location`
uses to convert pixel coordinates to hexes). Every other tool needs a map id
from here.

### `list_locations`

```json
{ "mapId": "4wkAfquT_v" }
```

Returns every location on that map: hex coordinates, type, clues (with
gates), wiki page, and visibility flags. Use it to find a `contentId` for
`delete_location`, or to read a location's current `type` /
`scaleVisibility` / `showLabel` / `enabled` / `knownLocation` before an
update that must preserve them (see the merge-semantics warning below).

### `upsert_location`

Create or update a location, matched to an existing one by **`(mapId,
title)`, case-insensitively** — call it again with the same title (e.g.
after editing a wiki page) and it updates that location instead of creating
a duplicate.

```json
{
  "mapId": "4wkAfquT_v",
  "title": "Grimhollow",
  "x": 812,
  "y": 401,
  "type": "settlement",
  "glyph": "🏘️",
  "wikiPage": "Grimhollow",
  "scaleVisibility": 2,
  "clues": [
    { "text": "Smoke rises from chimneys along the ridge.", "gate": { "kind": "auto" } },
    {
      "text": "Rumor in Waterdeep names Grimhollow as a haven for smugglers.",
      "gate": { "kind": "skill", "skill": "Insight", "dc": 12, "maxDistance": 0, "mode": "passive" },
      "revealsLocation": false
    }
  ]
}
```

**Coordinate frames** — give **either** `x`/`y` **or** `q`/`r`, not both:

- `x`/`y`: pixel coordinates on the raw map image, **the same frame as wiki
  DataMap marker positions**. The server converts these to hex coordinates
  using the map's grid geometry (`hexSize`/`orientation`/`origin` from
  `list_maps`). This is the natural choice when a position is sourced from a
  wiki DataMap.
- `q`/`r`: axial hex coordinates directly — use when you already know the
  hex, e.g. copied from `list_locations`.

**Gate** (on each clue, and on trails — see below) is a discriminated union:

| `kind` | Fields | Meaning |
|---|---|---|
| `auto` | — | Revealed the instant a character's token enters the hex. Default. |
| `skill` | `skill`, `dc`, `maxDistance`, `mode` | Revealed once a character within `maxDistance` hexes has that passive skill ≥ `dc`. `mode: "passive"` (default) evaluates continuously as tokens move; `mode: "active"` instead waits for the DM to trigger a roll. |
| `manual` | — | Never auto-reveals; only a DM action in the app reveals it. |

**Upsert semantics — not uniform, read carefully.** This is the sharpest
edge in the whole API and the thing most likely to surprise a first-time
integrator:

- `dmNotes`, `glyph`, `wikiPage`, `quest`: replaced only if you pass a
  **non-empty** value. An empty string or an omitted field **keeps the
  existing value**.
- `clues`: passing a **non-empty** array **fully replaces** the existing
  clue list. Passing `clues: []`, or omitting `clues` entirely, **keeps the
  existing clues untouched**. There is no way to clear every clue through
  this endpoint — delete and recreate the location, or edit it in the app.
- `type`, `showLabel`, `scaleVisibility`, `enabled`, `knownLocation`: **do
  NOT merge.** Every call sets these to whatever you pass, or to the schema
  default (`type: "landmark"`, `showLabel: false`, `scaleVisibility: 1`,
  `enabled: true`, `knownLocation: false`) if you omit them — **even when
  updating an existing location that had different values.** This is a
  server-side quirk, not intentional design (see
  [Troubleshooting](#troubleshooting) and the note in this PR's description)
  — until it's fixed, updating just the notes on an existing settlement
  will silently reset its type to "landmark" unless you re-pass `type:
  "settlement"` on every call. **Always call `list_locations` first and
  re-pass the current value of these five fields on any update**, unless you
  genuinely want them reset to defaults.

`knownLocation: true` means players always see the pin's name and position
even with zero discoveries (for well-known settlements); its clues stay
gated as normal — players learn *where* it is, not what's *true* about it.
`dmNotes` and any content behind a `manual`/unmet `skill` gate are never
sent to players regardless of this flag.

### `delete_location`

```json
{ "contentId": "VuARZUC4oB" }
```

Permanently deletes a location by id (from `list_locations`). Irreversible.

### `upsert_trail`

Create or update a trail — tracks/spoor players can discover and follow — as
an ordered path of hexes. Matched by **`(mapId, name)`, case-insensitively**,
same upsert-by-title pattern as locations.

```json
{
  "mapId": "4wkAfquT_v",
  "name": "Old King's Road",
  "glyph": "👣",
  "gate": { "kind": "skill", "skill": "Survival", "dc": 13, "maxDistance": 1, "mode": "passive" },
  "cells": [{ "q": 0, "r": 0 }, { "q": 1, "r": 0 }, { "q": 2, "r": -1 }]
}
```

`cells` is the ordered hex path (axial q/r), at least 2 cells. There is
currently no `list_trails`/read endpoint in the integration API — see
[Troubleshooting](#troubleshooting).

### `generate_settlement_clues`

```json
{ "mapId": "4wkAfquT_v" }
```

Auto-generates the standard sensory discovery clues (smoke on the horizon,
road noise, etc.) for every `settlement`-type location on the map that
doesn't already have clues. **Idempotent** — settlements that already have
clues are left alone, so it's safe to call again after adding new
settlements. Returns the count and titles of settlements it touched. Useful
right after bulk-creating settlements with `upsert_location`.

## REST integration API reference

The MCP tools are a thin wrapper over these endpoints
(`packages/server/src/http/app.ts`), campaign-scoped and DM-key-authenticated.
Call them directly from a script or another tool if you don't need MCP.

**Auth:** `Authorization: Bearer <campaign DM key>` on every request. A
missing/wrong key returns `401 {"error": "Unauthorized"}`.

**Base path:** `{HEXCRAWL_URL}/api/integration/campaigns/{campaignId}`

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/maps` | — | List maps + grid geometry. |
| `GET` | `/maps/:mapId/content` | — | List all locations on a map. |
| `POST` | `/content` | `IntegrationContentSchema` (see below) | Upsert by `(mapId, title)`. See merge-semantics warning above. |
| `DELETE` | `/content/:contentId` | — | Delete a location. |
| `POST` | `/trails` | `{mapId, name, glyph?, dmNotes?, gate?, cells}` | Upsert by `(mapId, name)`. |
| `POST` | `/generate-settlement-clues` | `{mapId}` | Generate standard clues for settlements missing them. |

`IntegrationContentSchema` fields: `mapId`, `title`, `x?`/`y?` or `q?`/`r?`,
`type?` (one of `lair`, `dungeon`, `settlement`, `ruin`, `landmark`,
`region`, `lore`, `hazard`, `cache`, `other`), `glyph?`, `dmNotes?`,
`wikiPage?`, `showLabel?`, `scaleVisibility?` (0-2), `enabled?`,
`knownLocation?`, `quest?`, `clues?` (array of `{text, gate?,
indicatesDirection?, revealsLocation?}`).

**The wrong-path-returns-SPA-200 gotcha:** when a build serves the client
(`CLIENT_DIST` set — true of every production deployment), the app falls
back to `index.html` for any unmatched `GET` route so client-side routing
works. That means a **typo'd `GET` integration path** (wrong campaign id
segment, missing `/api/integration` prefix, a route that doesn't exist)
doesn't 404 — it returns **`200` with an HTML page** in the body. If your
integration code, or a script, expects JSON and gets a `200`, don't assume
success: check `Content-Type` (`application/json` vs `text/html`) or that
the parsed body has the shape you expect before treating a `200` as
confirmation. This only affects `GET`; `POST`/`DELETE` to a wrong path either
hits a real 404 JSON handler or a method-not-allowed, since the SPA fallback
only registers a catch-all `GET`. The MCP server itself is not affected — it
always calls known, hardcoded paths — but a hand-rolled integration script
probing paths should know this.

## Troubleshooting

**"fetch failed" (or `ECONNREFUSED`/`ENOTFOUND`) on the first tool call —
env not populated.** If `HEXCRAWL_URL`, `HEXCRAWL_CAMPAIGN`, or
`HEXCRAWL_TOKEN` aren't actually reaching the server process — a typo'd
`-e` flag, an MCP client that silently drops env vars with special
characters, a shell profile that didn't export the variable — the server
used to start fine and only fail once an assistant tried to call a tool,
with an opaque network error that gives no hint the *cause* was
configuration. As of this change, the server checks all three variables at
startup and refuses to start with a specific "missing environment variable"
message instead. If you still see a raw fetch failure, the variables are
present but wrong (bad host/port, firewall, TLS mismatch) — verify with
`curl {HEXCRAWL_URL}/api/health` from the same machine/container the MCP
server runs in.

**`401 Unauthorized` on every call.** `HEXCRAWL_TOKEN` doesn't match the
campaign's current DM key, or `HEXCRAWL_CAMPAIGN` points at a different
campaign than the key belongs to. Re-fetch both from the DM link / Setup tab
— DM keys are not rotated automatically, but a copy-paste across the wrong
campaign is the most common cause.

**Tool calls succeed but the map doesn't seem to update.** The integration
API writes straight into campaign state and schedules a snapshot sync same
as any other command — there's no separate "publish" step. If a DM's browser
doesn't reflect a change, check that the DM is viewing the same `mapId` you
wrote to (campaigns can have multiple maps) and that `enabled` wasn't
accidentally reset to `false` by the merge-semantics quirk above.

**A location's type/visibility keeps reverting.** See the merge-semantics
warning under `upsert_location` above — `type`, `showLabel`,
`scaleVisibility`, `enabled`, and `knownLocation` reset to their schema
defaults on any update that doesn't explicitly re-pass them. Always
`list_locations` first and carry those five fields forward.

**No way to read back a trail, or list existing trails.** The integration
API has `POST /trails` (upsert) but no `GET` to list or read trails back —
unlike locations, which have both `GET /maps/:mapId/content` and `POST
/content`. If you need to know whether a trail with a given name already
exists (rather than relying on upsert-by-name to just do the right thing),
there's currently no way to check via the integration API short of asking a
DM to look in the app. Tracked as a gap for a follow-up, not something this
change fixes (see the PR description).

**Wiki integration is unconfigured and that's fine.** The MCP server and the
`/api/integration/*` endpoints have no dependency on `WIKI_API_URL` /
`WIKI_BOT_USER` / `WIKI_BOT_PASSWORD` from `.env.example` — those are
reserved for a possible future server-side wiki integration and are not read
by any code today. Wiring an assistant to maintain both a wiki and a
HexCrawl map (as described in
[`docs/skills/hexcrawl-campaign-assistant.md`](skills/hexcrawl-campaign-assistant.md))
is entirely the assistant's job, coordinating two separate tools/APIs — the
map side works with zero wiki configuration.
