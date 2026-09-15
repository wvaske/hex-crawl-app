import { beforeEach, describe, expect, it } from 'vitest';
import { filterStateForViewer, seededRng } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import {
  DdbGameLogConnector,
  importRoll,
  matchCharacter,
  parseGameLogEvent,
  skillOf,
  userIdFromClaims,
} from './engine/ddbGameLog.js';

/**
 * D&D Beyond game-log import (issue #146): the mapper from the (unofficial)
 * feed's events to HexCrawl rolls, character matching, dedupe, whisper
 * visibility, and an imported skill check counting as a hex search.
 *
 * The fixture below is the community-documented event shape; step 0 of the
 * issue (the capture script) confirms it against a live campaign.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `g${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(5),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `g${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(5),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('DDB', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

function member(name: string, ddbId: string | null, q = 0): { charId: string; seat: SeatRecord } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name,
      color: '#00aa00',
      glyph: '',
      speed: 30,
      skills: { perception: 5 },
      proficiencies: [],
      ddbId,
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.values()].find((c) => c.name === name)!.id;
  const seat = runtime.createSeat('player', `${name}'s player`);
  asSeat(seat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  seat.characterId = charId;
  dm({
    kind: 'token.create',
    mapId,
    q,
    r: 0,
    tokenKind: 'pc',
    characterId: charId,
    label: '',
    color: '#00aa00',
    glyph: '',
    playerVisible: true,
  } as never);
  return { charId, seat };
}

/** A fulfilled roll event as the feed sends it. */
function event(over: {
  id?: string;
  action?: string;
  rollType?: string;
  rollKind?: string;
  values?: number[];
  constant?: number;
  total?: number;
  entityId?: string;
  name?: string;
  scope?: string;
  notation?: string;
}) {
  const values = over.values ?? [14];
  const constant = over.constant ?? 5;
  return JSON.stringify({
    id: over.id ?? 'evt-1',
    eventType: 'dice/roll/fulfilled',
    gameId: '99',
    userId: 1,
    dateTime: '2026-09-15T20:00:00Z',
    messageScope: over.scope ?? 'gameId',
    messageTarget: '99',
    entityType: 'character',
    entityId: over.entityId ?? '12345',
    data: {
      action: over.action ?? 'Perception',
      context: {
        entityId: over.entityId ?? '12345',
        entityType: 'character',
        name: over.name ?? 'Carl',
      },
      rollId: over.id ?? 'roll-1',
      rolls: [
        {
          diceNotation: over.notation ?? `1d20+${constant}`,
          diceNotationStr: over.notation ?? `1d20+${constant}`,
          rollType: over.rollType ?? 'check',
          rollKind: over.rollKind ?? '',
          result: {
            constant,
            values,
            total: over.total ?? Math.max(...values) + constant,
            text: `${values.join('+')}+${constant}`,
          },
        },
      ],
    },
  });
}

describe('userIdFromClaims', () => {
  it('reads sub, plain ids, or .NET schema-URI claims, and gives up quietly', () => {
    expect(userIdFromClaims({ sub: '42' })).toBe('42');
    expect(userIdFromClaims({ userId: 7 })).toBe('7');
    expect(
      userIdFromClaims({
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': '99',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'wes',
      }),
    ).toBe('99');
    expect(userIdFromClaims({ displayName: 'wes', exp: 1 })).toBe('');
  });
});

