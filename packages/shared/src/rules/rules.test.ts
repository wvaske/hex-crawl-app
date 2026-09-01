import { describe, expect, it } from 'vitest';
import { diceBounds, parseDice, rollDice, seededRng } from './dice.js';
import { gateOpensPassively } from './gates.js';
import { filterStateForViewer } from './filter.js';
import {
  TRAVEL_MODES,
  formatClock,
  formatDuration,
  formatRelativeGameTime,
  formatTimeOfDay,
  isNight,
  minutesPerHex,
  minutesUntilSunrise,
  resolveTravelMode,
  timeOfDay,
  travelModes,
} from './time.js';
import type { CampaignState, Character } from '../domain.js';
import { MapDefaultsSchema } from '../domain.js';

describe('dice', () => {
  it('parses notation', () => {
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('2d6+1')).toEqual({ count: 2, sides: 6, modifier: 1 });
    expect(parseDice('3d8 - 2')).toEqual({ count: 3, sides: 8, modifier: -2 });
    expect(parseDice('garbage')).toBeNull();
    expect(parseDice('0d6')).toBeNull();
  });

  it('rolls stay within bounds and are deterministic per seed', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 200; i++) {
      const r = rollDice('2d6+1', rng);
      expect(r.total).toBeGreaterThanOrEqual(3);
      expect(r.total).toBeLessThanOrEqual(13);
      expect(r.rolls).toHaveLength(2);
    }
    const a = rollDice('1d20', seededRng(7));
    const b = rollDice('1d20', seededRng(7));
    expect(a.total).toBe(b.total);
  });

  it('computes bounds', () => {
    expect(diceBounds('2d6')).toEqual({ min: 2, max: 12 });
    expect(diceBounds('1d12+3')).toEqual({ min: 4, max: 15 });
  });
});

const scout: Character = {
  id: 'char1',
  name: 'Scout',
  color: '#00ff00',
  glyph: '🏹',
  speed: 30,
  skills: { perception: 4, survival: 2 },
  ddbId: null,
  extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
};

describe('gates', () => {
  it('auto gate opens only on the hex', () => {
    expect(gateOpensPassively({ kind: 'auto' }, scout, 0).opens).toBe(true);
    expect(gateOpensPassively({ kind: 'auto' }, scout, 1).opens).toBe(false);
  });

  it('passive skill gate honors dc and distance', () => {
    const gate = { kind: 'skill', skill: 'perception', dc: 14, maxDistance: 2, mode: 'passive' } as const;
    expect(gateOpensPassively(gate, scout, 2)).toEqual({ opens: true, passive: 14 });
    expect(gateOpensPassively(gate, scout, 3).opens).toBe(false);
    const highDc = { ...gate, dc: 15 };
    expect(gateOpensPassively(highDc, scout, 0).opens).toBe(false);
  });

  it('active and manual gates never open passively', () => {
    expect(
      gateOpensPassively(
        { kind: 'skill', skill: 'perception', dc: 1, maxDistance: 5, mode: 'active' },
        scout,
        0,
      ).opens,
    ).toBe(false);
    expect(gateOpensPassively({ kind: 'manual' }, scout, 0).opens).toBe(false);
  });
});

