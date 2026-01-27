# Phase 3: Real-Time Infrastructure - Research

**Researched:** 2026-01-27
**Domain:** WebSocket real-time communication, session management, role-based state filtering
**Confidence:** HIGH

## Summary

This phase adds WebSocket-based real-time communication to the hex-crawl app, enabling DM-controlled sessions where connected clients receive live updates filtered by role. The existing stack (Hono on Node.js with `@hono/node-server`, Zustand on the client, PostgreSQL + Drizzle ORM) has a natural extension point: **`@hono/node-ws`** (v1.3.0), the official Hono WebSocket adapter for Node.js. This package integrates directly with the existing `@hono/node-server` setup via `createNodeWebSocket` and `injectWebSocket`.

The architecture follows a **server-side session room pattern** with in-memory `Map`-based connection tracking, cookie-based authentication during the WebSocket upgrade handshake, and a Zustand store on the client that receives WebSocket messages and updates local state. Session lifecycle (start/pause/end), staged vs. immediate broadcast modes, and per-player filtering are all managed server-side. An event log table in PostgreSQL captures session events for future replay.

**Primary recommendation:** Use `@hono/node-ws` v1.3.0 for WebSocket transport, authenticate via cookies during the HTTP upgrade handshake using `auth.api.getSession` inside the `upgradeWebSocket` callback (NOT via middleware), manage campaign sessions as in-memory room objects keyed by `campaignId`, and sync state to the client Zustand store via a dedicated `useSessionStore`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@hono/node-ws` | ^1.3.0 | WebSocket support for Hono on Node.js | Official Hono adapter; provides `createNodeWebSocket`, `upgradeWebSocket`, `injectWebSocket` |
| `hono` | 4.11.7 (installed) | HTTP framework | Already in use; WebSocket routes integrate via same app instance |
| `@hono/node-server` | 1.19.9 (installed) | Node.js HTTP server | Already in use; `injectWebSocket(server)` attaches WS to it |
| `zustand` | 5.0.10 (installed) | Client state management | Already in use; new `useSessionStore` for real-time state |
| `drizzle-orm` | 0.45.1 (installed) | Database ORM | Already in use; new tables for sessions and event logs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 4.3.6 (installed) | Message validation | Validate all WS messages (both directions) with Zod schemas in shared package |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@hono/node-ws` | `ws` directly | More control but loses Hono integration, context access, middleware pipeline |
| `@hono/node-ws` | Socket.IO | Heavier dependency, rooms built-in but overkill for this use case; project already uses Hono |
| In-memory session Map | Redis pub/sub | Needed for multi-server scaling; unnecessary for single-server MVP |
| Native WebSocket | `websocket-ts` (client) | Auto-reconnect with backoff built in, but adds 2kB dependency; native API is sufficient with a small custom wrapper |

**Installation:**
```bash
cd packages/server && pnpm add @hono/node-ws
```

No client-side library needed -- the browser's native `WebSocket` API is sufficient. Reconnection logic will be a small custom utility.

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/
├── ws/
│   ├── setup.ts              # createNodeWebSocket init, export upgradeWebSocket + injectWebSocket
│   ├── handler.ts            # upgradeWebSocket route handler (auth, join session room)
│   ├── session-manager.ts    # In-memory Map<campaignId, SessionRoom> with connection tracking
│   ├── message-handlers.ts   # Handle inbound WS messages (DM actions, player acks)
│   └── message-types.ts      # Server-side message type definitions (re-exports from shared)
├── db/schema/
│   ├── session.ts            # game_session + session_event tables
│   └── ... (existing)
└── ...

packages/shared/src/
├── ws-messages.ts            # Zod schemas for all WS message types (shared client + server)
├── session-types.ts          # Session state, event types, enums
└── ...

packages/client/src/
├── stores/
│   ├── useSessionStore.ts    # Session state: connection status, session lifecycle, staged changes
│   └── ... (existing)
├── hooks/
│   └── useWebSocket.ts       # WebSocket connection hook: connect, reconnect, dispatch to store
├── components/
│   ├── ConnectionBanner.tsx   # "Connection lost. Reconnecting..." persistent banner
│   ├── SessionOverlay.tsx     # "Waiting for DM" / "Session paused" overlays
│   └── ...
└── ...
```

### Pattern 1: WebSocket Setup with Hono Node.js
**What:** Initialize `@hono/node-ws` and attach to the Hono app and Node.js server
**When to use:** Server entry point setup
**Example:**
```typescript
// packages/server/src/ws/setup.ts
import { createNodeWebSocket } from '@hono/node-ws'
import type { Hono } from 'hono'

