# Writing a HexCrawl plugin — agent guide

You are here to add or change a **plugin**: a self-contained folder that gives a
campaign a new sidebar panel (and the server logic behind it) without touching
the core app. Read this whole file first; it is the contract. The core's own
guide is [docs/AI-DEVELOPMENT.md](../docs/AI-DEVELOPMENT.md) — its two
non-negotiable rules (survey other work first; commit and push every change
set) apply to plugin work too.

## What a plugin is, in one paragraph

A plugin is `plugins/<id>/`, **compiled into the build** (real TypeScript, real
React, Tailwind, typechecked against the app). It has a shared `manifest.ts`, a
`server/index.ts` exposing named **actions** (HTTP-callable functions that get a
curated context: storage, wiki, dice, game log), and a `client/index.tsx`
contributing **panels** to the right-hand rail. *Installed* is a build-time fact
(the folder exists); *enabled* is per campaign — the DM flips it in
**Setup → Plugins**, where the manifest's config fields are rendered too.

```
plugins/
  AGENTS.md  README.md  package.json  tsconfig.json  vitest.config.ts
  example-fate-dice/          ← tracked; copy me
  example-letters/            ← tracked; copy me
  <your-plugin>/              ← gitignored unless named example-*
    manifest.ts               id, name, panels, DM config fields
    server/index.ts           defineServerPlugin({ manifest, actions })
    server/<topic>.test.ts    vitest, via createPluginTestBed
    client/index.tsx          defineClientPlugin({ manifest, panels })
```

## Pick your starting point

| You want… | Copy |
| --- | --- |
| A per-character resource or special dice, rolled server-side, shown to the table, optionally appended to a wiki log page | `example-fate-dice` |
| Players fill in a form; each submission becomes its own wiki page plus a line on an index page; private to the sender and the DM | `example-letters` |

Both are small on purpose. Read the one you copy end to end — manifest, server,
client, test — before changing it.

## Where private plugins live (read before creating files)

Everything under `plugins/` except `example-*` is **gitignored**, so a campaign's
own plugins never reach the public repository. That also means a plugin created
only inside this checkout is invisible to git, absent from every other worktree,
and one `git clean` away from gone. So:

1. **Keep the source in the owner's own repository** (e.g. their campaign
   project), one folder per plugin, in a directory such as
   `~/CodeProjects/my-campaign/hexcrawl-plugins/<id>/`.
2. Point the build at it: `HEXCRAWL_PLUGINS_DIR=<that directory>` in the shell
   or the repo's `.env` (several directories: separate with `:`).
3. `scripts/plugins.mjs` — which runs automatically before `dev`, `typecheck`,
   `test`, `build` and `bundle` — **mirrors** each plugin into `plugins/<id>/`
   and drops a `.synced-from` marker there. `pnpm dev` keeps mirroring while it
   runs, so edits hot-reload.
4. **Edit the source directory, never the mirror** (the mirror is overwritten),
   and commit/push in *that* repository.

If the user has not said where their private plugins live, ask once, then set
`HEXCRAWL_PLUGINS_DIR`. If they explicitly want a plugin developed in place
under `plugins/<id>/`, that works (no marker = never overwritten) — but tell
them it is untracked.

`pnpm plugins` lists what the next build will include.
`HEXCRAWL_PLUGINS_SKIP=example-*` leaves folders out (a production instance
usually wants that).

## Step by step

1. **Name it.** The folder name *is* the plugin id: lowercase letters, digits,
   dashes, 2–40 chars (`heroic-surge`). It appears in URLs, storage and
   settings, so renaming later orphans the campaign's data.
2. **`manifest.ts`** — `definePluginManifest({...})`, default export:
   - `id` (must equal the folder name), `name`, `version`, `description`.
   - `panels`: `{ id, icon (one emoji), label (≈8 chars, shown on the rail),
     title, hint (tooltip), roles? }`. Omit `roles` for everyone;
     `roles: ['dm']` for a DM-only panel.
   - `config`: DM-editable fields — `text | textarea | number | boolean |
     select`, each with a `default`. The host renders the form, validates
     (clamps numbers, rejects unknown select values, drops unknown keys) and
     hands your actions a resolved `ctx.config`. Wiki page names, pool sizes and
     toggles belong here, **not** in code.
   - `usesWiki: true` if you write to the wiki — Setup then warns the DM until a
     bot login is stored.
