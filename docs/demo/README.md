# Demo campaign

`seed-demo-campaign.mjs` builds **The Wyrmfang Marches**, the campaign shown in
the README's GIF and screenshots, against any running instance:

```bash
pnpm dev                                  # or the Docker container
node docs/demo/seed-demo-campaign.mjs     # default http://localhost:3000
```

It prints the new campaign's id and keys; open `/c/<campaignId>?key=<dmKey>`
for the DM table, or the `playerKey` link to play. Run it as often as you like —
each run creates a fresh campaign.

What it demonstrates (all via the same WebSocket command bus the UI uses):

- ~300 hexes of painted terrain across eight terrain types
- **Emberwick** (town, always labeled, known to players) with generated
  smoke/din/smell sensory clues, and **Dunmere**, a hidden village players can
  only find by its hearth-smoke
- **Cinderfang's Lair** — a dragon's lair with a multi-hex footprint and
  distance-gated, directional clues standing in for regional effects
  (sulphur within 3 hexes, wingbeats within 5, clawed trees adjacent)
- **The Thornwood**, a region with a footprint and an on-entry flavor clue
- a discoverable drag-trail, a buried cache behind an active Investigation
  check, a ruin, markers, and two terrain-bound encounter tables

## The real-map segment

The second GIF (`real-maps.gif`) shows the same campaign with a second map
built from uploaded art: the *player* version of a map as a visible image
layer and the *labeled* DM version as a DM-only layer, with the hex grid
aligned over both. The map images themselves are commercial art and are not
in this repository — to reproduce the effect, upload any image pair in
*Build → Maps*, mark the labeled one "DM only", and align the grid.

## How the README media was made

The GIF is a real player session: a scripted browser (Playwright driving the
dev client) joined the seeded campaign as a player, claimed the ranger, and
walked the party west toward Emberwick and then east to the lair, recording
the whole thing. In dev builds the client exposes `window.__send` (the raw
command bus) and `window.__debug` (engine + stores), which is what makes this
kind of scripting — and reproducible screenshots — possible.
