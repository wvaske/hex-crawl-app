---
phase: 05-tokens-and-movement
verified: 2026-01-31T19:30:00Z
status: passed
score: 5/5 must-haves verified
gaps: []
re_verified: true
fix_commit: "1cc71d8 - fix(05): wire TokenLayer display objects to drag registry"
---

# Phase 5: Tokens & Movement Verification Report

**Phase Goal:** Each player controls a character token on the map, moves it by dragging to adjacent hexes, and all connected users see every token position update in real time

**Verified:** 2026-01-31T19:30:00Z
**Status:** passed (after orchestrator fix)
**Re-verification:** Yes — gap fixed by orchestrator commit 1cc71d8

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Each player has a character token displayed on the hex map | ✓ VERIFIED | TokenLayer renders tokens from store at hex centers with icon+ring. Map endpoint returns tokens. WebSocket loads tokens into store. |
| 2 | A player can drag their token to an adjacent hex and it snaps to the hex center | ✓ VERIFIED | HexInteraction has complete drag logic. TokenLayer registers display objects via registerTokenDisplay() (fixed in 1cc71d8). |
| 3 | When one player moves their token, all other connected users see the token move in real time | ✓ VERIFIED | Server broadcasts token:moved to all clients. WebSocket handler updates store. TokenLayer re-renders on store changes. |
| 4 | Token positions persist across sessions | ✓ VERIFIED | DB schema has campaign_token table. Handlers persist moves to DB. Map endpoint loads from DB. |
| 5 | A player can only move their own token, not other players' tokens | ✓ VERIFIED | Server handler checks `role === "player" && token.ownerId !== userId` and rejects with error. HexInteraction client-side checks `token.ownerId === userId` before allowing drag start. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/db/schema/token.ts` | Token DB schema | ✓ VERIFIED | 33 lines. campaignToken pgTable with all required fields (id, campaignId, hexKey, ownerId, label, icon, color, tokenType, visible, createdBy). FK to campaign with cascade delete. |
| `packages/shared/src/hex-types.ts` | Token TypeScript interface | ✓ VERIFIED | Token interface (lines 72-81) with all fields matching DB schema. parseHexKey helper exported. |
| `packages/shared/src/ws-messages.ts` | Token WS message schemas | ✓ VERIFIED | 9 token message schemas defined with Zod. Client->Server: token:move, token:create, token:update, token:delete. Server->Client: token:moved, token:created, token:updated, token:deleted, token:state. All in discriminated unions. |
| `packages/server/src/ws/message-handlers.ts` | Token handlers | ✓ VERIFIED | 200+ lines of token handlers (lines 677-877). handleTokenMove with adjacency validation (inline hexDistance), handleTokenCreate (DM only), handleTokenUpdate (role-based permissions), handleTokenDelete (DM only). All persist to DB and broadcast. |
| `packages/server/src/routes/map.ts` | Token data in map endpoint | ✓ VERIFIED | Lines 99-159. Queries campaign_token, filters by visible for players, returns tokens array in response. DM sees all, players see only visible=true. |
| `packages/client/src/stores/useTokenStore.ts` | Token state management | ✓ VERIFIED | 73 lines. Zustand store with Map<string, Token> and all CRUD methods. Follows Map reactivity pattern (creates new Map on mutations). |
| `packages/client/src/canvas/TokenSprite.ts` | Token display utilities | ✓ VERIFIED | 128 lines. createTokenDisplayObject (colored ring + emoji icon), layoutTokensInHex (1/2/3+ layout logic), updateTokenDisplayObject. Imperative PixiJS code, not React. |
| `packages/client/src/canvas/layers/TokenLayer.tsx` | Token rendering layer | ✓ VERIFIED | 116 lines. Renders tokens at hex centers, groups by hex, filters visible for players, removes stale objects. Registers display objects with HexInteraction drag system (fixed in 1cc71d8). |
| `packages/client/src/canvas/HexInteraction.tsx` | Token drag interaction | ✓ VERIFIED | 600+ lines. Hit-testing by distance from hex center, permission checks, adjacency validation, optimistic updates, smooth animation, WS message sending. **DEPENDS on tokenDisplayMap** which is empty. |
| `packages/client/src/components/SidePanel.tsx` | DM token creation UI | ✓ VERIFIED | 483 lines total. TokenCreationForm: name input, 16 emoji grid, 8 color circles, PC/NPC toggle, player assignment dropdown, "Place Token" button. TokenList: displays all tokens with visibility toggle and delete buttons. Sends token:create, token:update, token:delete messages. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| TokenLayer | useTokenStore | subscription | ✓ WIRED | Line 38: `const tokens = useTokenStore((s) => s.tokens)`. useEffect re-renders on changes (line 42). |
| HexInteraction | useTokenStore | optimistic update | ✓ WIRED | Line 458: `useTokenStore.getState().moveToken(tokenDrag.tokenId, targetKey)` after valid move. |
| HexInteraction | WebSocket | sendMessage | ✓ WIRED | Lines 451-455: `sendMessage({ type: 'token:move', tokenId, toHexKey })` for valid moves. |
| WebSocket | useTokenStore | dispatch | ✓ WIRED | useSessionStore handles token:moved (line 244), token:created (254), token:updated (258), token:deleted (262), token:state (266). All call useTokenStore methods. |
| map.ts | DB | query | ✓ WIRED | Lines 100-103: `db.select().from(campaignToken).where(eq(...))`. Filters by visible for players (line 159). |
| message-handlers | DB | CRUD | ✓ WIRED | handleTokenMove updates DB (lines 735-738), handleTokenCreate inserts (lines 757-768), handleTokenUpdate updates (lines 826-851), handleTokenDelete deletes (lines 864-871). |
| TokenLayer | HexInteraction drag | registerTokenDisplay | ✓ WIRED | TokenLayer calls registerTokenDisplay after creating display objects and unregisterTokenDisplay when removing stale ones (fixed in 1cc71d8). |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| TOK-01: Each player controls their own character token on the map | ✓ SATISFIED | Token ownership tracked via ownerId. Permission checks in place. |
| TOK-02: Players move their tokens by dragging to adjacent hexes | ✓ SATISFIED | Drag logic complete, display registry wired (fixed in 1cc71d8). |
| TOK-03: Token positions update in real time for all connected users | ✓ SATISFIED | WebSocket broadcast + store updates + layer re-render all wired. |
| TOK-04: Token positions persist across sessions | ✓ SATISFIED | DB persistence + map endpoint loading verified. |
| RT-04: All connected users see all character tokens in real time | ✓ SATISFIED | Token visibility filtering works. Real-time updates via WS. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| packages/client/src/canvas/layers/TokenLayer.tsx | 90 | Display object created but not registered | 🛑 Blocker | Prevents token dragging - core feature of phase goal |
| packages/client/src/canvas/HexInteraction.tsx | 262, 347, 414, 435, 464, 582 | tokenDisplayMap.get() will return undefined | 🛑 Blocker | Drag pointermove, drag start, snap-back, and animation all fail silently |