function fullState(): CampaignState {
  return {
    campaign: {
      id: 'c1',
      name: 'Test',
      activeMapId: 'm1',
      settings: {
        description: '',
        wikiBaseUrl: 'https://wiki.example/wiki/',
        pausePlayerMapSync: false,
        customTravelModes: [],
        sunriseHour: 6,
        sunsetHour: 20,
        mapDefaults: MapDefaultsSchema.parse({}),
      },
      time: { minutes: 8 * 60, travelMode: 'foot', pace: 'normal', partyHex: null },
    },
    seats: [
      { id: 'dm', role: 'dm', name: 'DM', characterId: null, online: true },
      { id: 's1', role: 'player', name: 'Alice', characterId: 'char1', online: true },
    ],
    characters: [scout],
    maps: [],
    mapState: {
      imageLayers: [
        { id: 'il1', mapId: 'm1', path: '/uploads/a.png', name: 'a', x: 0, y: 0, scale: 1, opacity: 1, z: 0, dmOnly: false, visible: true },
        { id: 'il2', mapId: 'm1', path: '/uploads/b.png', name: 'b', x: 0, y: 0, scale: 1, opacity: 1, z: 1, dmOnly: true, visible: true },
      ],
      hexes: [
        { q: 0, r: 0, terrain: 'forest' },
        { q: 1, r: 0, terrain: 'plains' },
        { q: 2, r: 0, terrain: 'swamp' },
      ],
      fog: [
        { q: 0, r: 0, state: 'visible' },
        { q: 1, r: 0, state: 'explored' },
      ],
      tokens: [
        { id: 't1', mapId: 'm1', q: 0, r: 0, kind: 'pc', characterId: 'char1', label: 'Scout', color: '#00ff00', glyph: '', playerVisible: true, partyId: null },
        { id: 't2', mapId: 'm1', q: 0, r: 0, kind: 'npc', characterId: null, label: 'Ogre', color: '#ff0000', glyph: '', playerVisible: true, partyId: null },
        { id: 't3', mapId: 'm1', q: 1, r: 0, kind: 'npc', characterId: null, label: 'Ghost', color: '#ffffff', glyph: '', playerVisible: true, partyId: null },
        { id: 't4', mapId: 'm1', q: 0, r: 0, kind: 'npc', characterId: null, label: 'Hidden', color: '#000000', glyph: '', playerVisible: false, partyId: null },
      ],
      markers: [
        { id: 'mk1', mapId: 'm1', q: 0, r: 0, glyph: '🔥', icon: '', scale: 1, label: 'Fire', dmOnly: false, playerPlaced: false, ownerSeatId: null },
        { id: 'mk2', mapId: 'm1', q: 0, r: 0, glyph: '💀', icon: '', scale: 1, label: 'Secret', dmOnly: true, playerPlaced: false, ownerSeatId: null },
        { id: 'mk3', mapId: 'm1', q: 2, r: 0, glyph: '⛺', icon: '', scale: 1, label: 'FoggedCamp', dmOnly: false, playerPlaced: false, ownerSeatId: null },
        // Party note dropped by another player's seat: party-wide (issue #74).
        { id: 'mk4', mapId: 'm1', q: 1, r: 0, glyph: '📌', icon: '', scale: 1, label: 'We camped here', dmOnly: false, playerPlaced: true, ownerSeatId: 's2' },
      ],
      contents: [
        {
          id: 'ct1', mapId: 'm1', q: 1, r: 0, area: [], type: 'lair', title: 'Dragon Lair', dmNotes: 'secret', glyph: '🐉', showLabel: false, scaleVisibility: 1, wikiPage: '', enabled: true, knownLocation: false, quest: '',
          clues: [
            { id: 'cl1', contentId: 'ct1', text: 'Dead vegetation', gate: { kind: 'auto' }, sortOrder: 0, indicatesDirection: false, revealsLocation: true },
            { id: 'cl2', contentId: 'ct1', text: 'Acid scars', gate: { kind: 'manual' }, sortOrder: 1, indicatesDirection: false, revealsLocation: true },
          ],
        },
        {
          id: 'ct2', mapId: 'm1', q: 2, r: 0, area: [], type: 'cache', title: 'Buried gold', dmNotes: '', glyph: '', showLabel: false, scaleVisibility: 1, wikiPage: '', enabled: true, knownLocation: false, quest: '',
          clues: [{ id: 'cl3', contentId: 'ct2', text: 'Disturbed earth', gate: { kind: 'auto' }, sortOrder: 0, indicatesDirection: false, revealsLocation: true }],
        },
      ],
      pendingMoves: [],
      trails: [],
      trailSigns: [],
      visits: [
        { q: 0, r: 0, firstArrived: 480, lastArrived: 480, totalMinutes: 30 },
        // Hex 2,0 has no fog record (hidden) — the visit must not leak it.
        { q: 2, r: 0, firstArrived: 60, lastArrived: 60, totalMinutes: 0 },
      ],
    },
    discoveries: [
      { id: 'd1', clueId: 'cl1', characterId: 'char1', at: 1000, how: { kind: 'auto' }, direction: null, locates: true },
      { id: 'd2', clueId: 'cl3', characterId: 'char2', at: 1001, how: { kind: 'auto' }, direction: null, locates: true },
    ],
    trailDiscoveries: [],
    senses: [],
    encounterTables: [{ id: 'et1', name: 'Forest', terrains: ['forest'], die: '1d12', entries: [], enabled: true }],
    log: [
      { id: 'l1', at: 1, kind: 'roll', text: 'dm secret roll', visibility: 'dm', data: {} },
      { id: 'l2', at: 2, kind: 'narration', text: 'you all see smoke', visibility: 'all', data: {} },
      { id: 'l3', at: 3, kind: 'discovery', text: 'alice private', visibility: 's1', data: {} },
      { id: 'l4', at: 4, kind: 'discovery', text: 'bob private', visibility: 's2', data: {} },
    ],
  };
}

