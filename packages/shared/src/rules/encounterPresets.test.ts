import { describe, expect, it } from 'vitest';
import { TERRAIN_IDS, EncounterTableSchema } from '../domain.js';
import { ENCOUNTER_PRESETS } from './encounterPresets.js';
import { diceBounds, parseDice } from './dice.js';

describe('encounter presets', () => {
  it('covers every terrain exactly once', () => {
    const seen = ENCOUNTER_PRESETS.flatMap((p) => p.terrains);
    expect([...seen].sort()).toEqual([...TERRAIN_IDS].sort());
  });

  it('includes exactly one terrain-agnostic fallback table', () => {
    expect(ENCOUNTER_PRESETS.filter((p) => p.terrains.length === 0)).toHaveLength(1);
  });

  it('validates against the table schema', () => {
    for (const p of ENCOUNTER_PRESETS) {
      expect(() =>
        EncounterTableSchema.parse({ ...p, id: 'x', enabled: true }),
      ).not.toThrow();
    }
  });

  it('entries exactly tile the die range with no gaps or overlaps', () => {
    for (const p of ENCOUNTER_PRESETS) {
      const bounds = diceBounds(p.die);
      expect(bounds, p.name).not.toBeNull();
      const sorted = [...p.entries].sort((a, b) => a.min - b.min);
      let next = bounds!.min;
      for (const e of sorted) {
        expect(e.min, `${p.name}: gap/overlap at ${e.min}`).toBe(next);
        expect(e.max).toBeGreaterThanOrEqual(e.min);
        next = e.max + 1;
      }
      expect(next - 1, `${p.name}: range not fully covered`).toBe(bounds!.max);
    }
  });

  it('quantity dice all parse', () => {
    for (const p of ENCOUNTER_PRESETS) {
      for (const e of p.entries) {
        if (e.quantity) {
          expect(parseDice(e.quantity), `${p.name}: "${e.quantity}"`).not.toBeNull();
        }
      }
    }
  });
});
