import { describe, expect, it } from 'vitest';
import { hexKey } from '../hex/coords.js';
import { journeyStepCost, mediumPassable, planJourney, roadIndex, type JourneyWorld } from './journey.js';
import { TRAVEL_MODES, travelModes } from './time.js';

function world(opts: { water?: string[]; known?: string[]; road?: string[] } = {}): JourneyWorld {
  const water = new Set(opts.water ?? []);
  const known = new Set(opts.known ?? []);
  const road = new Set(opts.road ?? []);
  return {
    terrainAt: (h) => (water.has(hexKey(h.q, h.r)) ? 'water' : 'plains'),
    fogAt: (h) => (known.has(hexKey(h.q, h.r)) ? 'explored' : 'hidden'),
    roadAt: (h) => road.has(hexKey(h.q, h.r)),
    edges: new Map(),
  };
}

describe('journey planner', () => {
  it('walks the straight line on open unknown ground', () => {
    const route = planJourney(world(), 'land', { q: 0, r: 0 }, [{ q: 3, r: 0 }]);
    expect(route).toEqual([{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }]);
  });

  it('respects the medium', () => {
    expect(mediumPassable('land', 'water')).toBe(false);
    expect(mediumPassable('land', 'coast')).toBe(true);
    expect(mediumPassable('water', 'plains')).toBe(false);
    expect(mediumPassable('water', 'coast')).toBe(true);
    expect(mediumPassable('air', 'water')).toBe(true);
    expect(mediumPassable('land', undefined)).toBe(true);
    const w = world({ water: ['1,0', '1,-1', '1,1', '2,-1'] });
    const land = planJourney(w, 'land', { q: 0, r: 0 }, [{ q: 3, r: 0 }]);
    expect(land.some((h) => h.q === 1 && h.r === 0)).toBe(false);
    expect(planJourney(w, 'air', { q: 0, r: 0 }, [{ q: 3, r: 0 }])).toHaveLength(3);
  });

  it('costs roads 1, known ground 2, unknown 3, times the edge effort', () => {
    const w = world({ known: ['1,0'], road: ['0,0', '0,1'] });
    expect(journeyStepCost(w, { q: 0, r: 0 }, { q: 0, r: 1 })).toBe(1);
    expect(journeyStepCost(w, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(2);
    expect(journeyStepCost(w, { q: 0, r: 0 }, { q: 1, r: -1 })).toBe(3);
  });

  it('takes a road detour shorter than twice the straight walk, not a longer one', () => {
    const short = world({ road: ['0,0', '1,-1', '2,-1', '3,-1', '3,0'] });
    expect(planJourney(short, 'land', { q: 0, r: 0 }, [{ q: 3, r: 0 }])).toEqual([
      { q: 1, r: -1 }, { q: 2, r: -1 }, { q: 3, r: -1 }, { q: 3, r: 0 },
    ]);
    // 2 straight steps cost 6 unknown; a 7-hex road would cost 7: straight wins.
    const long = world({ road: ['0,0', '0,-1', '1,-2', '2,-2', '3,-2', '3,-1', '2,0'] });
    expect(planJourney(long, 'land', { q: 0, r: 0 }, [{ q: 2, r: 0 }])).toHaveLength(2);
  });

  it('strings waypoints and skips a waypoint equal to the current hex', () => {
    const route = planJourney(world(), 'land', { q: 0, r: 0 }, [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }]);
    expect(route).toEqual([{ q: 1, r: 0 }, { q: 1, r: 1 }]);
  });

  it('indexes only road trails and knows every built-in mode\'s medium', () => {
    const idx = roadIndex([
      { id: 'a', mapId: 'm', name: 'r', glyph: '', dmNotes: '', gate: { kind: 'auto' }, cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], kind: 'road' },
      { id: 'b', mapId: 'm', name: 't', glyph: '', dmNotes: '', gate: { kind: 'auto' }, cells: [{ q: 5, r: 5 }, { q: 6, r: 5 }], kind: 'tracks' },
    ]);
    expect([...idx].sort()).toEqual(['0,0', '1,0']);
    expect(TRAVEL_MODES.find((m) => m.id === 'ship')!.medium).toBe('water');
    expect(travelModes([{ id: 'g', name: 'Griffon', mph: 12, medium: 'air' }]).at(-1)!.medium).toBe('air');
  });
});
