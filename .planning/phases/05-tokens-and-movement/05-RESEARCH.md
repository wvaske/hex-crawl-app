# Phase 5: Tokens & Movement - Research

**Researched:** 2026-01-31
**Domain:** PixiJS drag interaction, WebSocket real-time sync, Drizzle ORM persistence
**Confidence:** HIGH

## Summary

This phase adds character tokens to the existing PixiJS hex map. Tokens are rendered as PixiJS display objects (icon + colored ring), positioned at hex centers, and dragged by pointer events. Movement validation (adjacency, impassable) happens server-side. Token state is persisted in PostgreSQL via Drizzle and broadcast via the existing WebSocket infrastructure.

No new libraries are needed. The existing stack (PixiJS 8, @pixi/react, Zustand, Hono WS, Drizzle) provides everything required. The main technical challenges are: (1) integrating drag interaction with the existing HexInteraction pointer event system without breaking pan/select, (2) smooth animation with PixiJS ticker, and (3) multi-token layout within a single hex.

**Primary recommendation:** Build tokens as a new PixiJS Container layer (TokenLayer) with per-token Container children (icon sprite + ring graphic). Drag handling extends HexInteraction with token hit-testing priority over hex selection. Server validates moves and broadcasts; client applies optimistic animation then reconciles.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pixi.js | ^8.15.0 | Token rendering (Container, Graphics, Text) | Already in project |
| @pixi/react | ^8.0.5 | React integration for token layer | Already in project |
| zustand | ^5.0.10 | Token state store | Already in project |
| drizzle-orm | ^0.45.0 | Token DB persistence | Already in project |
| hono | ^4.11.0 | WS message handling for token events | Already in project |
| zod | ^4.0.0 | Token message schema validation | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| honeycomb-grid | ^4.1.5 | Hex center pixel calculation for token positioning | Already in project, used by coordinates.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual Canvas2D icon rendering | Pre-built icon sprite sheets | Sprite sheets need asset pipeline; Canvas2D text/emoji is simpler and consistent with existing texture approach |
| Client-side move validation | Server-only validation | Client-side gives instant feedback; do both (optimistic client + authoritative server) |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
packages/shared/src/
├── ws-messages.ts           # Add token:move, token:create, token:update, token:delete messages
├── hex-types.ts             # Add Token type definition
packages/server/src/
├── db/schema/token.ts       # New: campaign_token table
├── ws/message-handlers.ts   # Add token message handlers
├── routes/map.ts            # Add token data to GET /api/campaigns/:id/map response
packages/client/src/
├── stores/useTokenStore.ts  # New: token state store
├── canvas/layers/TokenLayer.tsx  # New: renders all tokens
├── canvas/TokenSprite.ts    # New: builds per-token Container (icon + ring)
├── canvas/HexInteraction.tsx     # Modify: add token drag detection
```

### Pattern 1: Token Data Model
**What:** Database schema for persistent token positions
**When to use:** All token CRUD operations
```typescript
// packages/server/src/db/schema/token.ts
export const campaignToken = pgTable(
  "campaign_token",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
    hexKey: text("hex_key").notNull(),          // current position "q,r"
    ownerId: text("owner_id"),                   // userId for player tokens, null for NPC/monster
    label: text("label").notNull(),              // display name
    icon: text("icon").notNull().default("sword"), // icon identifier
    color: text("color").notNull().default("#ff0000"), // ring color hex string
    tokenType: text("token_type", { enum: ["pc", "npc"] }).notNull().default("pc"),
    visible: boolean("visible").notNull().default(true), // DM can hide tokens
    createdBy: text("created_by").notNull().references(() => user.id),
  },
  (table) => [
    index("campaign_token_campaign_idx").on(table.campaignId),
    unique("campaign_token_owner_unique").on(table.campaignId, table.ownerId),
    // One PC token per player per campaign; NPC tokens have null ownerId so unique won't conflict
  ]
);
```

### Pattern 2: Token Zustand Store
**What:** Client-side token state management
**When to use:** All token rendering and interaction
```typescript
// packages/client/src/stores/useTokenStore.ts
interface Token {
  id: string;
  hexKey: string;
  ownerId: string | null;
  label: string;
  icon: string;
  color: string;
  tokenType: "pc" | "npc";
  visible: boolean;
}

