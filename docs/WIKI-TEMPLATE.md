# Wiki location page template

How the app reads campaign wiki pages, and how to write them so it reads them
well. Applies to any MediaWiki install; the campaign's base URL is
`Settings → Wiki base URL` (`campaign.settings.wikiBaseUrl`).

## The one rule that matters

**A wiki page linked from a location is readable by anyone who can open the
wiki.** The app cannot enforce wiki-side secrecy — it only proxies what the
wiki already serves to a browser. So:

- Never put DM secrets on a page that a player-visible location points at.
  Module canon and DM truth belong on DM-only pages (or on the location's
  in-app **DM notes** field, which never reaches a player snapshot).
- The app hides sections titled `DM notes`, `DM only`, `Secrets` or
  `Behind the screen` from a player's view of the page. That is a courtesy to
  keep the panel tidy, **not** a security boundary — the player can still open
  the same page in a browser tab.
- The in-app knowledge model (clues, gates, discoveries) is the real spoiler
  control. Wiki prose is background colour for a place the party has already
  found.

This matches the campaign's spoiler-hygiene rule: player-facing pages record
what the party believes; DM truth lives elsewhere.

## Recommended section layout

```
{{Infobox location | ... }}

Short lead paragraph — one or two sentences of what the place is.

== Overview ==
Player-safe description: what it looks like, who lives there, what it's known
for. This is the section read aloud at the table.

== What the party knows ==
The party's own history with the place: when they were here, who they met,
what they promised. Written from the players' point of view.

== History ==
== Notable people ==
== Hooks ==
Optional. Shown behind "Show full page".

== DM notes ==
Only on pages no player-visible location links to. See the rule above.
```

## How the app consumes it

1. A location (content pin) stores a **Wiki page** title in its editor
   (`ContentDialog` → "Wiki page"). A full `https://…` URL is also accepted; it
   becomes a plain external link and is not proxied.
2. The **More…** dialog (`LocationDialog`) asks the server for
   `GET /api/campaigns/:id/wiki-page?title=<title>`. Any seated member may
   read; the server derives the wiki's `api.php` from `wikiBaseUrl` and calls
   `action=parse&prop=text&redirects=1` server-side, so no CORS setup is needed
   on the wiki and redirects resolve automatically.
3. The response is cached in server memory for **5 minutes**, and sanitized
   before it is returned: `<script>`, `<style>`, `<iframe>`-class elements,
   inline `on*` handlers and `javascript:` URLs are stripped, and root-relative
   links are rebased on the wiki's origin so they open there. See
   `packages/server/src/http/wiki.ts`.
4. The client splits the HTML at its top-level `== h2 ==` headings. If it finds
   **Overview** and/or **What the party knows**, it shows those first with a
   *Show full page* toggle; a page with no recognized headings simply renders
   whole. Pages need not follow the template — the layout is an optimization,
   not a requirement.

## Base URL shapes

`wikiBaseUrl` is the prefix used for human-facing links (a page title is
appended). The api endpoint is derived from it:

| `wikiBaseUrl`                       | derived endpoint                 |
| ----------------------------------- | -------------------------------- |
| `https://wiki.example/index.php/`   | `https://wiki.example/api.php`   |
| `https://wiki.example/w/index.php/` | `https://wiki.example/w/api.php` |
| `https://wiki.example/wiki/`        | `https://wiki.example/api.php`   |
| `https://wiki.example/w/api.php`    | unchanged                        |

If your install puts `api.php` somewhere else, set `wikiBaseUrl` to the
`api.php` URL — links still work, and the proxy uses it directly. Empty
`wikiBaseUrl` disables the wiki panel (the route answers
`404 {"error":"No wiki configured"}`).

## Writing tips

- Keep **Overview** self-contained: it is what most people at the table read.
- Prefer wiki links (`[[Elturel]]`) over bare URLs — they render as links back
  to the wiki inside the panel.
- Big infoboxes and floated thumbnails are un-floated in the panel; a page that
  reads well as plain prose reads well in the app.
- Renaming a page is fine — redirects are followed — but update the location's
  Wiki page field when convenient so the header link stays canonical.