3. **`server/index.ts`** — actions (next section).
4. **`client/index.tsx`** — panels (section after).
5. **`server/<topic>.test.ts`** — at minimum: the happy path, the ownership
   rule, and what a player must *not* see.
6. **Verify**: `pnpm typecheck && pnpm test` from the repo root, then run it
   (`pnpm dev`), enable it in Setup → Plugins, and use the panel as the DM and
   as a player (second seat: open the player link on `127.0.0.1` instead of
   `localhost` — seat cookies are per hostname).

## Server: actions

```ts
import { z } from 'zod';
import { PluginError, actionsFor, defineServerPlugin, wikiEscape, type PluginContext } from '@hexcrawl/server/plugin-api';
import manifest from '../manifest.js';

interface Config { poolSize: number; logPage: string }   // mirrors manifest.config keys
const action = actionsFor<Config>();                       // binds ctx.config's type once

export default defineServerPlugin({
  manifest,
  actions: {
    state: action({ handler: (ctx) => ({ /* what the panel renders */ }) }),
    roll: action({
      input: z.object({ characterId: z.string(), reason: z.string().trim().max(200).default('') }),
      handler: async (ctx, input) => { /* input is typed from the schema */ },
    }),
    reset: action({ dmOnly: true, input: z.object({}), handler: (ctx) => { /* … */ } }),
  },
});
```

Each action is served at
`POST /api/campaigns/:campaignId/plugins/<pluginId>/<actionName>` with a JSON
body. **Before your handler runs the host has already** resolved the campaign,
required a seat (401), checked the plugin is enabled for this campaign (403),
enforced `dmOnly` (403) and parsed the body with your `input` schema (400, naming
the bad field — so put human messages in the schema:
`z.string().min(1, 'Who is it for?')`). Return any JSON-serializable value.
Throw `new PluginError('message', status?)` for expected failures (400 default;
403/404/409/502 available); anything else becomes a logged 500.

### `ctx` — everything a handler gets

| Member | What it is |
| --- | --- |
| `ctx.seat`, `ctx.isDm` | Who is calling: `{ id, role, name, characterId }`. |
| `ctx.character` | The character this seat has claimed, or `null`. |
| `ctx.characters` | Every character in the campaign. |
| `ctx.requireCharacterAccess(id)` | Returns the character, or throws 404 / 403 unless the caller is the DM or has claimed it. **Use it in every per-character action** — never trust a `characterId` from the client. |
| `ctx.config` | This campaign's settings, resolved against the manifest defaults. |
| `ctx.storage` | Per-campaign, per-plugin key → JSON value store: `get`, `set`, `delete`, `list(prefix)`, `entries(prefix)`. In memory with write-through, so it is synchronous. Structure keys with prefixes: `char:<characterId>`, `letter:<id>`. Included in campaign backups (character ids inside keys and values are re-mapped on restore). |
| `ctx.wiki` | `status()` → `{ hasWiki, canWrite, username }`; `read(title)` → wikitext or `null`; `write(title, text, opts?)` replaces/creates a page; `append(title, text, opts?)` adds to the end; `url(title)`. `opts`: `summary`, `createOnly`, `sectionTitle`. Writes go through the DM's stored bot login, are serialized per campaign (appends never race), re-login once if the wiki forgot the session, and throw `PluginError` with a readable message otherwise. |
| `ctx.rollDice(count, sides)` | Server-side dice from the campaign RNG → `number[]`. **Roll on the server**, never trust a client-reported result. `ctx.rng()` is the raw `[0,1)` source. |
| `ctx.gameDate()` | The in-game date and time as the party sees it (calendar-aware). |
| `ctx.log(text, opts?)` | Writes to the game log (History → Log). `visibility`: `'all'` (default), `'dm'`, or a seat id (that seat + the DM). `toast: true` also pops a toast for everyone who can see it. `data` is free-form. |
| `ctx.notify(topic?, audience?)` | Tells connected clients your data changed; panels using `usePluginQuery` refetch. Call it after every mutation. |
| `ctx.campaign` | Name, settings, clock. |
| `ctx.runtime`, `ctx.hub` | Escape hatches into the core (`CampaignRuntime`, the WS hub). Prefer everything above; if you reach for these, read docs/AI-DEVELOPMENT.md first. |