interface TokenState {
  tokens: Map<string, Token>;  // keyed by token.id
}

interface TokenActions {
  setTokens: (tokens: Token[]) => void;
  moveToken: (tokenId: string, newHexKey: string) => void;
  addToken: (token: Token) => void;
  removeToken: (tokenId: string) => void;
  updateToken: (tokenId: string, updates: Partial<Token>) => void;
}
```

### Pattern 3: Drag Interaction Integration
**What:** Token drag must coexist with existing hex click/select and viewport pan
**When to use:** HexInteraction pointer event flow
```
pointerdown:
  1. Hit-test: is pointer over a token? (check token positions vs world coords)
     YES → if token is owned by user (or user is DM): start token drag, pause viewport drag
     NO  → existing hex click/select flow

pointermove:
  If dragging token:
    - Show token following cursor (or ghost preview)
    - Highlight valid adjacent hexes
  Else: existing hover/drag-select behavior

pointerup:
  If dragging token:
    - Compute target hex from world coords
    - Validate adjacency client-side (optimistic)
    - Send token:move to server
    - Animate token to new hex center (or snap back if invalid)
    - Resume viewport drag
  Else: existing click/select behavior
```

### Pattern 4: WebSocket Token Messages
**What:** New message types for token operations
```typescript
// Client -> Server
token:move    { tokenId: string, toHexKey: string }
token:create  { hexKey: string, label: string, icon: string, color: string, tokenType: "pc"|"npc" }
token:update  { tokenId: string, updates: { icon?, color?, visible?, label? } }
token:delete  { tokenId: string }

