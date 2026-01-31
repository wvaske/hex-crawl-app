# Phase 4: Fog of War - Context

**Gathered:** 2026-01-30
**Status:** Ready for planning

<domain>
## Phase Boundary

DM controls what hexes players can see. Unrevealed hexes are hidden from players with a two-tier fog system. DM can reveal and hide hexes per-player, with state persisted to the database and enforced server-side. Reveals propagate to all affected players in real time.

Hex content (encounters, lore, towns, etc.) is NOT part of this phase — that's Phase 7. This phase handles visibility of terrain and the fog overlay itself.

</domain>

<decisions>
## Implementation Decisions

### Reveal interaction
- Select-then-reveal: DM uses existing multi-select (click/shift-drag) to select hexes, then clicks Reveal or Hide button
- DM can toggle freely — reveal and re-hide at any time, no confirmation needed for individual actions
- Bulk actions available: "Reveal All" and "Hide All" with a **unique confirmation dialog** (not the standard confirm — must be distinct to prevent accidental acceptance from muscle memory)

### Fog visual style — two-tier system
- **Tier 1 (adjacent to revealed):** Terrain type visible but slightly dimmed (~50-60% opacity). No hex content/features shown. Players can see what terrain is nearby.
- **Tier 2 (2+ hexes from revealed):** Stylized clouds/mist overlay. Players can see the map extent but no terrain detail.
- **DM view:** Full terrain and content always visible. Unrevealed hexes shown with a subtle border or tint overlay so DM knows what players can't see.
- **Reveal animation:** Tile-flip animation (like flipping a board game tile from back to front) when a hex transitions from fog to revealed.

### Visibility granularity
- **Per-player fog:** DM can reveal hexes to specific players (supports split-party and scouting scenarios)
- **Default reveal is to all players** — DM reveals to everyone unless they specifically choose individual players. Minimizes friction for the common case.
- **Server-enforced:** Server never sends unrevealed hex content to player clients. Players cannot inspect network traffic to see hidden hexes.
- **Adjacent tier data:** Server computes adjacency and sends terrain-only data for hexes adjacent to each player's revealed hexes. Authoritative server-side computation.

### Persistence & session behavior
- **Fog persists forever** — revealed hexes stay revealed across all sessions. Campaign fog state saved to database.
- **Full state on reconnect** — server sends complete fog state (all revealed hex keys for that player) on WebSocket connect. Matches existing session:state pattern.
- **Event logging with undo/redo** — each reveal/hide action logged in session_event table. Log supports undo/redo of fog actions.

### Claude's Discretion
- Placement of Reveal/Hide controls (side panel buttons vs context menu — pick best fit for existing UI patterns)
- Whether reveals respect staged broadcast mode or are always immediate
- Exact mist/cloud texture style for tier-2 fog
- Undo/redo implementation details (keyboard shortcuts, UI buttons, stack depth)

</decisions>

<specifics>
## Specific Ideas

- Two-tier fog inspired by board game exploration: adjacent hexes show terrain "hints" while distant hexes are fully obscured
- Reveal animation should feel like flipping a physical game tile — front (fog) flips to back (revealed terrain)
- Bulk reveal/hide confirmation must use a **distinct dialog** (not the standard browser confirm or the same modal used elsewhere) to prevent muscle-memory accidents. Consider requiring typing "RESET" or a multi-step confirmation.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-fog-of-war*
*Context gathered: 2026-01-30*
