import { beforeEach, describe, expect, it } from 'vitest';
import { seededRng } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Session-mark command (issue #78): DM-only, appends a 'session' log entry
 * carrying {action, atMinutes}. Recap grouping itself is pure logic tested
 * in packages/shared/src/rules/recap.test.ts against this entry shape.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `c${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `c${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Test Campaign', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
});

describe('session.mark', () => {
  it('is DM-only', () => {
    const player = runtime.createSeat('player', 'Mallory');
    expect(() => asSeat(player, { kind: 'session.mark', action: 'start' } as never)).toThrow(/DM/);
    expect(runtime.log.filter((e) => e.kind === 'session')).toHaveLength(0);
  });

  it('appends a "session" log entry visible to all, carrying action and the current clock reading', () => {
    // Default campaign clock starts at 8:00 AM Day 1 (480 minutes) — advance
    // it so the mark's atMinutes is distinguishable from the initial value.
    dm({ kind: 'time.advance', minutes: 100 } as never);
    const clockBefore = runtime.campaign.time.minutes;

    dm({ kind: 'session.mark', action: 'start' } as never);

    const entries = runtime.log.filter((e) => e.kind === 'session');
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.visibility).toBe('all');
    expect(entry.data).toMatchObject({ action: 'start', atMinutes: clockBefore });
    expect(entry.text).toContain('Session started');
    expect(entry.text).toContain('Day');
  });

  it('records start and end marks independently, each stamped with the clock at that moment', () => {
    dm({ kind: 'session.mark', action: 'start' } as never);
    dm({ kind: 'time.advance', minutes: 240 } as never);
    dm({ kind: 'session.mark', action: 'end' } as never);

    const [start, end] = runtime.log.filter((e) => e.kind === 'session');
    expect(start!.data.action).toBe('start');
    expect(end!.data.action).toBe('end');
    expect((end!.data.atMinutes as number) - (start!.data.atMinutes as number)).toBe(240);
    expect(end!.text).toContain('Session ended');
  });

  it('accepts either action repeatedly — the client decides which button to show', () => {
    dm({ kind: 'session.mark', action: 'start' } as never);
    dm({ kind: 'session.mark', action: 'start' } as never);
    dm({ kind: 'session.mark', action: 'end' } as never);
    expect(runtime.log.filter((e) => e.kind === 'session')).toHaveLength(3);
  });
});
