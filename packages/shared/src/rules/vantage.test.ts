import { describe, expect, it } from 'vitest';
import { clueInRange, clueObservableCells, clueObserveSet } from '../domain.js';
import { hexKey } from '../hex/coords.js';

/**
 * Clue vantage hexes (issue #123): an explicit set of hexes a clue can be
 * perceived from replaces the gate's distance rule outright. A clue's own set
 * beats the content's; without either, it is the old radius.
 */

const skillGate = { kind: 'skill', skill: 'perception', dc: 12, maxDistance: 2, mode: 'passive' } as const;
const content = { q: 0, r: 0, area: [] as { q: number; r: number }[], observeFrom: [] as { q: number; r: number }[] };
const ridge = [{ q: 5, r: -5 }, { q: 6, r: -5 }];

describe('clueObserveSet', () => {
  it('prefers the clue set, then the content set, then null', () => {
    expect(clueObserveSet({ gate: skillGate, observeFrom: [] }, content)).toBeNull();
    expect(clueObserveSet({ gate: skillGate, observeFrom: [] }, { ...content, observeFrom: ridge })).toBe(ridge);
    const own = [{ q: 1, r: 1 }];
    expect(clueObserveSet({ gate: skillGate, observeFrom: own }, { ...content, observeFrom: ridge })).toBe(own);
  });
});

describe('clueInRange', () => {
  it('uses distance when there is no vantage set', () => {
    const clue = { gate: skillGate, observeFrom: [] };
    expect(clueInRange(clue, content, { q: 2, r: 0 })).toBe(true);
    expect(clueInRange(clue, content, { q: 3, r: 0 })).toBe(false);
    expect(clueInRange({ gate: { kind: 'auto' }, observeFrom: [] }, content, { q: 1, r: 0 })).toBe(false);
    expect(clueInRange({ gate: { kind: 'auto' }, observeFrom: [] }, content, { q: 0, r: 0 })).toBe(true);
  });

  it('a vantage set replaces distance entirely — even standing on the content', () => {
    const clue = { gate: skillGate, observeFrom: ridge };
    expect(clueInRange(clue, content, { q: 5, r: -5 })).toBe(true);
    expect(clueInRange(clue, content, { q: 0, r: 0 })).toBe(false);
    expect(clueInRange(clue, content, { q: 1, r: 0 })).toBe(false);
    // Auto gates too: "on the hex" becomes "on a vantage hex".
    expect(clueInRange({ gate: { kind: 'auto' }, observeFrom: ridge }, content, { q: 6, r: -5 })).toBe(true);
    expect(clueInRange({ gate: { kind: 'auto' }, observeFrom: ridge }, content, { q: 0, r: 0 })).toBe(false);
  });

  it('the content set applies to every clue that has none of its own', () => {
    const withSet = { ...content, observeFrom: ridge };
    expect(clueInRange({ gate: skillGate, observeFrom: [] }, withSet, { q: 5, r: -5 })).toBe(true);
    expect(clueInRange({ gate: skillGate, observeFrom: [] }, withSet, { q: 1, r: 0 })).toBe(false);
    expect(clueInRange({ gate: skillGate, observeFrom: [{ q: 9, r: 9 }] }, withSet, { q: 5, r: -5 })).toBe(false);
  });
});

describe('clueObservableCells', () => {
  it('is the radius around every footprint hex without a set', () => {
    const cells = clueObservableCells({ gate: skillGate, observeFrom: [] }, { ...content, area: [{ q: 1, r: 0 }] });
    const keys = new Set(cells.map((c) => hexKey(c.q, c.r)));
    expect(keys.has('0,0')).toBe(true);
    expect(keys.has('3,0')).toBe(true); // within 2 of the area member (1,0)
    expect(keys.has('4,0')).toBe(false);
    expect(keys.size).toBe(cells.length); // de-duplicated where ranges overlap
  });

  it('is exactly the vantage set when there is one', () => {
    expect(clueObservableCells({ gate: skillGate, observeFrom: ridge }, content)).toEqual(ridge);
    expect(clueObservableCells({ gate: { kind: 'manual' }, observeFrom: [] }, content)).toEqual([{ q: 0, r: 0 }]);
  });
});