// Server -> Client
token:moved   { tokenId: string, fromHexKey: string, toHexKey: string, movedBy: string }
token:created { token: Token }
token:updated { tokenId: string, updates: {...} }
token:deleted { tokenId: string }
token:state   { tokens: Token[] }  // sent on connect, like session:state
```

### Pattern 5: Token Rendering with PixiJS
**What:** Each token is a Container with icon + colored ring
```typescript
// Build a token display object
function createTokenDisplayObject(token: Token, hexSize: number): Container {
  const container = new Container();

  // Colored ring (Graphics circle with stroke)
  const ring = new Graphics();
  const radius = hexSize * 0.35;  // fit inside hex with margin
  ring.circle(0, 0, radius);
  ring.stroke({ width: 3, color: token.color });
  ring.fill({ color: token.color, alpha: 0.2 });
  container.addChild(ring);

  // Icon text (emoji or letter)
  const icon = new Text({ text: token.icon, style: { fontSize: radius, fill: 0xffffff } });
  icon.anchor.set(0.5);
  container.addChild(icon);

  return container;
}
```

### Pattern 6: Multi-Token Hex Layout
**What:** Position multiple tokens within a single hex
```typescript
function layoutTokensInHex(count: number, hexSize: number): Array<{x: number, y: number, scale: number}> {
  if (count === 1) return [{ x: 0, y: 0, scale: 1 }];

  const scale = count <= 2 ? 0.65 : count <= 4 ? 0.5 : 0.4;
  const offset = hexSize * 0.25;

  if (count === 2) {
    return [
      { x: -offset, y: 0, scale },
      { x: offset, y: 0, scale },
    ];
  }

  // 3+: arrange in circle pattern
  const positions = [];
  const angleStep = (2 * Math.PI) / count;
  for (let i = 0; i < count; i++) {
    positions.push({
      x: Math.cos(angleStep * i - Math.PI / 2) * offset,
      y: Math.sin(angleStep * i - Math.PI / 2) * offset,
      scale,
    });
  }
  return positions;
}
```

### Pattern 7: Smooth Animation
**What:** Animate token from old hex to new hex on move
```typescript
// Use PixiJS ticker for smooth animation
function animateTokenMove(
  container: Container,
  fromX: number, fromY: number,
  toX: number, toY: number,
  duration: number = 200  // ~200ms per context decisions
) {
  const startTime = performance.now();
  const ticker = (dt: number) => {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease-out quad
    const ease = 1 - (1 - t) * (1 - t);
    container.position.set(
      fromX + (toX - fromX) * ease,
      fromY + (toY - fromY) * ease,
    );
    if (t >= 1) {
      app.ticker.remove(ticker);
    }
  };
  app.ticker.add(ticker);
}
```

### Anti-Patterns to Avoid
- **Per-token React components:** Do NOT use @pixi/react JSX for individual tokens. With many tokens, React reconciliation overhead hurts. Use imperative PixiJS Container management (same pattern as TerrainLayer sprites).
- **Client-authoritative movement:** NEVER trust client position. Server validates adjacency and impassable before broadcasting. Client can show optimistic animation but must reconcile with server response.
- **Separate WebSocket connection for tokens:** Use the existing WS connection and message dispatch. No new connections.
- **Storing token positions in map store:** Keep tokens in a separate useTokenStore. Token state has different update patterns than hex terrain data.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hex adjacency validation | Custom distance check | Existing `hexDistance()` from `neighbors.ts` | Already tested, handles flat-top correctly |
| Pixel-to-hex conversion | Manual math | Existing `pixelToHex()` from `coordinates.ts` | Uses honeycomb-grid's `pointToCube` + rounding |
| Hex center pixel coords | Custom calculation | Existing `hexCenterWorld()` from `HexInteraction.tsx` | Already correct for flat-top layout |
| Message validation | Manual checks | Zod schemas in `ws-messages.ts` | Consistent with existing pattern |
| DB migrations | Manual SQL | `drizzle-kit push` / `drizzle-kit generate` | Already configured |

**Key insight:** Almost all spatial math is already implemented. The hex grid, coordinate conversion, adjacency, and distance functions are all in place. Token work is primarily about adding a new rendering layer, a new store, new WS messages, and a new DB table.

## Common Pitfalls

### Pitfall 1: Token Drag Conflicting with Viewport Pan
**What goes wrong:** Dragging a token also triggers viewport panning, causing the map to move under the token.
**Why it happens:** pixi-viewport's drag plugin intercepts all pointer events.
**How to avoid:** When a token drag starts, call `viewport.plugins.pause('drag')` (same pattern used for shift+drag area selection in HexInteraction). Resume on pointerup.
**Warning signs:** Map pans when you try to move a token.

### Pitfall 2: Zustand Map/Set Reactivity
**What goes wrong:** Token updates don't trigger re-renders.
**Why it happens:** Mutating a Map in place doesn't change the reference. Zustand only detects new references.
**How to avoid:** Always create `new Map(state.tokens)` before mutating, then return the new Map. This is documented as [01-01] decision and used throughout the codebase.
**Warning signs:** Token moves in console logs but not on screen.

### Pitfall 3: Race Condition on Optimistic Move + Server Rejection
**What goes wrong:** Client animates token to new position, server rejects move, but another move has already started.
**Why it happens:** Network latency between optimistic move and server response.
**How to avoid:** Track a "pending move" state per token. While a move is pending, disable further drags on that token. On server response (accepted or rejected), clear pending state and reconcile position.
**Warning signs:** Token teleports or gets stuck in wrong position.

### Pitfall 4: Token Hit-Testing at Different Zoom Levels
**What goes wrong:** Can't click on tokens when zoomed out, or clicking on empty space grabs a token when zoomed in.
**Why it happens:** Hit area doesn't account for viewport scale.
**How to avoid:** Convert pointer position to world coordinates (already done via `viewport.toWorld()`), then check distance to each token's world position. Use the token's world-space radius for hit testing, not screen-space.
**Warning signs:** Token grabbing feels broken at different zoom levels.

### Pitfall 5: Token Layer Z-Order
**What goes wrong:** Tokens render behind fog or highlights.
**Why it happens:** Layer order in MapView determines rendering order.
**How to avoid:** Insert TokenLayer between FogLayer and HighlightLayer in the MapView children order. Tokens should be visible through fog (DM sees all, players see only visible tokens on revealed hexes). Current layer order: Terrain(0), Grid(1), Fog(2), Highlight(3), UI(4). Token should be at z:3, shifting Highlight to z:4 and UI to z:5.
**Warning signs:** Tokens invisible or hidden behind other layers.

### Pitfall 6: "__all__" Sentinel for Token Visibility
**What goes wrong:** Token visibility filtering fails for the DM or uses wrong pattern.
**Why it happens:** The codebase uses `"__all__"` sentinel for hex visibility but tokens use a boolean `visible` field.
**How to avoid:** Token visibility is simpler than hex visibility: just a boolean `visible` column. DM sees all tokens. Players see only tokens where `visible = true`. No sentinel needed.
**Warning signs:** Hidden tokens showing to players, or visible tokens not showing.

## Code Examples

### Token DB Schema (Drizzle)
```typescript
// Source: pattern follows existing fog.ts and hex-data.ts schemas
import { pgTable, text, boolean, index, unique } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";
import { user } from "./auth";

