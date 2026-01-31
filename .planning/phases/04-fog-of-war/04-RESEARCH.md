# Phase 4: Fog of War - Research

**Researched:** 2026-01-31
**Domain:** Real-time visibility system (PixiJS rendering, WebSocket sync, PostgreSQL persistence, server-side access control)
**Confidence:** HIGH

## Summary

Phase 4 adds a fog of war system where the DM controls hex visibility per-player. The codebase already has substantial scaffolding: `revealedHexes` in `SessionRoom` (server), `revealedHexKeys` in `useSessionStore` (client), `hex:reveal` / `hex:revealed` message types, and the `getNeighborCoords` / `hexDistance` utilities needed for adjacency computation.

The implementation breaks into four areas: (1) a new DB table for persistent fog state, (2) server-side fog logic that enforces per-player visibility and computes adjacency tiers, (3) a PixiJS `FogLayer` that renders two-tier overlays using the existing sprite/Graphics layer pattern, and (4) DM UI controls for reveal/hide actions.

**Primary recommendation:** Build on the existing in-memory `revealedHexes` map and WS messages. Add a `hex_visibility` Drizzle table for persistence, a `FogLayer` PixiJS layer using hex-shaped Graphics overlays, and extend the `session:state` payload to include per-player adjacency data. The server must filter hex data before sending to players (never send unrevealed terrain).

## Standard Stack

### Core

No new libraries needed. This phase uses only what is already installed:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PixiJS | ^8.15.0 | Fog overlay rendering (Graphics-based hex shapes) | Already used for all canvas layers |
| Drizzle ORM | ^0.45.0 | Fog state persistence (`hex_visibility` table) | Already used for all DB access |
| Zustand | ^5.0.10 | Client fog state management | Already used for all stores |
| Zod | ^4.0.0 | Message validation for fog WS messages | Already used for all WS schemas |
| honeycomb-grid | ^4.1.5 | Hex grid iteration for fog layer rendering | Already used in TerrainLayer/HighlightLayer |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@hex-crawl/shared` hex utils | workspace | `hexKey`, `parseHexKey`, `getNeighborCoords`, `hexDistance` | Adjacency computation on server and client |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Graphics-based fog overlay | Sprite-based fog textures (pre-generated like terrain) | Graphics is correct here -- fog is a small dynamic overlay set, not 500+ static sprites. HighlightLayer already proves this pattern works for overlays |
| Per-hex DB rows | JSONB column on campaign table | Per-hex rows allow efficient partial updates and per-player queries. JSONB would require full read-modify-write for every reveal |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure

```
packages/shared/src/
├── ws-messages.ts            # ADD: hex:hide client message, fog:state server message
├── hex-types.ts              # ADD: FogTier enum, FogHexData type

packages/server/src/
├── db/schema/
│   └── fog.ts                # NEW: hex_visibility table
├── ws/
│   ├── message-handlers.ts   # EXTEND: handleHexReveal (persist + adjacency), handleHexHide (new)
│   ├── fog-utils.ts          # NEW: computeAdjacentHexes, buildFogStateForPlayer
│   └── handler.ts            # EXTEND: send fog state on connect (already sends revealedHexes)

packages/client/src/
├── canvas/layers/
│   └── FogLayer.tsx          # NEW: two-tier fog rendering
├── stores/
│   └── useSessionStore.ts    # EXTEND: adjacentHexKeys (tier-1), fogState dispatch
├── components/
│   └── FogControls.tsx       # NEW: Reveal/Hide buttons, bulk actions
```

### Pattern 1: Layered Fog Rendering (PixiJS Graphics)

**What:** A `FogLayer` component that renders hex-shaped overlays, following the same pattern as `HighlightLayer`.
**When to use:** For all fog visual overlays on the hex map.
**Example:**
```typescript
// FogLayer sits ABOVE TerrainLayer but BELOW HighlightLayer in z-order
// Layer order: TerrainLayer(z:0) > GridLineLayer(z:1) > FogLayer(z:1.5) > HighlightLayer(z:2)

// Tier 2 (deep fog): solid hex-shaped overlay with cloud/mist fill
// Tier 1 (adjacent): semi-transparent hex-shaped overlay (~50-60% opacity)
// Revealed: no overlay

// Uses Graphics.clear() + redraw on state change, same as HighlightLayer
// Uses useTick() for change detection, same as HighlightLayer
```

### Pattern 2: Server-Side Visibility Enforcement

**What:** The server computes what each player can see and only sends allowed data. Players never receive unrevealed hex terrain.
**When to use:** Every time the server sends hex data to a player.
**Example:**
```typescript
// On session:state, build per-player payload:
// 1. Revealed hexes: send full terrain data
// 2. Adjacent hexes (tier 1): send terrain type ONLY (no content/features)
// 3. All other hexes: send hex key + fog tier only (no terrain)