### Rules that keep plugins safe

- **There is no snapshot filter for plugin data — your action *is* the filter.**
  Core state reaches players through `filterStateForViewer`; plugin data reaches
  them only through what your actions return. Decide per action what a player
  may see (`ctx.isDm ? all : own`), and test it. The examples show both shapes.
- **`ctx.config` is DM-only on the client** (players' snapshots carry
  `enabled` but an empty config). If a panel needs a config value, return it
  from an action.
- **Escape everything a human typed before it goes into wikitext**:
  `wikiEscape(text)` makes it inert (no templates, links or markup), and
  `wikiTitlePart(text)` makes it safe inside a page title. A player who types
  `{{Delete}}` into a letter must produce the text `{{Delete}}`, not a deletion
  request. Text you *want* rendered as wikitext should come from `ctx.config`
  (the DM wrote it), not from a player.
- **The wiki is public and semi-reliable.** Anything written there can be read
  by every player in a browser — DM-secret content does not belong on it (see
  docs/WIKI-TEMPLATE.md). And it can be down: **save to `ctx.storage` first,
  write to the wiki second**, record the failure, offer a retry (see
  `example-letters`' `publish`). Never make someone retype a letter because a
  third-party service hiccuped. If the wiki half is optional, check
  `ctx.wiki.status().canWrite` and carry on without it (see `example-fate-dice`).
- **Append, don't rewrite, shared log pages.** `append` is one atomic
  MediaWiki edit; `read` → modify → `write` loses concurrent edits made on the
  wiki itself. Rewrite only pages the plugin owns outright.
- **Secrets never go in config or storage.** Config is visible to the DM's
  browser and both ride in backups. Wiki credentials are handled by the host
  (Setup → Wiki write access); if you need another credential, stop and ask the
  user — that is a core change (`runtime.setSecret`).
- Keep stored values small and bounded (cap histories, as the examples do):
  storage lives in memory.

## Client: panels

```tsx
import { Button, EmptyNote, Section, defineClientPlugin, usePluginAction, usePluginQuery, useViewer, type PluginPanelProps } from '@hexcrawl/client/plugin-api';
import manifest from '../manifest.js';

function MainPanel(props: PluginPanelProps) {
  const viewer = useViewer();                                    // { isDm, character, characters, seatId }
  const { data, error, loading } = usePluginQuery<State>(props, 'state', undefined, { topics: ['pools'] });
  const { busy, run } = usePluginAction(props);                  // run('roll', {...}) → result | undefined
  if (!data) return <EmptyNote>{error ?? 'Loading…'}</EmptyNote>;
  return <Section title="…">…</Section>;
}

export default defineClientPlugin({ manifest, panels: [{ id: 'main', component: MainPanel }] });
```

- The shell owns the chrome: rail button (bottom tab on phones), title bar, pin,
  close, scroll container, resize, and an error boundary around your panel.
  **Render only the body.** Panel `id`s must match the manifest.
- `usePluginQuery(props, action, input?, { topics? })` loads an action's result,
  refetches when `input` changes and whenever the server calls `ctx.notify()`
  (for a matching topic, if you listed any). It is your panel's equivalent of
  the snapshot — don't poll.
- `usePluginAction(props).run(action, input)` handles busy state and toasts
  failures; it resolves to `undefined` on error, so keep the user's draft in
  the form until it returns a value.
- Live campaign state (characters, clock, role) comes from `useViewer()` and
  `useSession((s) => s.state)` — the same store the rest of the app reads.
- **Look native.** Use the kit re-exported from the plugin API (`Button`,
  `Input`, `TextArea`, `Select`, `Field`, `Section`, `Toggle`, `Dialog`,
  `EmptyNote`, `Lbl`, `cx`) and the app's Tailwind tokens: `ink-*` greys,
  `brass-*` accent, `ember-500` danger. Put `<Lbl>` text beside icon-only button
  glyphs (it disappears in compact mode).
- **Sizes in `rem`, never `px`** (`text-[0.6875rem]`, not `text-[11px]`) — the
  app's text-size control scales the root font size.
- The same panel renders in a ~320px sidebar **and** a phone bottom sheet.
  Design for narrow: stack fields, `min-w-0` + `truncate` on flexible text, no
  horizontal layouts that need more than ~280px.
- Do not import from `packages/client/src/**` by relative path. If the plugin
  API is missing something you need, add it to
  `packages/client/src/plugins/api.tsx` (a core change — keep it generic).

## Testing

```ts
import { afterEach, expect, it } from 'vitest';
import { createPluginTestBed, type PluginTestBed } from '@hexcrawl/server/plugin-testing';
import plugin from './index.js';

let bed: PluginTestBed;
afterEach(() => bed.dispose());

it('lets a player roll only for their own character', async () => {
  bed = createPluginTestBed(plugin, { config: { poolSize: 2 } });
  const ana = bed.addPlayer('Ana', 'Ser Ana');         // seat + claimed character
  const bo = bed.addPlayer('Bo');
  expect((await bed.call('roll', { characterId: ana.character.id }, ana.seat)).status).toBe(200);
  expect((await bed.call('roll', { characterId: bo.character.id }, ana.seat)).status).toBe(403);
});
```

The bed is a real in-memory campaign driven through the real HTTP route, so
auth, the enabled check and input validation are exercised. `bed.call(action,
input, seat?)` → `{ status, result, error }` (DM seat by default, `null` for no
seat); `bed.runtime` for direct assertions (`bed.runtime.log`), `bed.sent` for
hub messages (`plugin.changed`, toasts). The wiki is not reachable from tests:
either leave it unconfigured and assert the plugin degrades correctly, or stub
global `fetch` with a fake MediaWiki — `packages/server/src/plugins-host.test.ts`
has one (`stubWiki`) to copy. Run one plugin's tests with
`pnpm --filter @hexcrawl/plugins test -- <id>`.

There is no client test runner in this repo; verify panels in the browser.

## Wiki setup the DM must do once

1. Setup → Campaign → **Wiki base URL** (e.g. `https://wiki.example/index.php/`).
2. On the wiki: **Special:BotPasswords** → create a bot with *Edit existing
   pages* and *Create, edit, and move pages* (add *High-volume editing* if the
   plugin writes often).
3. Setup → **Wiki write access** → paste `User@botname` and the bot password.
   The server verifies it by logging in, stores it server-side only, and never
   shows it again. You (the agent) must not ask for, read, or type this
   password — tell the user to enter it themselves.

## Deploying private plugins

Plugins are baked into the image: the Dockerfile copies `plugins/` from the
build context and runs the same `scripts/plugins.mjs`. So before building,
make sure the mirror is current (`pnpm plugins` with `HEXCRAWL_PLUGINS_DIR`
set) on the machine whose source tree is sent to the build — see
deploy/RUNBOOK.md. A plugin's *data* lives in the campaign database and
survives redeploys; removing a plugin from the build just hides its panels
(the data stays, and comes back if the plugin does).

## Checklist before you call it done

- [ ] Folder name = manifest `id`; panel ids match between manifest and client.
- [ ] Every per-character action calls `ctx.requireCharacterAccess`.
- [ ] Every action that returns data decides what a *player* may see; a test
      proves the negative case.
- [ ] Player-typed text is `wikiEscape`d / `wikiTitlePart`ed before it reaches
      the wiki.
- [ ] Data is saved before the wiki is touched; a wiki failure is reported, not
      fatal, and can be retried.
- [ ] Mutations call `ctx.notify()`; the panel uses `usePluginQuery`.
- [ ] Tunables are `config` fields with sensible defaults, not constants.
- [ ] `pnpm typecheck && pnpm test` pass; the panel was exercised in a browser
      as DM **and** as a player, at sidebar width and phone width.
- [ ] Private plugin: source committed and pushed in the owner's repository
      (not just mirrored here). Core changes (anything outside `plugins/`):
      committed and pushed on a branch here, per docs/AI-DEVELOPMENT.md.