export const campaignToken = pgTable(
  "campaign_token",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id").notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    hexKey: text("hex_key").notNull(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    icon: text("icon").notNull().default("sword"),
    color: text("color").notNull().default("#ff0000"),
    tokenType: text("token_type", { enum: ["pc", "npc"] }).notNull().default("pc"),
    visible: boolean("visible").notNull().default(true),
    createdBy: text("created_by").notNull().references(() => user.id),
  },
  (table) => [
    index("campaign_token_campaign_idx").on(table.campaignId),
  ]
);
```

### WS Message Schemas (Zod)
```typescript
// Source: extends existing ws-messages.ts pattern
const TokenMoveMessage = z.object({
  type: z.literal("token:move"),
  tokenId: z.string(),
  toHexKey: z.string(),
});

const TokenCreateMessage = z.object({
  type: z.literal("token:create"),
  hexKey: z.string(),
  label: z.string(),
  icon: z.string(),
  color: z.string(),
  tokenType: z.enum(["pc", "npc"]),
  ownerId: z.string().optional(),
});

// Server -> Client
const TokenMovedMessage = z.object({
  type: z.literal("token:moved"),
  tokenId: z.string(),
  fromHexKey: z.string(),
  toHexKey: z.string(),
  movedBy: z.string(),
});

const TokenStateMessage = z.object({
  type: z.literal("token:state"),
  tokens: z.array(z.object({
    id: z.string(),
    hexKey: z.string(),
    ownerId: z.string().nullable(),
    label: z.string(),
    icon: z.string(),
    color: z.string(),
    tokenType: z.enum(["pc", "npc"]),
    visible: z.boolean(),
  })),
});
```

### Server-Side Move Validation
```typescript
// Source: uses existing hexDistance from shared/neighbors.ts pattern
async function handleTokenMove(campaignId, userId, role, message) {
  const room = sessionManager.getRoom(campaignId);
  if (!room) return;

  // Load token from DB
  const token = await db.select().from(campaignToken)
    .where(and(eq(campaignToken.id, message.tokenId), eq(campaignToken.campaignId, campaignId)))
    .limit(1);
  if (!token.length) return sendError(ws, "Token not found");

  // Permission check: players can only move own token
  if (role === "player" && token[0].ownerId !== userId) {
    return sendError(ws, "You can only move your own token");
  }

  // Adjacency check (DM exempt - can teleport)
  if (role !== "dm") {
    const from = parseHexKey(token[0].hexKey);
    const to = parseHexKey(message.toHexKey);
    if (hexDistance(from, to) !== 1) {
      return sendError(ws, "Can only move to adjacent hexes");
    }
  }

  // TODO: impassable hex check

  // Persist move
  const fromHexKey = token[0].hexKey;
  await db.update(campaignToken)
    .set({ hexKey: message.toHexKey })
    .where(eq(campaignToken.id, message.tokenId));

  // Broadcast to all
  sessionManager.broadcastToAll(campaignId, {
    type: "token:moved",
    tokenId: message.tokenId,
    fromHexKey,
    toHexKey: message.toHexKey,
    movedBy: userId,
  });
}
```

### Token Rendering (TokenLayer)
```typescript
// Source: follows TerrainLayer.tsx imperative sprite management pattern
export function TokenLayer() {
  const containerRef = useRef<Container | null>(null);
  const tokenDisplaysRef = useRef<Map<string, Container>>(new Map());

  const tokens = useTokenStore((s) => s.tokens);
  const hexSize = useMapStore((s) => s.hexSize);
  const userRole = useSessionStore((s) => s.userRole);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    // Reconcile display objects with token state
    const currentIds = new Set(tokens.keys());
    const displayIds = new Set(tokenDisplaysRef.current.keys());

    // Remove stale
    for (const id of displayIds) {
      if (!currentIds.has(id)) {
        const display = tokenDisplaysRef.current.get(id)!;
        parent.removeChild(display);
        display.destroy({ children: true });
        tokenDisplaysRef.current.delete(id);
      }
    }

    // Group tokens by hexKey for layout
    const hexGroups = new Map<string, Token[]>();
    for (const token of tokens.values()) {
      // Players can't see hidden tokens
      if (userRole === "player" && !token.visible) continue;
      const group = hexGroups.get(token.hexKey) ?? [];
      group.push(token);
      hexGroups.set(token.hexKey, group);
    }

    // Position each token
    for (const [hexKey, group] of hexGroups) {
      const { q, r } = parseHexKey(hexKey);
      const center = hexCenterWorld(q, r, hexSize);
      const layout = layoutTokensInHex(group.length, hexSize);

      for (let i = 0; i < group.length; i++) {
        const token = group[i];
        let display = tokenDisplaysRef.current.get(token.id);
        if (!display) {
          display = createTokenDisplayObject(token, hexSize);
          parent.addChild(display);
          tokenDisplaysRef.current.set(token.id, display);
        }
        display.position.set(center.x + layout[i].x, center.y + layout[i].y);
        display.scale.set(layout[i].scale);
      }
    }
  }, [tokens, hexSize, userRole]);

  return <pixiContainer ref={(ref) => { containerRef.current = ref; }} />;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PixiJS 7 InteractionManager | PixiJS 8 EventSystem (built-in) | PixiJS 8 | EventSystem is automatic; but this project uses HTML canvas listeners + viewport.toWorld, which still works and is the established pattern |