// The server's buildFogStateForPlayer() computes:
// - revealed: Set<string> from hex_visibility table
// - adjacent: Set<string> computed via getNeighborCoords on revealed set
// - foggedTerrain: Map<string, terrain> for adjacent hexes only
```

### Pattern 3: Persistent Fog with In-Memory Cache

**What:** Fog state lives in PostgreSQL for persistence, loaded into `SessionRoom.revealedHexes` on first connection, written on each reveal/hide.
**When to use:** Fog must survive server restarts and session boundaries.
**Example:**
```typescript
// hex_visibility table schema:
// id, campaign_id, hex_key, user_id (nullable = "all"), revealed_at, revealed_by

// On room creation / first connect:
//   Load all hex_visibility rows for campaign into room.revealedHexes
// On reveal:
//   1. Insert into hex_visibility
//   2. Update room.revealedHexes in memory
//   3. Broadcast to affected players
// On hide:
//   1. Delete from hex_visibility
//   2. Update room.revealedHexes in memory
//   3. Broadcast hex:hidden to affected players
```

### Pattern 4: Undo/Redo via Event Log

**What:** Each reveal/hide action is logged in `session_event` (already exists). Undo replays the inverse action.
**When to use:** DM wants to undo a reveal or hide.
**Example:**
```typescript
// session_event already logs hex_reveal events with payload
// Add hex_hide event type to the enum
// Undo stack: maintain a client-side array of {action, hexKeys, targets}
// Undo = send the inverse (reveal -> hide, hide -> reveal)
// Redo = resend the original action
```

### Anti-Patterns to Avoid

- **Sending all hex data to players and filtering client-side:** Violates FOG-05. The server MUST be the authority -- never send unrevealed terrain to players.
- **Using Sprites for fog overlay:** Fog overlays are dynamic (change on reveal) and few in number relative to the grid. Graphics is correct, not Sprites. (Sprites are for 500+ static terrain hexes.)
- **Storing fog in session table (session-scoped):** Fog persists across sessions (FOG-04). It belongs on the campaign, not the session.
- **Full fog redraw every frame:** Only redraw when `revealedHexKeys` Set reference changes (Zustand new-Set pattern already used throughout).
- **Computing adjacency on the client:** Adjacency determines what data the server sends. The server must compute it to avoid leaking data.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hex adjacency computation | Custom neighbor math | Existing `getNeighborCoords()` from `hex/neighbors.ts` | Already correct for flat-top axial coords, tested in terrain generation |
| Hex distance calculation | BFS-based distance | Existing `hexDistance()` from `hex/neighbors.ts` | O(1) cube distance, already implemented |
| Hex polygon drawing | Manual polygon math | Copy pattern from `HighlightLayer.drawHexHighlight()` using `GameHex.corners` | Already handles flat-top hex shape correctly |
| WS message validation | Manual JSON parsing | Extend existing Zod `ClientMessageSchema` / `ServerMessageSchema` | Already validated everywhere, type-safe |
| State change detection | Custom diffing | Zustand new-Set/Map pattern (already used as "PITFALL 6" everywhere) | Proven pattern in all existing stores |

**Key insight:** Nearly every utility needed for fog already exists in the codebase. The hex math, neighbor computation, WS message infrastructure, layer rendering pattern, and store patterns are all established. The work is wiring them together with persistence and the fog-specific rendering.

## Common Pitfalls

### Pitfall 1: Data Leakage Through Session State

**What goes wrong:** The `session:state` message currently sends `revealedHexes` as an array of hex keys. If the server also sends terrain data for the full map, players can see unrevealed terrain.
**Why it happens:** The map data (terrain) might be loaded separately from fog state, and the client has full map data in `useMapStore`.
**How to avoid:** The server must ONLY send terrain data for revealed + adjacent hexes. The client `useMapStore` for players must only contain hex data the server explicitly sent. DM client gets full data.
**Warning signs:** Player can see terrain colors under the fog overlay; network tab shows hex terrain for unrevealed hexes.

### Pitfall 2: Race Condition Between Fog State and Map Load

**What goes wrong:** Client loads map data and fog state at different times. Brief flash of full map before fog applies.
**Why it happens:** Map data might arrive before fog state, or fog layer renders before fog state is populated.
**How to avoid:** Send fog state as part of `session:state` (already wired). For players, send terrain data ONLY for visible hexes in the same message. Fog layer should default to "all fogged" until state arrives.
**Warning signs:** Brief flash of full map on initial load.

### Pitfall 3: "All" Reveals Not Including Future Players

**What goes wrong:** DM reveals hexes to "all" but only currently connected players are tracked. A player who joins later doesn't see those hexes.
**Why it happens:** Current `handleHexReveal` adds only connected player IDs to the Set.
**How to avoid:** Store "all" reveals with a `null` user_id in the database (meaning "revealed to everyone"). On player connect, include both per-player and null-user reveals.
**Warning signs:** New players joining see fog on hexes that other players can see.

### Pitfall 4: Adjacency Recomputation Cost

**What goes wrong:** Recomputing adjacency for every player on every reveal is O(revealed_hexes * 6) per player.
**Why it happens:** Naively iterating all revealed hexes to find neighbors.
**How to avoid:** On reveal, compute only the NEW adjacent hexes (neighbors of newly revealed hexes that aren't themselves revealed). Cache the adjacency set in `SessionRoom` and incrementally update.
**Warning signs:** Lag on reveal with large numbers of revealed hexes.

### Pitfall 5: Fog Graphics Performance with Large Maps

**What goes wrong:** Drawing Graphics for every fogged hex (potentially 500+) is slow.
**Why it happens:** Graphics shapes aren't batched as efficiently as Sprites.
**How to avoid:** Use viewport culling (same pattern as TerrainLayer) -- only draw fog for hexes visible in the viewport. For tier-2 (deep fog), consider using a single large rectangle with hex-shaped holes for revealed areas (cheaper than hundreds of individual shapes).
**Warning signs:** Frame rate drops when zoomed out with many fogged hexes visible.

### Pitfall 6: Zustand Set/Map Immutability

**What goes wrong:** Mutating the existing `revealedHexKeys` Set instead of creating a new one.
**Why it happens:** Forgetting the Zustand immutability requirement.
**How to avoid:** Always create `new Set(existing)` before modifications. Already enforced throughout the codebase as "PITFALL 6".
**Warning signs:** UI doesn't update when fog state changes.

## Code Examples

### Database Schema (Drizzle)

```typescript
// packages/server/src/db/schema/fog.ts
import { pgTable, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";
import { user } from "./auth";

export const hexVisibility = pgTable(
  "hex_visibility",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    hexKey: text("hex_key").notNull(),
    // null = revealed to ALL players; non-null = revealed to specific player
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    revealedBy: text("revealed_by")
      .notNull()
      .references(() => user.id),
    revealedAt: timestamp("revealed_at").defaultNow().notNull(),
  },
  (table) => [
    index("hex_vis_campaign_idx").on(table.campaignId),
    index("hex_vis_campaign_user_idx").on(table.campaignId, table.userId),
    unique("hex_vis_unique").on(table.campaignId, table.hexKey, table.userId),
  ]
);
```

### Server-Side Adjacency Computation

```typescript
// packages/server/src/ws/fog-utils.ts
import { parseHexKey, hexKey } from "@hex-crawl/shared";

