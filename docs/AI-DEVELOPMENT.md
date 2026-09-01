# AI-assisted development guide

How AI sessions (Claude Code, opencode, or similar) work on this repo. Read this
before making changes; update it whenever you learn something the hard way.
Architecture background: [DESIGN.md](./DESIGN.md).

## Workflow

- Work on a feature branch, one GitHub issue per branch/PR where possible.
  Branch names: `issue-<n>-<slug>` (or the session's worktree branch).
- Before opening a PR: `pnpm typecheck && pnpm test` must pass from the repo
  root. Add server/shared tests for new mechanics (see
  `packages/server/src/server.test.ts` for the dispatch-based test harness).
- PRs reference their issue (`Closes #n`). Small, reviewable, self-contained.
- Keep this file and DESIGN.md current: new subsystems, new gotchas, new
  process. Docs changes ride along in the PR that motivated them.
- If an issue needs a human decision (asset licensing, external accounts,
  destructive migrations), post a comment on the issue explaining the options
  and move on to the next issue.

## Architecture in one page

pnpm monorepo, three workspaces:

- **`packages/shared`** — zod schemas are the single source of truth:
  `domain.ts` (state types), `protocol/commands.ts` (client→server WS
  commands, discriminated union), `protocol/events.ts` (server→client),
  `hex/` (axial coords, superclusters, directions), `rules/`
  (`filter.ts` = **the** security boundary, `gates.ts`, `dice.ts`).
- **`packages/server`** — Hono HTTP + raw `ws`. `state/runtime.ts`
  (`CampaignRuntime`: all campaign state in memory, write-through to SQLite —
  better-sqlite3, synchronous, no ORM), `ws/handlers.ts` (one handler per
  command), `ws/hub.ts` (connections + snapshot sync), `engine/*` (fog,
  knowledge, trails, encounters), `db/index.ts` (schema; additive migrations
  only via `ensureColumn`), `http/app.ts` (REST, join/auth, integration API,
  static client).
- **`packages/client`** — React 19 + Vite + Tailwind 4 + zustand
  (`stores/session.ts` = server snapshot, `stores/ui.ts` = local view state)
  + PixiJS 8 (`engine/CanvasEngine.ts`, a plain class subscribed to the
  stores). `ws.ts` sends commands / applies snapshots and toasts.

**The one big idea:** there are no incremental state updates. Every mutation
dispatches a command; after the handler runs, the hub rebuilds full campaign
state per viewed map and sends each connection a snapshot filtered by
`filterStateForViewer`. `event` messages are ephemeral UX (toasts) only.
You almost never write broadcast code — mutate state in the runtime, and the
snapshot machinery handles delivery. Anything player-visible MUST be filtered
in `filterStateForViewer` (pure, unit-tested — add cases there for new
player-facing data).

## Adding a feature: the standard shape

1. Schema: add/extend zod types in `shared/src/domain.ts`; new command in
   `shared/src/protocol/commands.ts` (+ register in the union).
2. Persistence: column via `ensureColumn` in `db/index.ts` (additive only) or
   reuse a JSON blob column (campaign `settings`, map `encounter_check`,
   `grid_style` — zod defaults make JSON-column additions migration-free).
3. Server: handler in `ws/handlers.ts` (auth check first — `requireDm(ctx)`
   or ownership), runtime mutation + write-through in `state/runtime.ts`.
4. Filter: decide what players see in `shared/src/rules/filter.ts`.
5. Client: send via `send({kind: ...})`; render from the snapshot.
6. Tests: `server.test.ts` (dispatch commands, assert runtime + filtered
   views), `shared/src/rules/rules.test.ts` for pure rules.

## Gotchas that repeatedly bite

- **zod v4 `.partial()` re-applies `.default()`s** — patch schemas must be
  declared default-free or a one-field patch resets its siblings.
- **zod `.default()` makes fields required in `CommandInput`** (the inferred
  input type), so adding a defaulted field to a command breaks every client
  `send(...)` call site until they pass it.
- **Positional SQL in `createMap`/`updateMap`** (`runtime.ts`): adding a map
  column means updating the CREATE TABLE, `ensureColumn`, the load mapping,
  and BOTH statements' argument lists — they desync silently. Prefer JSON
  blob columns for new map settings.
- **Map settings inheritance is propagation-on-write** (#60): a map field named
  in `MapInfo.inheritedFields` follows `campaign.settings.mapDefaults`, but the
  map still stores a concrete value. `campaign.update` propagates changed
  defaults (`runtime.propagateMapDefaults`), `map.update` drops any patched
  field from `inheritedFields`, `map.setInherit` toggles one field. Add a new
  shareable setting to `INHERITABLE_MAP_FIELDS` + `MapDefaultsSchema` (shared
  `domain.ts`) and everything else follows; nothing resolves inheritance at
  read time.
- **Pixi v8 hit-testing:** any Graphics whose geometry covers the pointer
  terminates the hit search even when non-interactive. Every engine layer
  except `tokensC` must have `eventMode = 'none'` — new layers go in that
  list in `CanvasEngine.init` or tokens become undraggable.
- **Engine diff caches:** `contentsEqual`/`markersEqual`/etc. compare explicit
  field lists. Adding a field to a rendered type requires extending the
  comparator or the canvas won't redraw on that field's changes.
- **Stale `packages/*/dist`** gets picked up by vitest as duplicate test
  files — `rm -rf packages/*/dist` if counts look wrong.
- **Log visibility:** entries carry `visibility: 'dm' | 'all' | <seatId>`.
  Player-visible 'all' roll entries are additionally filtered per character
  (players only see rolls their own character made) — mirror any snapshot
  filter change in the live-toast targeting in `handlers.ts`.
- **Prep mode** (`settings.pausePlayerMapSync`) freezes editable map layers
  for players via an in-memory snapshot in `CampaignRuntime`
  (`capturePlayerFreeze`) — recaptured at boot. New player-visible map-layer
  data should be added to `FrozenMapLayers` or it will leak during a pause.
- **Seat cookies are per-hostname.** To run a DM and a player session against
  one dev server, open one on `localhost` and one on `127.0.0.1` — separate
  cookie jars.
- In DEV builds the page exposes `window.__engine` (CanvasEngine) and
  `window.__send` (WS sender) — the fastest way to drive/verify from a
  browser console. Production builds do not.
- **New campaign column = two-place edit**: `CampaignRuntime`'s constructor
  row type is inline; add the column there as optional (`time?: string |
  null` style) so `Store.getCampaign`'s explicit row type still assigns.
  JSON blob + `ensureColumn` + `Schema.parse(safeJson(...))` is the proven
  pattern (see `campaign.time`).
- **Growing `CampaignSettingsSchema`/`MapStateSchema` breaks the typed
  `fullState()` fixture** in `shared/src/rules/rules.test.ts` (it's a typed
  literal, not a parse) — the typecheck error points straight at it.
- **`filterStateForViewer` builds a hand-written literal per map layer** — a
  new `MapState` field won't compile until you add it to the player branch.
  That's the intended forcing function: you must decide player visibility.
- **New log `kind` strings** just need `KIND_META` + `FILTERS` entries in
  `LogTab.tsx`; unknown kinds render with a `·` fallback.
- **Marker stickers** (`client/src/stickers.ts`, issue #67): the catalogue is a
  hand-maintained list next to `import.meta.glob('./assets/stickers/**/*.svg')`,
  so a new icon is *two* edits — drop the SVG in
  `assets/stickers/<category>/`, add its `{ id, name }` row, and record its
  upstream author in `assets/stickers/ATTRIBUTION.md` (CC BY 3.0 requires it;
  the README links that file). Vendored SVGs are normalized to a single
  `viewBox="0 0 512 512"` root with `fill="currentColor" color="#fff"` — the
  `color` attribute is what makes them render white in an `<img>` and in Pixi's
  SVG rasterizer, which has no CSS context. Vite inlines the small ones as
  `data:` URLs; `Assets.load` handles those, so don't assume an emitted file.
  `Marker.icon` wins over `Marker.glyph` at render time and `glyph` stays the
  fallback, so keep sending a glyph when placing a sticker.
- **Move-handler ordering**: post-move hooks (auto encounters, clock) run
  after `executePartyMove`; the clock credits the departed hex *before*
  advancing, so lingering time lands on the hex and travel time on neither.
- CI (`.github/workflows/ci.yml`) runs typecheck + test on PRs; pnpm is
  pinned there and in the Dockerfile — keep the versions in sync.

## Dev & verification

- `pnpm install`, then `pnpm dev` (server :3000, Vite client :5173, both on
  0.0.0.0). `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Full-stack manual test without Vite: `pnpm build`, then run the server with
  `CLIENT_DIST=../client/dist PORT=<port>` — it serves the built client.
- The server binds `PORT` (default 3000); data lives in `DATA_DIR`
  (default `../../data` relative to `packages/server`, gitignored).

## Deployment

The production instance is a Docker container built from this repo
(multi-stage `Dockerfile`; esbuild-bundled server serving the built client).
Deploy artifacts live in `deploy/` (compose file, reverse-proxy example,
RUNBOOK). Operators keep instance specifics (hostnames, volumes, secrets)
outside this repo — see issue #71 for the config contract. Schema migrations
run automatically at boot; deploys are: rsync source → build image →
`docker compose up -d` → check `/api/health`.