describe('filterStateForViewer', () => {
  const viewer = { seatId: 's1', role: 'player' as const, characterId: 'char1' };

  it('passes DM state through untouched (senses stay player-only)', () => {
    const full = fullState();
    const dm = filterStateForViewer(full, { seatId: 'dm', role: 'dm', characterId: null });
    expect(dm).toEqual({ ...full, senses: [] });
    expect(dm.mapState).toBe(full.mapState);
  });

  it('strips hidden hexes, fog, dm-only layers', () => {
    const s = filterStateForViewer(fullState(), viewer);
    expect(s.mapState!.hexes.map((h) => h.q)).toEqual([0, 1]);
    expect(s.mapState!.fog).toHaveLength(2);
    expect(s.mapState!.imageLayers.map((l) => l.id)).toEqual(['il1']);
  });

  it('filters tokens: pc always; npc only playerVisible on visible hexes', () => {
    const s = filterStateForViewer(fullState(), viewer);
    expect(s.mapState!.tokens.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('filters markers by dmOnly and fog', () => {
    const s = filterStateForViewer(fullState(), viewer);
    // mk4 is another seat's party note — player notes are party-wide.
    expect(s.mapState!.markers.map((m) => m.id)).toEqual(['mk1', 'mk4']);
  });

  it('keeps ownership fields on party notes so a player can spot their own', () => {
    const s = filterStateForViewer(fullState(), viewer);
    const note = s.mapState!.markers.find((m) => m.id === 'mk4')!;
    expect(note.playerPlaced).toBe(true);
    expect(note.ownerSeatId).toBe('s2');
  });

  it('projects content to discovered clues only', () => {
    const s = filterStateForViewer(fullState(), viewer);
    expect(s.mapState!.contents).toHaveLength(1);
    const view = s.mapState!.contents[0]!;
    expect('dmNotes' in view).toBe(false);
    expect('clues' in view).toBe(false);
    expect((view as { discoveredClues: unknown[] }).discoveredClues).toHaveLength(1);
  });

  it('gives players their own visit history, minus re-hidden hexes (#66)', () => {
    const full = fullState();
    expect(full.mapState!.visits).toHaveLength(2);
    const s = filterStateForViewer(full, viewer);
    expect(s.mapState!.visits).toEqual([
      { q: 0, r: 0, firstArrived: 480, lastArrived: 480, totalMinutes: 30 },
    ]);
    // Visit records carry coordinates and clock stamps only — no DM data.
    expect(Object.keys(s.mapState!.visits[0]!).sort()).toEqual([
      'firstArrived',
      'lastArrived',
      'q',
      'r',
      'totalMinutes',
    ]);
    // The clock itself is public: players see day, time and daylight.
    expect(s.campaign.time).toEqual(full.campaign.time);
  });

  it('filters discoveries, tables, and log', () => {
    const s = filterStateForViewer(fullState(), viewer);
    expect(s.discoveries.map((d) => d.id)).toEqual(['d1']);
    expect(s.encounterTables).toEqual([]);
    expect(s.log.map((l) => l.id)).toEqual(['l2', 'l3']);
  });

  it('unclaimed player sees no content or discoveries', () => {
    const s = filterStateForViewer(fullState(), { seatId: 's9', role: 'player', characterId: null });
    expect(s.mapState!.contents).toEqual([]);
    expect(s.discoveries).toEqual([]);
  });
});

describe('campaign clock', () => {
  it('computes minutes per hex from scale, mode speed and pace', () => {
    const foot = resolveTravelMode('foot');
    expect(foot.mph).toBe(3);
    // 6 miles at 3 mph = 2 hours.
    expect(minutesPerHex(6, foot, 'normal')).toBe(120);
    // Fast pace is 4/3 speed: 90 minutes. Careful is 2/3: 180.
    expect(minutesPerHex(6, foot, 'fast')).toBe(90);
    expect(minutesPerHex(6, foot, 'careful')).toBe(180);
    // A raw mph works too, and horses are twice as fast as boots.
    expect(minutesPerHex(6, 6, 'normal')).toBe(60);
    expect(minutesPerHex(6, resolveTravelMode('horse'), 'normal')).toBe(60);
    // Degenerate inputs cost nothing rather than diverging.
    expect(minutesPerHex(0, foot, 'normal')).toBe(0);
    expect(minutesPerHex(6, 0, 'normal')).toBe(0);
  });

  it('resolves custom travel modes and falls back to foot', () => {
    const custom = [{ id: 'griffon', name: 'Griffon', mph: 12 }];
    expect(resolveTravelMode('griffon', custom).mph).toBe(12);
    expect(travelModes(custom)).toHaveLength(TRAVEL_MODES.length + 1);
    expect(resolveTravelMode('nonsense', custom).id).toBe('foot');
  });

  it('derives day, time of day and formatting', () => {
    expect(timeOfDay(8 * 60)).toEqual({ day: 1, hour: 8, minute: 0 });
    expect(timeOfDay(2 * 1440 + 18 * 60 + 40)).toEqual({ day: 3, hour: 18, minute: 40 });
    expect(formatClock(2 * 1440 + 18 * 60 + 40)).toBe('Day 3, 6:40 PM');
    expect(formatTimeOfDay(0)).toBe('12:00 AM');
    expect(formatTimeOfDay(12 * 60)).toBe('12:00 PM');
    expect(formatDuration(8 * 60)).toBe('8 hours');
    expect(formatDuration(1500)).toBe('1 day 1 hour');
    expect(formatDuration(45)).toBe('45 minutes');
  });

  it('says how long ago something happened in game (#66)', () => {
    const day = 1440;
    // Same day (even hours apart) reads as "today".
    expect(formatRelativeGameTime(8 * 60, 20 * 60)).toBe('today');
    expect(formatRelativeGameTime(20 * 60, 8 * 60)).toBe('today'); // future: no negatives
    expect(formatRelativeGameTime(0, day)).toBe('yesterday');
    expect(formatRelativeGameTime(0, 5 * day)).toBe('5 days ago');
    expect(formatRelativeGameTime(0, 21 * day)).toBe('3 weeks ago');
    expect(formatRelativeGameTime(0, 120 * day)).toBe('4 months ago');
  });

  it('derives night from configurable sunrise/sunset', () => {
    expect(isNight(8 * 60)).toBe(false);
    expect(isNight(22 * 60)).toBe(true);
    expect(isNight(3 * 60)).toBe(true);
    // Second day, still daylight at noon.
    expect(isNight(1440 + 12 * 60)).toBe(false);
    // A campaign with long nights.
    expect(isNight(8 * 60, { sunriseHour: 9, sunsetHour: 16 })).toBe(true);
    expect(isNight(15 * 60, { sunriseHour: 9, sunsetHour: 16 })).toBe(false);
  });

  it('counts minutes to the next sunrise for "camp until dawn"', () => {
    // Default sunrise (6 AM). Currently 8 AM day 1 — sunrise is tomorrow.
    expect(minutesUntilSunrise(8 * 60)).toBe(22 * 60);
    // Just before dawn: a short hop to sunrise, same day.
    expect(minutesUntilSunrise(5 * 60 + 30)).toBe(30);
    // Exactly at sunrise: the *next* sunrise is a full day away, not zero.
    expect(minutesUntilSunrise(6 * 60)).toBe(24 * 60);
    // A custom sunrise hour.
    expect(minutesUntilSunrise(3 * 60, { sunriseHour: 9 })).toBe(6 * 60);
    // Works past day 1 the same way.
    expect(minutesUntilSunrise(1440 + 20 * 60)).toBe(10 * 60);
  });
});