const FLAT_TOP_DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function getNeighborKeys(key: string): string[] {
  const { q, r } = parseHexKey(key);
  return FLAT_TOP_DIRECTIONS.map(d => hexKey(q + d.q, r + d.r));
}

/**
 * Compute adjacent (tier-1) hex keys: neighbors of revealed that aren't revealed themselves.
 */
export function computeAdjacentHexes(
  revealedKeys: Set<string>,
  allHexKeys: Set<string>,
): Set<string> {
  const adjacent = new Set<string>();
  for (const key of revealedKeys) {
    for (const neighborKey of getNeighborKeys(key)) {
      if (!revealedKeys.has(neighborKey) && allHexKeys.has(neighborKey)) {
        adjacent.add(neighborKey);
      }
    }
  }
  return adjacent;
}

/**
 * Build the fog payload for a specific player.
 * Returns revealed hex keys, adjacent hex keys with terrain-only data.
 */
export function buildPlayerFogPayload(
  playerRevealedKeys: Set<string>,
  allHexData: Map<string, { terrain: string }>,
): {
  revealedHexes: string[];
  adjacentHexes: Array<{ key: string; terrain: string }>;
} {
  const adjacent = computeAdjacentHexes(playerRevealedKeys, new Set(allHexData.keys()));
  return {
    revealedHexes: [...playerRevealedKeys],
    adjacentHexes: [...adjacent].map(key => ({
      key,
      terrain: allHexData.get(key)?.terrain ?? "grassland",
    })),
  };
}
```

### FogLayer Rendering (PixiJS)

```typescript
// packages/client/src/canvas/layers/FogLayer.tsx
// Follows same pattern as HighlightLayer:
// - Container ref + Graphics ref
// - useTick() with change detection
// - Draws hex-shaped overlays using GameHex.corners

