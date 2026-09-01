import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WEATHER_TABLE,
  HARPTOS_PRESET,
  MINUTES_PER_DAY,
  filterStateForViewer,
  rollDice,
  seededRng,
} from '@hexcrawl/shared';
import type { ClientCommand, WeatherEntry } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Weather + calendar (issue #79).
 *
 * Every dispatch gets a FRESH `seededRng(1)`, exactly like the main test
 * harness — so the nth weather roll inside one command is reproducible here by
 * pulling n rolls off a fresh `seededRng(1)`, which is how "one roll per
 * crossed day" is pinned down below.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `w${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `w${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

/** A 1d20 table where every face has its own text, so rolls are identifiable. */
const NUMBERED_TABLE: WeatherEntry[] = Array.from({ length: 20 }, (_, i) => ({
  min: i + 1,
  max: i + 1,
  text: `W${i + 1}`,
  icon: '🌡️',
}));

/** The text the nth 1d20 roll off a fresh seeded rng maps to in that table. */
function nthRollText(n: number): string {
  const rng = seededRng(1);
  let total = 0;
  for (let i = 0; i < n; i++) total = rollDice('1d20', rng).total;
  return `W${total}`;
}

function weatherLog(): { text: string; visibility: string }[] {
  return runtime.log.filter((e) => e.kind === 'weather');
}

beforeEach(() => {
  cmdCounter = 0;
  store = new Store(createTestDb());
  const created = store.createCampaign('Weather Campaign', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  dm({ kind: 'map.create', name: 'Region', orientation: 'flat', hexSize: 48 } as never);
  dm({ kind: 'campaign.update', settings: { weatherTable: NUMBERED_TABLE } } as never);
});

function activeMapId(): string {
  return runtime.campaign.activeMapId!;
}

/** A claimed PC on the active map, ready to walk. */
function setupParty(): { mapId: string; tokenId: string; playerSeat: SeatRecord } {
  const mapId = activeMapId();
  dm({
    kind: 'character.create',
    character: {
      name: 'Scout', color: '#00aa00', glyph: '🏹', speed: 30, skills: {},
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.keys()][0]!;
  const playerSeat = runtime.createSeat('player', 'Alice');
  asSeat(playerSeat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  playerSeat.characterId = runtime.seats.get(playerSeat.id)!.characterId;
  dm({
    kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'pc', characterId: charId,
    label: '', color: '#00aa00', glyph: '', playerVisible: true,
  } as never);
  const tokenId = [...runtime.requireMap(mapId).tokens.keys()][0]!;
  return { mapId, tokenId, playerSeat };
}

describe('weather rolling', () => {
  it('starts with no weather and seeds a sky on the first clock advance', () => {
    expect(runtime.campaign.time.weather).toBeNull();
    expect(weatherLog()).toHaveLength(0);

    // 8:00 AM + 1h stays inside day 1, but the campaign has no sky yet.
    dm({ kind: 'time.advance', minutes: 60 } as never);
    expect(runtime.campaign.time.weather).toMatchObject({
      text: nthRollText(1),
      rolledAtMinutes: 9 * 60,
    });
    expect(weatherLog()).toHaveLength(1);
    expect(weatherLog()[0]!.text).toBe(`The weather turns: ${nthRollText(1)}`);
    // The sky is not a DM secret.
    expect(weatherLog()[0]!.visibility).toBe('all');
  });

  it('rerolls exactly once when an advance crosses into a new day', () => {
    dm({ kind: 'time.advance', minutes: 60 } as never); // seeds (9:00 AM, day 1)
    expect(weatherLog()).toHaveLength(1);

    // Still day 1: no reroll.
    dm({ kind: 'time.advance', minutes: 8 * 60 } as never); // 5:00 PM
    expect(weatherLog()).toHaveLength(1);

    // Over midnight into day 2: exactly one more roll and one more log line.
    dm({ kind: 'time.advance', minutes: 8 * 60, note: 'camp' } as never); // 1:00 AM day 2
    expect(runtime.campaign.time.minutes).toBe(MINUTES_PER_DAY + 60);
    expect(weatherLog()).toHaveLength(2);
    expect(runtime.campaign.time.weather!.rolledAtMinutes).toBe(MINUTES_PER_DAY + 60);
  });

  it('rolls once per crossed day but keeps and logs only the final day', () => {
    dm({ kind: 'time.advance', minutes: 60 } as never); // seed, day 1
    expect(weatherLog()).toHaveLength(1);

    // Three midnights in one advance: three rolls, one surviving sky.
    dm({ kind: 'time.advance', minutes: 3 * MINUTES_PER_DAY } as never);
    expect(weatherLog()).toHaveLength(2);
    expect(runtime.campaign.time.weather!.text).toBe(nthRollText(3));
    expect(weatherLog()[1]!.text).toBe(`The weather turns: ${nthRollText(3)}`);
  });

  it('rerolls when travel itself crosses midnight', () => {
    const { tokenId, playerSeat } = setupParty();
    // Default 6 mi/hex on foot at normal pace = 120 minutes per hex.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 1, r: 0 } as never);
    expect(runtime.campaign.time.minutes).toBe(10 * 60);
    expect(weatherLog()).toHaveLength(1); // the seeding roll

    // Park the clock just before midnight, then walk one hex over it.
    dm({ kind: 'time.advance', minutes: 13 * 60 + 30 } as never); // 11:30 PM
    expect(weatherLog()).toHaveLength(1);
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    expect(runtime.campaign.time.minutes).toBe(MINUTES_PER_DAY + 90);
    expect(weatherLog()).toHaveLength(2);
    expect(runtime.campaign.time.weather!.rolledAtMinutes).toBe(MINUTES_PER_DAY + 90);
  });

  it('leaves the weather alone when time.set fixes the clock', () => {
    dm({ kind: 'time.advance', minutes: 60 } as never);
    const seeded = runtime.campaign.time.weather;
    dm({ kind: 'time.set', minutes: 10 * MINUTES_PER_DAY } as never);
    expect(runtime.campaign.time.weather).toEqual(seeded);
    expect(weatherLog()).toHaveLength(1);
  });
});

describe('weather.roll', () => {
  it('forces a reroll at any time, logged for everyone', () => {
    dm({ kind: 'weather.roll' } as never);
    expect(runtime.campaign.time.weather).toMatchObject({
      text: nthRollText(1),
      icon: '🌡️',
      rolledAtMinutes: 8 * 60,
    });
    const entries = weatherLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.visibility).toBe('all');
    expect(runtime.log.at(-1)!.data.forced).toBe(true);

    // A second forced roll re-rolls even though the day has not changed.
    dm({ kind: 'weather.roll' } as never);
    expect(weatherLog()).toHaveLength(2);
  });

  it('is DM-only', () => {
    const { playerSeat } = setupParty();
    const before = weatherLog().length;
    expect(() => asSeat(playerSeat, { kind: 'weather.roll' } as never)).toThrow(/Only the DM/);
    expect(weatherLog()).toHaveLength(before);
  });
});

describe('weather tables', () => {
  it('falls back to the built-in table when the campaign has none', () => {
    dm({ kind: 'campaign.update', settings: { weatherTable: null } } as never);
    dm({ kind: 'weather.roll' } as never);
    const texts = DEFAULT_WEATHER_TABLE.map((e) => e.text);
    expect(texts).toContain(runtime.campaign.time.weather!.text);
    expect(runtime.campaign.time.weather!.icon).not.toBe('');
  });

  it('uses the campaign table, including a single catch-all row', () => {
    dm({
      kind: 'campaign.update',
      settings: { weatherTable: [{ min: 1, max: 20, text: 'Ash falls', icon: '🌋' }] },
    } as never);
    dm({ kind: 'weather.roll' } as never);
    expect(runtime.campaign.time.weather).toMatchObject({ text: 'Ash falls', icon: '🌋' });
  });
});

describe('weather visibility and persistence', () => {
  it('reaches players in their filtered snapshot', () => {
    const { mapId, playerSeat } = setupParty();
    dm({ kind: 'weather.roll' } as never);
    const view = filterStateForViewer(runtime.buildFullState(mapId), {
      seatId: playerSeat.id,
      role: 'player',
      characterId: playerSeat.characterId,
    });
    expect(view.campaign.time.weather).toEqual(runtime.campaign.time.weather);
  });

  it('survives a server restart', () => {
    dm({ kind: 'time.advance', minutes: MINUTES_PER_DAY } as never);
    const weather = runtime.campaign.time.weather!;
    const db = (store as unknown as { db: unknown }).db;
    const reloaded = new Store(db as never).getCampaign(runtime.id)!;
    expect(reloaded.campaign.time.weather).toEqual(weather);
    expect(reloaded.campaign.settings.weatherTable).toEqual(NUMBERED_TABLE);
    // And a reloaded campaign does not re-seed: the sky is already set.
    expect(reloaded.log.filter((e) => e.kind === 'weather')).toHaveLength(1);
  });
});

describe('calendar-named log lines', () => {
  it('names clock readouts by the campaign calendar once one is configured', () => {
    dm({ kind: 'time.advance', minutes: 60 } as never);
    expect(runtime.log.at(-2)!.text).toContain('Day 1, 9:00 AM');

    dm({
      kind: 'campaign.update',
      settings: { calendar: { ...HARPTOS_PRESET, startYear: 1492, startDayOfYear: 285 } },
    } as never);
    dm({ kind: 'time.advance', minutes: 60, note: 'reading' } as never);
    const entry = runtime.log.filter((e) => e.kind === 'time').at(-1)!;
    expect(entry.text).toContain('Marpenoth 12, 1492 DR, 10:00 AM');
  });
});