describe('parseGameLogEvent', () => {
  it('reads a plain check', () => {
    const roll = parseGameLogEvent(event({}))!;
    expect(roll).toMatchObject({
      id: 'roll-1',
      characterDdbId: '12345',
      characterName: 'Carl',
      action: 'Perception',
      rollType: 'check',
      advantage: 'none',
      roll: 14,
      modifier: 5,
      total: 19,
      whisper: false,
    });
  });

  it('keeps the high die under advantage and the low one under disadvantage', () => {
    const adv = parseGameLogEvent(event({ rollKind: 'advantage', values: [3, 17], total: 22 }))!;
    expect(adv).toMatchObject({ advantage: 'advantage', roll: 17, values: [3, 17], total: 22 });
    const dis = parseGameLogEvent(event({ rollKind: 'disadvantage', values: [3, 17], total: 8 }))!;
    expect(dis).toMatchObject({ advantage: 'disadvantage', roll: 3, total: 8 });
  });

  it('ignores pending rolls, non-dice events and junk', () => {
    expect(
      parseGameLogEvent(event({}).replace('dice/roll/fulfilled', 'dice/roll/pending')),
    ).toBeNull();
    expect(parseGameLogEvent('{"eventType":"presence/joined"}')).toBeNull();
    expect(parseGameLogEvent('not json')).toBeNull();
  });

  it('marks whispers and sums non-d20 damage dice', () => {
    const whisper = parseGameLogEvent(event({ scope: 'userId' }))!;
    expect(whisper.whisper).toBe(true);
    const dmg = parseGameLogEvent(
      event({
        action: 'Longsword',
        rollType: 'damage',
        notation: '2d6+3',
        values: [4, 5],
        constant: 3,
        total: 12,
      }),
    )!;
    expect(dmg).toMatchObject({ rollType: 'damage', roll: 9, modifier: 3, total: 12 });
  });
});

describe('matching and importing', () => {
  it('matches by linked D&D Beyond id first, then by name; unmatched rolls still log', () => {
    member('Carl', '12345');
    member('Gootcha', null, 1);
    const byId = parseGameLogEvent(event({ entityId: '12345', name: 'Someone Else' }))!;
    expect(matchCharacter(runtime, byId)!.name).toBe('Carl');
    const byName = parseGameLogEvent(event({ entityId: '777', name: 'gootcha' }))!;
    expect(matchCharacter(runtime, byName)!.name).toBe('Gootcha');
    const nobody = parseGameLogEvent(event({ id: 'x', entityId: '888', name: 'Stranger' }))!;
    expect(matchCharacter(runtime, nobody)).toBeNull();
    expect(importRoll(runtime, hub, nobody)).toBe(true);
    const entry = runtime.log[runtime.log.length - 1]!;
    expect(entry.kind).toBe('check');
    expect(entry.data).toMatchObject({ source: 'ddb', unmatched: true });
    expect(entry.text).toMatch(/Stranger: 19/);
  });

  it('logs a matched check with the tray-roll shape, tagged with the hex, and dedupes', () => {
    const { charId, seat } = member('Carl', '12345', 3);
    const roll = parseGameLogEvent(event({ rollKind: 'advantage', values: [9, 14] }))!;
    expect(importRoll(runtime, hub, roll)).toBe(true);
    const entry = runtime.log[runtime.log.length - 1]!;
    expect(entry.visibility).toBe('all');
    expect(entry.data).toMatchObject({
      source: 'ddb',
      skill: 'perception',
      hex: { q: 3, r: 0 },
      search: false,
      results: [
        {
          characterId: charId,
          roll: 14,
          modifier: 5,
          total: 19,
          detail: { advantage: 'advantage', rolls: [9, 14] },
        },
      ],
    });
    expect(entry.text).toMatch(/D&D Beyond: Carl: 19/);
    // The player sees their own roll like any other.
    const view = filterStateForViewer(runtime.buildFullState(), {
      seatId: seat.id,
      role: 'player',
      characterId: charId,
    });
    expect(view.log.some((e) => e.id === entry.id)).toBe(true);
    // Same roll id again: nothing.
    expect(importRoll(runtime, hub, roll)).toBe(false);
    expect(runtime.log.filter((e) => e.data.source === 'ddb')).toHaveLength(1);
    // Durable across a reload.
    const reloaded = new Store(store.db).getCampaign(runtime.id)!;
    expect(reloaded.hasImportedRoll('roll-1')).toBe(true);
  });

  it('keeps whispers DM-only', () => {
    member('Carl', '12345');
    importRoll(runtime, hub, parseGameLogEvent(event({ scope: 'userId' }))!);
    expect(runtime.log[runtime.log.length - 1]!.visibility).toBe('dm');
  });

  it('skillOf maps only checks the app knows', () => {
    const carl = [...runtime.characters.values()][0] ?? null;
    expect(skillOf(parseGameLogEvent(event({ action: 'Perception' }))!, carl)).toBe('perception');
    expect(
      skillOf(parseGameLogEvent(event({ action: 'Longsword', rollType: 'to hit' }))!, carl),
    ).toBeNull();
    expect(
      skillOf(parseGameLogEvent(event({ action: 'Wisdom', rollType: 'save' }))!, carl),
    ).toBeNull();
  });
});

