import { MAX_SCALE_LEVEL, SUPER_SCALE } from '../hex/super.js';

/**
 * Hex scale rules: what one hex is worth in miles, and how to size the grid
 * so it fits a map image's own scale bar.
 *
 * "Miles per hex" is the distance across a hex's flats — centre to the centre
 * of a neighbour — because that is what one step of travel crosses. A regular
 * hexagon is √3 × its circumradius across the flats, and `hexSize` throughout
 * the app is the circumradius in world pixels, so the two convert directly and
 * the orientation (pointy or flat) never matters.
 *
 * The fine (level-0) hex is the unit everything is tracked in — terrain, fog,
 * tokens, sight radius — so a map that wants 3-mile hexes sets 3 here rather
 * than subdividing a 6-mile grid: the √7 superhex ladder cannot produce a
 * clean 2:1 split, and a display-only sub-grid could hold no fog or tokens.
 */

export interface HexScalePreset {
  miles: number;
  label: string;
  /** Why you'd pick it — surfaced as a tooltip. */
  hint: string;
}

/**
 * Presets for the miles-per-hex setting. 3 miles is the "local area" unit
 * (about an hour on foot and roughly the distance to the horizon, so a party
 * can see into the neighbouring hexes before choosing one); 6 is the classic
 * hexcrawl unit; 24 is a day's travel, for a world map between regions.
 */
export const HEX_SCALE_PRESETS: readonly HexScalePreset[] = [
  {
    miles: 3,
    label: '3 mi — local area',
    hint: 'About an hour on foot and roughly the distance to the horizon: the party can see into the neighbouring hexes and choose where to go next.',
  },
  {
    miles: 6,
    label: '6 mi — classic',
    hint: "The traditional hexcrawl unit; a day's march is about four hexes.",
  },
  {
    miles: 24,
    label: '24 mi — world map',
    hint: 'One day of travel per hex, for journeys between regions.',
  },
];

/** Bounds on a map's `hexSize` (circumradius in world pixels). */
export const MIN_HEX_SIZE = 4;
export const MAX_HEX_SIZE = 512;

/** Across-flats width of a hex, in the units of its circumradius. */
export function hexWidthAcrossFlats(hexSize: number): number {
  return Math.sqrt(3) * hexSize;
}

/** The miles each scale level spans on a map whose fine hex is `baseMiles`. */
export function scaleLadderMiles(baseMiles: number): number[] {
  return Array.from(
    { length: MAX_SCALE_LEVEL + 1 },
    (_, level) => baseMiles * Math.pow(SUPER_SCALE, level),
  );
}

/**
 * The circumradius that puts `milesPerHex` across a hex's flats, given a
 * scale bar spanning `barPixels` world pixels that the map labels as
 * `barMiles`. Null when the inputs can't size anything (a zero-length bar, or
 * zero miles) — callers clamp with `clampHexSize` before saving.
 */
export function hexSizeFromScaleBar(
  barPixels: number,
  barMiles: number,
  milesPerHex: number,
): number | null {
  if (!(barPixels > 0) || !(barMiles > 0) || !(milesPerHex > 0)) return null;
  const pixelsPerMile = barPixels / barMiles;
  return (milesPerHex * pixelsPerMile) / Math.sqrt(3);
}

export function clampHexSize(size: number): number {
  return Math.min(MAX_HEX_SIZE, Math.max(MIN_HEX_SIZE, size));
}

/**
 * A mile count for a scale label: whole numbers once the value is big enough
 * for the rounding not to matter (7.94 → "8"), one decimal below that so a
 * half-mile map doesn't read as "1".
 */
export function formatMiles(miles: number): string {
  if (miles >= 2) return String(Math.round(miles));
  return String(Math.round(miles * 10) / 10);
}
