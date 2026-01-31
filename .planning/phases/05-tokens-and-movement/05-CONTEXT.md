# Phase 5: Tokens & Movement - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Each player controls a character token on the hex map. Tokens move by dragging to adjacent hexes and snap into place. All connected users see token positions update in real time. DM can also place and move NPC/monster tokens. Token positions persist across sessions.

</domain>

<decisions>
## Implementation Decisions

### Token visuals
- Icon tokens: small icon/emoji representing character class or race on a colored background
- Colored ring border around each token (unique color per player/token)
- DM creates tokens with initial icon; players can change their own token's icon
- Token fits inside hex with a small margin at default (single-token) size

### Token sizing and multi-token layout
- When multiple tokens share a hex, tokens shrink to fit side by side
- 2 tokens: shrink and sit side by side
- 3+ tokens: shrink and arrange in a hexagonal packing pattern so all remain visible
- No hard cap on tokens per hex — tokens keep shrinking as needed

### Movement rules
- Adjacent hex only — one hex at a time, no free placement
- Tokens CAN move into fogged (unrevealed) adjacent hexes (could trigger DM to reveal)
- DM can mark individual hexes as impassable (not tied to terrain type)
- DM can move ANY token (player or NPC) to any hex — useful for teleportation, corrections
- Players can only move their own token

### Token types
- Player character tokens AND DM-created tokens (NPCs, monsters, points of interest)
- Same visual system for both (icon + colored ring)
- DM can toggle visibility per token — hidden tokens only show for the DM (ambushes, hidden NPCs)

### Token interaction
- Direct drag on token to move — no separate select step
- Clicking on empty hex still does hex selection (existing behavior preserved)
- Must click directly on a specific token to grab it (in crowded hexes, click between tokens selects the hex)
- Smooth slide animation (~200ms) from old hex to new hex on move
- Invalid move (not adjacent, impassable): token snaps back + brief feedback explaining why

### Claude's Discretion
- Drag feedback style (ghost vs line vs highlight approach)
- Exact icon palette and default icon set
- Toast/visual cue design for invalid move feedback
- Animation easing curve
- How DM token creation UI is presented (modal, sidebar, etc.)

</decisions>

<specifics>
## Specific Ideas

No specific references — open to standard approaches. Key behavioral note: the hexagonal packing for multi-token display should gracefully degrade (tokens get smaller but remain identifiable).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-tokens-and-movement*
*Context gathered: 2026-01-31*