describe('counting as a search', () => {
  it('an imported skill check can queue a pending reveal exactly like a tray search', () => {
    const mapId = runtime.campaign.activeMapId!;
    const { charId } = member('Carl', '12345');
    dm({
      kind: 'content.upsert',
      content: {
        id: null,
        mapId,
        q: 0,
        r: 0,
        type: 'ruin',
        title: 'Cairn',
        dmNotes: '',
        glyph: '',
        clues: [
          {
            id: null,
            text: 'A hidden niche',
            gate: { kind: 'skill', skill: 'perception', dc: 15, maxDistance: 0, mode: 'active' },
            sortOrder: 0,
          },
        ],
      },
    } as never);
    // Off by default: the roll logs, nothing is searched.
    importRoll(runtime, hub, parseGameLogEvent(event({ id: 'a', values: [18] }))!);
    expect(runtime.pendingReveals.size).toBe(0);
    dm({ kind: 'campaign.update', settings: { ddbGameLog: { countAsSearch: true } } } as never);
    importRoll(runtime, hub, parseGameLogEvent(event({ id: 'b', values: [18] }))!);
    expect(runtime.pendingReveals.size).toBe(1);
    expect([...runtime.pendingReveals.values()][0]!.characterId).toBe(charId);
    const attempts = [...runtime.requireMap(mapId).searchAttempts.values()];
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.total).toBe(23);
    const entry = runtime.log[runtime.log.length - 1]!;
    expect(entry.data).toMatchObject({ search: true, pending: 1 });
    // A second Perception roll here is a re-roll: dice only.
    importRoll(runtime, hub, parseGameLogEvent(event({ id: 'c', values: [20] }))!);
    expect(runtime.requireMap(mapId).searchAttempts.size).toBe(1);
    expect(runtime.pendingReveals.size).toBe(1);
  });
});

describe('connector', () => {
  it('feeds socket messages through the importer and keeps a status trail', () => {
    member('Carl', '12345');
    const connector = new DdbGameLogConnector(runtime, hub);
    connector.onMessage('{"eventType":"presence/joined"}');
    expect(connector.status.imported).toBe(0);
    expect(connector.status.recent).toHaveLength(1);
    connector.onMessage(event({ id: 'r1' }));
    connector.onMessage(event({ id: 'r1' }));
    connector.onMessage(event({ id: 'r2', values: [2] }));
    expect(connector.status.imported).toBe(2);
    expect(connector.status.lastEventAt).not.toBeNull();
    expect(runtime.buildFullState().ddbGameLog).toMatchObject({ imported: 2, hasSecret: false });
    // Players never see the listener's status (raw events include whispers).
    const seat = runtime.createSeat('player', 'P');
    expect(
      filterStateForViewer(runtime.buildFullState(), {
        seatId: seat.id,
        role: 'player',
        characterId: null,
      }).ddbGameLog,
    ).toBeNull();
  });

  it('secrets are stored server-side and never exported', () => {
    runtime.setSecret('ddbCobalt', 'abc');
    expect(runtime.getSecret('ddbCobalt')).toBe('abc');
    expect(runtime.buildFullState().ddbGameLog!.hasSecret).toBe(true);
    expect(JSON.stringify(runtime.buildFullState())).not.toContain('abc');
    runtime.setSecret('ddbCobalt', null);
    expect(runtime.getSecret('ddbCobalt')).toBeNull();
  });
});