### Human Verification Required

None - the gap is structural and can be verified programmatically.

### Gaps Summary

**One critical gap blocks Truth #2 (token dragging):**

The TokenLayer component (05-03) creates PixiJS Container display objects for each token but never registers them with the module-level `tokenDisplayMap` that HexInteraction (05-04) depends on for dragging.

**Root cause:** The two plans were developed independently. 05-03 created TokenLayer with an imperative rendering pattern. 05-04 added the module-level registry pattern (`registerTokenDisplay`/`unregisterTokenDisplay`) but never wired it back to TokenLayer.

**Impact:** 
- Tokens render correctly on the map ✓
- Tokens receive real-time updates ✓
- Tokens persist across sessions ✓
- **Tokens are NOT draggable** ✗ (HexInteraction can't find display objects to move during drag)
- **Token animations don't work** ✗ (animateTokenMove can't access containers)

**Fix:** Add 3 lines to TokenLayer.tsx:
1. Import `registerTokenDisplay` and `unregisterTokenDisplay` from `../HexInteraction`
2. Call `registerTokenDisplay(token.id, display)` after creating each display object (after line 92)
3. Call `unregisterTokenDisplay(id)` when removing stale display objects (in the forEach loop at line 73)

---

_Verified: 2026-01-31T19:30:00Z_
_Verifier: Claude (gsd-verifier)_
