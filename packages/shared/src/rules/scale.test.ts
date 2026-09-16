import { describe, expect, it } from 'vitest';
import { SUPER_SCALE } from '../hex/super.js';
import {
  HEX_SCALE_PRESETS,
  MAX_HEX_SIZE,
  MIN_HEX_SIZE,
  clampHexSize,
  formatMiles,
  hexSizeFromScaleBar,
  hexWidthAcrossFlats,
  scaleLadderMiles,
} from './scale.js';

describe('hexSizeFromScaleBar', () => {
  it('puts milesPerHex across the flats of the resulting hex', () => {
    // A 100 px bar labelled 10 miles → 10 px per mile → a 6-mile hex is 60 px
    // across the flats.
    const size = hexSizeFromScaleBar(100, 10, 6);
    expect(size).not.toBeNull();
    expect(hexWidthAcrossFlats(size!)).toBeCloseTo(60, 9);
    expect(size!).toBeCloseTo(60 / Math.sqrt(3), 9);
  });

  it('scales linearly with miles per hex', () => {
    const six = hexSizeFromScaleBar(250, 50, 6)!;
    const three = hexSizeFromScaleBar(250, 50, 3)!;
    expect(three * 2).toBeCloseTo(six, 9);
  });

  it('refuses degenerate inputs', () => {
    expect(hexSizeFromScaleBar(0, 10, 6)).toBeNull();
    expect(hexSizeFromScaleBar(100, 0, 6)).toBeNull();
    expect(hexSizeFromScaleBar(100, 10, 0)).toBeNull();
    expect(hexSizeFromScaleBar(-5, 10, 6)).toBeNull();
    expect(hexSizeFromScaleBar(Number.NaN, 10, 6)).toBeNull();
  });
});

describe('clampHexSize', () => {
  it('keeps the size inside the schema bounds', () => {
    expect(clampHexSize(1)).toBe(MIN_HEX_SIZE);
    expect(clampHexSize(10_000)).toBe(MAX_HEX_SIZE);
    expect(clampHexSize(48)).toBe(48);
  });
});

describe('scaleLadderMiles', () => {
  it('follows the √7 superhex ladder from the base', () => {
    const ladder = scaleLadderMiles(3);
    expect(ladder).toHaveLength(3);
    expect(ladder[0]).toBe(3);
    expect(ladder[1]).toBeCloseTo(3 * SUPER_SCALE, 9);
    expect(ladder[2]).toBeCloseTo(21, 9);
  });
});

describe('formatMiles', () => {
  it('rounds to whole miles above 2 and one decimal below', () => {
    expect(formatMiles(3)).toBe('3');
    expect(formatMiles(3 * SUPER_SCALE)).toBe('8');
    expect(formatMiles(42)).toBe('42');
    expect(formatMiles(1.5)).toBe('1.5');
    expect(formatMiles(0.75)).toBe('0.8');
  });
});

describe('HEX_SCALE_PRESETS', () => {
  it('offers the 3-mile local scale alongside the classic 6', () => {
    expect(HEX_SCALE_PRESETS.map((p) => p.miles)).toEqual([3, 6, 24]);
  });
});