| @pixi/react render props | @pixi/react 8 with extend() | 2024 | Already using extend() pattern throughout |

**Deprecated/outdated:**
- PixiJS 7 `interactive` property: replaced by `eventMode` in PixiJS 8, but irrelevant since this project uses HTML canvas addEventListener

## Open Questions

1. **Impassable hex storage**
   - What we know: DM marks individual hexes as impassable. Not tied to terrain type.
   - What's unclear: Should this be a new DB table (`campaign_hex_property`) or a boolean column on `campaign_hex`?
   - Recommendation: Add a `passable` boolean column (default true) to `campaign_hex` table. Simpler than a new table. Can be extended later.

2. **Token icon set**
   - What we know: Context says icon/emoji on colored background. Claude's discretion on exact palette.
   - What's unclear: How many icons, what format?
   - Recommendation: Use Unicode emoji as text (e.g., "sword" maps to unicode char). Start with ~20 common RPG icons. PixiJS Text renders emoji well. No asset pipeline needed.

3. **Token initial creation flow for players**
   - What we know: DM creates tokens; players can change icon.
   - What's unclear: Does DM create a PC token for each player, or do players auto-get a token on join?
   - Recommendation: DM explicitly creates PC tokens and assigns them to players. This matches the DM-controls-everything philosophy.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: HexInteraction.tsx, TerrainLayer.tsx, session-manager.ts, message-handlers.ts, useMapStore.ts, useSessionStore.ts, ws-messages.ts
- Codebase analysis: hex-data.ts, fog.ts, campaign.ts DB schemas for schema patterns
- Codebase analysis: neighbors.ts (hexDistance), coordinates.ts (pixelToHex, hexCenterWorld pattern)

### Secondary (MEDIUM confidence)
- PixiJS 8 Container/Graphics/Text API: well-known from training data, consistent with existing codebase usage
- Drizzle ORM pgTable pattern: directly observed in existing schema files

### Tertiary (LOW confidence)
- Unicode emoji rendering in PixiJS Text: works in training data examples but rendering quality may vary by platform. Fallback: single-letter text.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all existing tools sufficient
- Architecture: HIGH - follows established patterns from phases 1-4 exactly
- Pitfalls: HIGH - identified from direct codebase analysis of existing interaction/rendering code

**Research date:** 2026-01-31
**Valid until:** 2026-03-01 (stable - no external dependencies changing)