// Tier 2 (deep fog): solid dark fill (e.g., 0x1a1a2e at alpha 0.95)
// Tier 1 (adjacent): semi-transparent fill (e.g., 0x2a2a3e at alpha 0.55)
// DM override: subtle tint (e.g., 0xff0000 at alpha 0.08) for unrevealed

// Performance: use viewport culling like TerrainLayer
// Only draw fog Graphics for hexes within viewport bounds + padding
```

### New WS Messages

```typescript
// Add to packages/shared/src/ws-messages.ts:

// Client -> Server: hide hexes
const HexHideMessage = z.object({
  type: z.literal("hex:hide"),
  hexKeys: z.array(z.string()),
  targets: z.union([
    z.literal("all"),
    z.object({ playerIds: z.array(z.string()) }),
  ]),
});

// Server -> Client: hex hidden notification
const HexHiddenMessage = z.object({
  type: z.literal("hex:hidden"),
  hexKeys: z.array(z.string()),
});

// Server -> Client: fog state with adjacency (extends session:state)
// Add to SessionStateMessage:
//   adjacentHexes: z.array(z.object({ key: z.string(), terrain: z.string() }))
```

### Reveal/Hide Controls (React)

```typescript
// FogControls.tsx pattern:
// - Reads selectedHexes from useUIStore
// - Reads sendMessage from useSessionStore
// - Renders "Reveal Selected" and "Hide Selected" buttons
// - Disabled when no hexes selected or user is not DM
// - "Reveal All" / "Hide All" require distinct confirmation dialog
//   (type "RESET" to confirm, per CONTEXT.md)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side fog filtering | Server-enforced visibility | Industry standard | Critical for FOG-05 -- never trust the client |
| Full map sent + CSS overlay | Selective data transmission | Standard in multiplayer games | Prevents network-level data leakage |

**Deprecated/outdated:**
- Nothing deprecated -- this is a greenfield implementation using established patterns.

## Open Questions

1. **Map data source for players**
   - What we know: Currently `useMapStore` is populated client-side (map generation happens in browser). Phase 4 requires server to gate terrain data.
   - What's unclear: Is map data already persisted server-side, or does this phase need to add map persistence? The DB schema has campaigns but no map/hex data table.
   - Recommendation: Phase 4 likely needs to add a `campaign_hex` table (or store map data in campaign JSONB) so the server has terrain data to filter. Alternatively, the DM client can upload map data to the server when creating/saving a map, and the server persists it. **This is a prerequisite the planner must address.**

2. **Fog layer rendering strategy for tier-2 at scale**
   - What we know: Graphics works for small overlay counts (HighlightLayer proves it). At 500+ fogged hexes, individual Graphics shapes may be slow.
   - What's unclear: Exact performance threshold.
   - Recommendation: Start with individual hex Graphics (matching HighlightLayer pattern) with viewport culling. If performance is an issue, switch to a full-screen dark overlay with "holes" punched for revealed hexes using a mask/stencil.

3. **Per-player fog UI for DM**
   - What we know: DM can reveal to specific players. Default is "all."
   - What's unclear: Exact UI for selecting target players when revealing to specific players.
   - Recommendation: Add a dropdown or checkbox list in the FogControls component. Default "all" with an expand to select specific players from `connectedPlayers`.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/server/src/ws/session-manager.ts` -- existing `revealedHexes: Map<string, Set<string>>` pattern
- Codebase analysis: `packages/server/src/ws/message-handlers.ts` -- existing `handleHexReveal` handler with per-player targeting
- Codebase analysis: `packages/shared/src/ws-messages.ts` -- existing `hex:reveal`, `hex:revealed` message schemas
- Codebase analysis: `packages/client/src/stores/useSessionStore.ts` -- existing `revealedHexKeys: Set<string>` with dispatch handling
- Codebase analysis: `packages/client/src/canvas/layers/HighlightLayer.tsx` -- Graphics overlay rendering pattern
- Codebase analysis: `packages/client/src/hex/neighbors.ts` -- `getNeighborCoords`, `hexDistance` utilities
- Codebase analysis: `packages/server/src/db/schema/session.ts` -- Drizzle schema patterns, `session_event` for logging

### Secondary (MEDIUM confidence)
- PixiJS 8 Graphics API for overlay rendering -- verified by existing HighlightLayer usage in codebase
- Drizzle ORM table definition patterns -- verified by existing schema files

### Tertiary (LOW confidence)
- None -- all findings based on direct codebase analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries needed, all patterns verified in codebase
- Architecture: HIGH - extends existing patterns (layers, WS messages, stores, DB schema)
- Pitfalls: HIGH - identified from direct analysis of existing code and requirements

**Research date:** 2026-01-31
**Valid until:** 2026-03-01 (stable -- no external library changes affect this)