export function initWebSocket(app: Hono) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
  return { injectWebSocket, upgradeWebSocket }
}

// packages/server/src/index.ts (modified)
import { serve } from '@hono/node-server'
import app from './app.js'
import { initWebSocket } from './ws/setup.js'

const { injectWebSocket, upgradeWebSocket } = initWebSocket(app)

// Register WS route BEFORE middleware (critical -- see Pitfalls)
app.get('/ws', upgradeWebSocket((c) => {
  // auth + session logic here
  return { onOpen, onMessage, onClose }
}))

const server = serve({ fetch: app.fetch, port: 3000, hostname: '0.0.0.0' })
injectWebSocket(server)
```
**Source:** [Hono WebSocket Helper docs](https://hono.dev/docs/helpers/websocket), [@hono/node-ws GitHub](https://github.com/honojs/middleware/tree/main/packages/node-ws)

### Pattern 2: Cookie-Based Auth During WebSocket Upgrade
**What:** Authenticate users during the HTTP upgrade handshake by reading the session cookie
**When to use:** Every WebSocket connection establishment
**Example:**
```typescript
// Inside upgradeWebSocket callback
import { getCookie } from 'hono/cookie'
import { auth } from '../auth.js'

upgradeWebSocket(async (c) => {
  // Read session from cookies during HTTP upgrade handshake
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    // Return empty handlers -- connection will be rejected
    return {
      onOpen(_evt, ws) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }))
        ws.close(4001, 'Unauthorized')
      }
    }
  }

  const userId = session.user.id
  const campaignId = new URL(c.req.url).searchParams.get('campaignId')

  return {
    onOpen(_evt, ws) {
      sessionManager.addConnection(campaignId, userId, ws)
    },
    onMessage(event, ws) {
      handleMessage(campaignId, userId, event.data, ws)
    },
    onClose() {
      sessionManager.removeConnection(campaignId, userId)
    },
  }
})
```
**Source:** [Hono Discussion #2534](https://github.com/orgs/honojs/discussions/2534), [Better Auth + WS discussion](https://www.answeroverflow.com/m/1404759098020593755)

### Pattern 3: Server-Side Session Room Manager
**What:** In-memory Map tracking active campaign sessions and their connected clients
**When to use:** Core server-side state for the real-time system
**Example:**
```typescript
// packages/server/src/ws/session-manager.ts
import type { WSContext } from 'hono/ws'

interface ConnectedClient {
  userId: string
  role: 'dm' | 'player'
  ws: WSContext
}

interface SessionRoom {
  campaignId: string
  status: 'waiting' | 'active' | 'paused' | 'ended'
  broadcastMode: 'immediate' | 'staged'
  stagedChanges: SessionEvent[]
  connectedClients: Map<string, ConnectedClient> // userId -> client
  revealedHexes: Map<string, Set<string>> // hexKey -> Set<userId> (per-player reveals)
}

class SessionManager {
  private rooms = new Map<string, SessionRoom>()

  getOrCreateRoom(campaignId: string): SessionRoom { /* ... */ }
  addConnection(campaignId: string, userId: string, role: string, ws: WSContext) { /* ... */ }
  removeConnection(campaignId: string, userId: string) { /* ... */ }

  broadcastToRoom(campaignId: string, message: object, filter?: (client: ConnectedClient) => boolean) {
    const room = this.rooms.get(campaignId)
    if (!room) return
    const payload = JSON.stringify(message)
    for (const client of room.connectedClients.values()) {
      if (!filter || filter(client)) {
        client.ws.send(payload)
      }
    }
  }

  broadcastToDM(campaignId: string, message: object) {
    this.broadcastToRoom(campaignId, message, (c) => c.role === 'dm')
  }

  broadcastToPlayers(campaignId: string, message: object, playerIds?: string[]) {
    this.broadcastToRoom(campaignId, message, (c) => {
      if (c.role !== 'player') return false
      return !playerIds || playerIds.includes(c.userId)
    })
  }
}

