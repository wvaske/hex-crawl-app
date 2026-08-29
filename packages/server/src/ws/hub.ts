import type { WebSocket } from 'ws';
import type { ServerMessage, Viewer } from '@hexcrawl/shared';
import { filterStateForViewer } from '@hexcrawl/shared';
import type { CampaignRuntime, SeatRecord } from '../state/runtime.js';

export interface Conn {
  ws: WebSocket;
  runtime: CampaignRuntime;
  seat: SeatRecord;
}

const SYNC_COALESCE_MS = 40;

/**
 * Connection registry + snapshot-driven sync.
 *
 * Every mutation calls `scheduleSync`; shortly after, each connected client
 * receives a fresh snapshot filtered for its seat via filterStateForViewer —
 * the single security boundary. Targeted messages (acks, toasts, animation
 * hints) are sent directly.
 */
export class Hub {
  private rooms = new Map<string, Set<Conn>>();
  private pendingSync = new Map<string, NodeJS.Timeout>();

  add(conn: Conn): void {
    let room = this.rooms.get(conn.runtime.id);
    if (!room) {
      room = new Set();
      this.rooms.set(conn.runtime.id, room);
    }
    room.add(conn);
    conn.runtime.online.add(conn.seat.id);
    this.sendSnapshot(conn);
    this.scheduleSync(conn.runtime); // others see presence change
  }

  remove(conn: Conn): void {
    const room = this.rooms.get(conn.runtime.id);
    room?.delete(conn);
    // Seat may still be connected from another tab.
    const stillConnected = [...(room ?? [])].some((c) => c.seat.id === conn.seat.id);
    if (!stillConnected) conn.runtime.online.delete(conn.seat.id);
    this.scheduleSync(conn.runtime);
  }

  viewerFor(seat: SeatRecord): Viewer {
    return { seatId: seat.id, role: seat.role, characterId: seat.characterId };
  }

  sendSnapshot(conn: Conn): void {
    const full = conn.runtime.buildFullState();
    const state = filterStateForViewer(full, this.viewerFor(conn.seat));
    this.send(conn, { type: 'snapshot', seatId: conn.seat.id, role: conn.seat.role, state });
  }

  send(conn: Conn, message: ServerMessage): void {
    if (conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.send(JSON.stringify(message));
    }
  }

  /** Send a message to specific seats (and optionally the DM). */
  sendTo(
    runtime: CampaignRuntime,
    message: ServerMessage,
    opts: { seatIds?: string[]; dm?: boolean; all?: boolean },
  ): void {
    const room = this.rooms.get(runtime.id);
    if (!room) return;
    for (const conn of room) {
      const isDm = conn.seat.role === 'dm';
      if (
        opts.all ||
        (opts.dm && isDm) ||
        (opts.seatIds && opts.seatIds.includes(conn.seat.id))
      ) {
        this.send(conn, message);
      }
    }
  }

  /** Coalesced full-state resync for every client in the campaign. */
  scheduleSync(runtime: CampaignRuntime): void {
    if (this.pendingSync.has(runtime.id)) return;
    this.pendingSync.set(
      runtime.id,
      setTimeout(() => {
        this.pendingSync.delete(runtime.id);
        const room = this.rooms.get(runtime.id);
        if (!room) return;
        const full = runtime.buildFullState();
        for (const conn of room) {
          const state = filterStateForViewer(full, this.viewerFor(conn.seat));
          this.send(conn, { type: 'snapshot', seatId: conn.seat.id, role: conn.seat.role, state });
        }
      }, SYNC_COALESCE_MS),
    );
  }
}
