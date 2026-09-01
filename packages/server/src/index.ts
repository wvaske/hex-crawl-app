import { serve } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { ClientCommandSchema, seededRng } from '@hexcrawl/shared';
import { HOST, PORT } from './config.js';
import { openDatabase } from './db/index.js';
import { Store } from './state/store.js';
import { Hub, type Conn } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { createApp } from './http/app.js';
import { seatCookieName } from './http/app.js';

// Boot is the one asynchronous phase: an alternate backend (DATABASE_URL) has
// to connect and migrate, and `Store.create` warms every campaign into memory
// before the first request, because everything after this point reads from
// memory synchronously. See db/driver.ts.
const db = await openDatabase();
const store = await Store.create(db);
const hub = new Hub();
const rng = seededRng(Date.now() ^ (Math.random() * 0xffffffff));
const app = createApp(store, hub);

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(
    `HexCrawl server listening on http://${info.address}:${info.port} (storage: ${db.dialect})`,
  );
});

/**
 * Postgres writes are queued, so a hard exit can drop the last few. Flush them
 * (and close the connection) before going away. No-op on SQLite.
 */
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    void db
      .close()
      .catch((err) => console.error('[db] shutdown flush failed:', err))
      .finally(() => process.exit(0));
  });
}

const wss = new WebSocketServer({ noServer: true });

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const campaignId = url.searchParams.get('campaign') ?? '';
  const runtime = store.getCampaign(campaignId);
  if (!runtime) {
    socket.destroy();
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const seat = store.findSeatByToken(runtime, cookies[seatCookieName(campaignId)] ?? null);
  if (!seat) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, { runtime, seat });
  });
});

wss.on(
  'connection',
  (ws: WebSocket, _req: IncomingMessage, ctx: { runtime: ReturnType<Store['getCampaign']>; seat: NonNullable<ReturnType<Store['findSeatByToken']>> }) => {
    const runtime = ctx.runtime!;
    const conn: Conn = { ws, runtime, seat: ctx.seat };
    hub.add(conn);

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        hub.send(conn, { type: 'error', commandId: null, message: 'Malformed JSON' });
        return;
      }
      const result = ClientCommandSchema.safeParse(parsed);
      if (!result.success) {
        const id =
          typeof parsed === 'object' && parsed !== null && 'id' in parsed
            ? String((parsed as { id: unknown }).id)
            : null;
        hub.send(conn, { type: 'error', commandId: id, message: 'Invalid command' });
        return;
      }
      const cmd = result.data;
      // view.map is per-connection state, not campaign state.
      if (cmd.kind === 'view.map') {
        if (!runtime.maps.has(cmd.mapId)) {
          hub.send(conn, { type: 'error', commandId: cmd.id, message: 'Map not found' });
          return;
        }
        conn.viewedMapId = cmd.mapId;
        hub.sendSnapshot(conn);
        hub.send(conn, { type: 'ack', commandId: cmd.id });
        return;
      }
      try {
        // Re-resolve the seat each command: character claims may have changed.
        dispatchCommand(cmd, { runtime, seat: ctx.seat, hub, rng });
        hub.send(conn, { type: 'ack', commandId: cmd.id });
      } catch (err) {
        hub.send(conn, {
          type: 'error',
          commandId: cmd.id,
          message: err instanceof Error ? err.message : 'Command failed',
        });
      }
    });

    ws.on('close', () => hub.remove(conn));
    ws.on('error', () => hub.remove(conn));
  },
);