export const sessionManager = new SessionManager() // singleton
```

### Pattern 4: Client WebSocket Hook with Reconnection
**What:** Custom React hook managing WebSocket lifecycle with exponential backoff reconnection
**When to use:** Client component connecting to a campaign session
**Example:**
```typescript
// packages/client/src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback } from 'react'
import { useSessionStore } from '../stores/useSessionStore'

const INITIAL_DELAY = 1000
const MAX_DELAY = 30000
const BACKOFF_MULTIPLIER = 2

export function useWebSocket(campaignId: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const dispatch = useSessionStore((s) => s.dispatch)
  const setConnectionStatus = useSessionStore((s) => s.setConnectionStatus)

  const connect = useCallback(() => {
    if (!campaignId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?campaignId=${campaignId}`)

    ws.onopen = () => {
      retryCountRef.current = 0
      setConnectionStatus('connected')
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      dispatch(message) // dispatch to Zustand store
    }

    ws.onclose = () => {
      setConnectionStatus('reconnecting')
      const delay = Math.min(
        INITIAL_DELAY * BACKOFF_MULTIPLIER ** retryCountRef.current,
        MAX_DELAY
      )
      // Add jitter: +/- 25%
      const jitter = delay * (0.75 + Math.random() * 0.5)
      retryCountRef.current++
      setTimeout(connect, jitter)
    }

    wsRef.current = ws
  }, [campaignId, dispatch, setConnectionStatus])

  useEffect(() => {
    connect()
    return () => { wsRef.current?.close() }
  }, [connect])

  return wsRef
}
```

### Pattern 5: Zustand Session Store
**What:** Client-side store for session state, connection status, and dispatching WS messages
**When to use:** All components needing real-time session data
**Example:**
```typescript
// packages/client/src/stores/useSessionStore.ts
import { create } from 'zustand'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
type SessionStatus = 'none' | 'waiting' | 'active' | 'paused' | 'ended'

interface SessionState {
  connectionStatus: ConnectionStatus
  sessionStatus: SessionStatus
  broadcastMode: 'immediate' | 'staged'
  stagedChanges: StagedChange[]
  revealedHexes: Set<string>
  connectedPlayers: Map<string, { online: boolean }>
  fogOpacity: number
  dmPreparing: boolean
}

interface SessionActions {
  setConnectionStatus: (status: ConnectionStatus) => void
  dispatch: (message: WsMessage) => void
  // ... more actions
}
```

### Anti-Patterns to Avoid
- **Applying CORS middleware to WebSocket routes:** Causes `TypeError: Headers are immutable`. Always register WS routes BEFORE middleware or scope middleware to `/api/*` only.
- **Using `requireAuth` middleware on WS routes:** Same immutable headers issue. Authenticate inside the `upgradeWebSocket` callback instead.
- **Sending full state on every update:** Wasteful for large maps. Use delta updates (changed hexes only) with full-state sync on initial connect and reconnect.
- **Storing WebSocket connections in the database:** Connections are ephemeral; use in-memory Map. Only persist session metadata and event logs.
- **Client-side state as source of truth:** The server session room is authoritative. Client state is a projection filtered by role.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket upgrade on Hono/Node | Raw `ws` library integration | `@hono/node-ws` `upgradeWebSocket()` | Handles HTTP upgrade, integrates with Hono context, provides WSContext |
| Message serialization/validation | Manual JSON parsing + type assertions | Zod schemas in `@hex-crawl/shared` | Type-safe, runtime-validated, shared between client and server |
| WebSocket protocol framing | Custom binary protocol | JSON over WebSocket (text frames) | Sufficient for this scale; simpler debugging; Zod validates structure |
| Auth during WS handshake | Custom token exchange protocol | Better Auth `auth.api.getSession({ headers })` on upgrade | Reuses existing cookie-based auth; no new auth flow needed |

**Key insight:** The existing stack already has all the building blocks. `@hono/node-ws` plugs directly into Hono, Better Auth validates sessions from cookies on the upgrade request, Drizzle handles persistence, and Zustand manages client state. The real work is designing the message protocol and session room logic, not integrating new libraries.

## Common Pitfalls

### Pitfall 1: CORS Middleware + WebSocket Immutable Headers
**What goes wrong:** `TypeError: Headers are immutable` crashes the WebSocket upgrade
**Why it happens:** Hono middleware (CORS, logger, etc.) tries to modify response headers, but `upgradeWebSocket()` returns a response with immutable headers
**How to avoid:** Register the WebSocket route BEFORE any middleware, OR scope middleware to non-WS paths (e.g., `app.use('/api/*', cors(...))` while WS is at `/ws`)
**Warning signs:** 101 upgrade requests failing; `TypeError` in server logs
**Source:** [Hono Issue #2535](https://github.com/honojs/hono/issues/2535), [Hono Issue #4090](https://github.com/honojs/hono/issues/4090)

### Pitfall 2: Vite Dev Proxy Must Enable WebSocket Forwarding
**What goes wrong:** WebSocket connections fail in development; client gets HTTP 200 instead of 101 upgrade
**Why it happens:** Vite's proxy defaults to HTTP only; `ws: true` must be explicitly set
**How to avoid:** Add a `/ws` proxy entry in `vite.config.ts` with `ws: true`:
```typescript
proxy: {
  '/api': { target: 'http://localhost:3000', changeOrigin: true },
  '/ws': { target: 'ws://localhost:3000', ws: true },
}
```
**Warning signs:** `WebSocket connection to 'ws://localhost:5173/ws' failed` in browser console
**Source:** [Vite Server Options](https://vite.dev/config/server-options)

### Pitfall 3: Message Loss on Immediate Send After Connection
**What goes wrong:** Messages sent by the client immediately after `ws.onopen` fires may be dropped
**Why it happens:** `@hono/node-ws` had an async gap between upgrade and `on("message")` handler registration (fixed in v1.3.0 via buffering)
**How to avoid:** Use `@hono/node-ws` >= 1.3.0 (which buffers messages). Additionally, have the server send an initial state message on `onOpen` instead of relying on client sending first.
**Warning signs:** First message from client not received; works after slight delay
**Source:** [Middleware Issue #1129](https://github.com/honojs/middleware/issues/1129)

### Pitfall 4: Zustand Map/Set Reactivity
**What goes wrong:** React components don't re-render when Map or Set contents change
**Why it happens:** Zustand compares by reference; mutating an existing Map/Set doesn't trigger re-render
**How to avoid:** Always create new `Map`/`Set` instances when updating (already established pattern in the codebase -- see `useMapStore.ts` "PITFALL 6" comments)
**Warning signs:** State updates visible in devtools but UI doesn't reflect changes
**Source:** Codebase convention (prior decision 01-01)

### Pitfall 5: Reconnection Thundering Herd
**What goes wrong:** All clients reconnect simultaneously after server restart, overwhelming it
**Why it happens:** Fixed reconnection delays without jitter
**How to avoid:** Use exponential backoff WITH random jitter (75%-125% of computed delay)
**Warning signs:** Server CPU spike immediately after restart; many simultaneous upgrade requests

### Pitfall 6: Cross-Site WebSocket Hijacking (CSWSH)
**What goes wrong:** Malicious website opens WebSocket to your server and browser sends cookies automatically
**Why it happens:** Browser Same-Origin Policy does NOT apply to WebSocket handshake
**How to avoid:** Validate `Origin` header in the `upgradeWebSocket` callback before authenticating
**Warning signs:** Unexpected WebSocket connections from unknown origins
**Source:** [Ably WebSocket Auth Guide](https://ably.com/blog/websocket-authentication)

## Code Examples

### Server Entry Point Modification
```typescript
// packages/server/src/index.ts (modified)
import "dotenv/config";
import { serve } from "@hono/node-server";
import app from "./app.js";
import { setupWebSocket } from "./ws/setup.js";

const { injectWebSocket } = setupWebSocket(app);

const port = Number(process.env.PORT) || 3000;

const server = serve(
  { fetch: app.fetch, port, hostname: "0.0.0.0" },
  (info) => {
    console.log(`Server running at http://0.0.0.0:${info.port}`);
  }
);

injectWebSocket(server);
```

### WebSocket Message Protocol (Shared Schemas)
```typescript
// packages/shared/src/ws-messages.ts
import { z } from 'zod';

// Server -> Client messages
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session:state'), data: z.object({
    status: z.enum(['waiting', 'active', 'paused', 'ended']),
    broadcastMode: z.enum(['immediate', 'staged']),
    connectedPlayers: z.array(z.object({ userId: z.string(), online: z.boolean() })),
    revealedHexes: z.array(z.string()), // hex keys visible to this client
  })}),
  z.object({ type: z.literal('session:statusChanged'), status: z.enum(['waiting', 'active', 'paused', 'ended']) }),
  z.object({ type: z.literal('hex:revealed'), hexKeys: z.array(z.string()), terrain: z.array(z.object({ key: z.string(), terrain: z.string() })) }),
  z.object({ type: z.literal('hex:updated'), changes: z.array(z.object({ key: z.string(), terrain: z.string() })) }),
  z.object({ type: z.literal('player:joined'), userId: z.string() }),
  z.object({ type: z.literal('player:left'), userId: z.string() }),
  z.object({ type: z.literal('dm:preparing'), preparing: z.boolean() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

// Client -> Server messages
export const ClientMessageSchema = z.discriminatedUnion('type', [
  // DM actions
  z.object({ type: z.literal('session:start') }),
  z.object({ type: z.literal('session:pause') }),
  z.object({ type: z.literal('session:resume') }),
  z.object({ type: z.literal('session:end') }),
  z.object({ type: z.literal('broadcast:mode'), mode: z.enum(['immediate', 'staged']) }),
  z.object({ type: z.literal('broadcast:publish') }), // publish staged changes
  z.object({ type: z.literal('hex:reveal'), hexKeys: z.array(z.string()), targets: z.union([
    z.literal('all'),
    z.object({ playerIds: z.array(z.string()) }),
  ])}),
  z.object({ type: z.literal('hex:update'), changes: z.array(z.object({ key: z.string(), terrain: z.string() })) }),
  z.object({ type: z.literal('staged:undo'), index: z.number() }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
```

### Session and Event Log Database Schema
```typescript
// packages/server/src/db/schema/session.ts
import { pgTable, pgEnum, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { campaign } from "./campaign";
import { user } from "./auth";

export const sessionStatusEnum = pgEnum("session_status", [
  "active", "paused", "ended"
]);

export const gameSession = pgTable("game_session", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaign.id, { onDelete: "cascade" }),
  startedBy: text("started_by")
    .notNull()
    .references(() => user.id),
  status: sessionStatusEnum("status").notNull().default("active"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

export const sessionEventTypeEnum = pgEnum("session_event_type", [
  "session_start", "session_pause", "session_resume", "session_end",
  "hex_reveal", "hex_update", "player_join", "player_leave",
  "token_move", // future: Phase 5
]);

export const sessionEvent = pgTable("session_event", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => gameSession.id, { onDelete: "cascade" }),
  eventType: sessionEventTypeEnum("event_type").notNull(),
  userId: text("user_id").references(() => user.id),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("session_event_session_idx").on(table.sessionId),
  index("session_event_created_idx").on(table.createdAt),
]);
```

### Vite Dev Proxy Configuration
```typescript
// packages/client/vite.config.ts (modified proxy section)
proxy: {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('origin', 'http://localhost:5173');
      });
    },
  },
  '/ws': {
    target: 'ws://localhost:3000',
    ws: true,
  },
},
```

### Origin Validation in WebSocket Handler
```typescript
// Inside upgradeWebSocket callback
const origin = c.req.header('origin')
const allowedOrigins = ['http://localhost:5173', 'http://10.241.120.98:5173']
if (origin && !allowedOrigins.includes(origin)) {
  return {
    onOpen(_evt, ws) {
      ws.close(4003, 'Forbidden origin')
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Socket.IO for all WS needs | Native WebSocket + thin adapter (`@hono/node-ws`) | 2024-2025 | Less overhead; framework-native integration; no client library needed |
| Full state sync on every update | Delta updates + full sync on reconnect | Industry standard | 40-60% less bandwidth; critical for maps with 500+ hexes |
| JWT in query string for WS auth | Cookie-based auth on upgrade handshake | Best practice | Avoids token leakage in logs; reuses existing session mechanism |
| Hand-rolled reconnection | Exponential backoff with jitter | Industry standard | Prevents thundering herd; graceful recovery |

**Deprecated/outdated:**
- Socket.IO's auto-transport negotiation (polling fallback) is unnecessary when targeting modern browsers with native WebSocket
- `@hono/node-ws` < 1.3.0 had a message-loss bug on immediate sends (fixed via buffering in 1.3.0)

## Open Questions

1. **`injectWebSocket` return value interaction with server reference**
   - What we know: `serve()` returns a Node.js HTTP server, `injectWebSocket(server)` attaches WS handling
   - What's unclear: Whether the current `serve()` call pattern in `index.ts` (which stores the return in a callback, not a variable) needs restructuring
   - Recommendation: Capture the `serve()` return value and pass to `injectWebSocket`. The current code already uses this pattern with a callback, which should work, but verify during implementation.

2. **`@hono/node-ws` typed WSContext API completeness**
   - What we know: `WSContext` provides `send()`, `close()`, `readyState`
   - What's unclear: Whether `WSContext` exposes `ping`/`pong` methods for heartbeat (native `ws` does, but Hono's abstraction may not)
   - Recommendation: Test during implementation. If heartbeat is needed, implement at the application level (periodic JSON ping messages).

3. **Per-player reveal state persistence across sessions**
   - What we know: The session event log captures reveal events; in-memory room tracks current state
   - What's unclear: Whether revealed hexes should be persisted to a separate table or reconstructed from the event log on session start
   - Recommendation: For MVP, persist revealed hex state per campaign in a `campaign_hex_state` table (simpler than replaying event log). Event log is for future replay feature.

## Sources

### Primary (HIGH confidence)
- [Hono WebSocket Helper docs](https://hono.dev/docs/helpers/websocket) - API, event handlers, caveats
- [@hono/node-ws GitHub](https://github.com/honojs/middleware/tree/main/packages/node-ws) - Setup pattern, API
- [Hono Issue #4090](https://github.com/honojs/hono/issues/4090) - CORS + WS fix (PR #1146)
- [Hono Issue #2535](https://github.com/honojs/hono/issues/2535) - Immutable headers root cause
- [Middleware Issue #1129](https://github.com/honojs/middleware/issues/1129) - Message drop fix (PR #1183, v1.3.0)
- [Vite Server Options](https://vite.dev/config/server-options) - WebSocket proxy config (`ws: true`)
- [Drizzle ORM PostgreSQL docs](https://orm.drizzle.team/docs/column-types/pg) - jsonb, pgEnum column types
- Codebase analysis - All existing files read and architectural patterns understood

### Secondary (MEDIUM confidence)
- [Hono Discussion #2534](https://github.com/orgs/honojs/discussions/2534) - JWT/bearer auth with WS upgrade
- [Ably WebSocket Auth Guide](https://ably.com/blog/websocket-authentication) - Cookie auth patterns, CSWSH prevention
- [websockets library docs](https://websockets.readthedocs.io/en/stable/topics/authentication.html) - Auth handshake patterns
- [Zustand WS Discussion #1651](https://github.com/pmndrs/zustand/discussions/1651) - WS integration patterns
- [Better Auth + WS community post](https://www.answeroverflow.com/m/1404759098020593755) - Better Auth WS auth approach

### Tertiary (LOW confidence)
- [DEV Community - WS reconnection](https://dev.to/hexshift/robust-websocket-reconnection-strategies-in-javascript-with-exponential-backoff-40n1) - Backoff patterns
- [OneUptime React WS guide](https://oneuptime.com/blog/post/2026-01-15-websockets-react-real-time-applications/view) - React + WS patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - `@hono/node-ws` is the official adapter; verified via docs and GitHub; all other libraries already installed
- Architecture: HIGH - Server-side room pattern is well-established; cookie auth during upgrade is documented; Zustand store pattern follows existing codebase conventions
- Pitfalls: HIGH - All pitfalls verified with GitHub issues and official documentation; CORS issue has specific PR references
- Database schema: MEDIUM - Schema design follows Drizzle conventions from existing codebase, but event log payload shape may evolve during implementation
- Reconnection strategy: MEDIUM - Exponential backoff with jitter is industry standard but specific timing values (1s initial, 30s max) are recommendations, not verified via this specific stack

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - stable libraries, established patterns)
