import { describe, expect, it } from 'vitest';
import { compassDirection, withDirection } from './direction.js';

describe('compassDirection (flat-top)', () => {
  it('names the eight bearings', () => {
    expect(compassDirection({ q: 0, r: 0 }, { q: 0, r: -2 })).toBe('north');
    expect(compassDirection({ q: 0, r: 0 }, { q: 0, r: 2 })).toBe('south');
    expect(compassDirection({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe('east');
    expect(compassDirection({ q: 0, r: 0 }, { q: -2, r: 1 })).toBe('west');
    expect(compassDirection({ q: 0, r: 0 }, { q: 2, r: -3 })).toBe('north-east');
    expect(compassDirection({ q: 0, r: 0 }, { q: 2, r: 1 })).toBe('south-east');
    expect(compassDirection({ q: 0, r: 0 }, { q: -2, r: 3 })).toBe('south-west');
    expect(compassDirection({ q: 0, r: 0 }, { q: -2, r: -1 })).toBe('north-west');
  });

  it('is null on the same hex', () => {
    expect(compassDirection({ q: 3, r: -1 }, { q: 3, r: -1 })).toBeNull();
  });
});

describe('withDirection', () => {
  it('appends the bearing when present', () => {
    expect(withDirection('You smell woodsmoke', 'north-east')).toBe(
      'You smell woodsmoke — to the north-east',
    );
    expect(withDirection('You smell woodsmoke', null)).toBe('You smell woodsmoke');
  });
});
