import { type HexCoord, hexRound } from './coords.js';

export type HexOrientation = 'pointy' | 'flat';

export interface Point {
  x: number;
  y: number;
}

export interface HexLayout {
  orientation: HexOrientation;
  /** Circumradius (center to corner) in pixels. */
  size: number;
  /** Pixel position of hex (0,0)'s center. */
  origin: Point;
}

interface OrientationMatrix {
  f0: number;
  f1: number;
  f2: number;
  f3: number;
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  startAngle: number; // in multiples of 60 degrees
}

const SQRT3 = Math.sqrt(3);

const POINTY: OrientationMatrix = {
  f0: SQRT3,
  f1: SQRT3 / 2,
  f2: 0,
  f3: 3 / 2,
  b0: SQRT3 / 3,
  b1: -1 / 3,
  b2: 0,
  b3: 2 / 3,
  startAngle: 0.5,
};

const FLAT: OrientationMatrix = {
  f0: 3 / 2,
  f1: 0,
  f2: SQRT3 / 2,
  f3: SQRT3,
  b0: 2 / 3,
  b1: 0,
  b2: -1 / 3,
  b3: SQRT3 / 3,
  startAngle: 0,
};

function matrix(orientation: HexOrientation): OrientationMatrix {
  return orientation === 'pointy' ? POINTY : FLAT;
}

/** Pixel center of a hex. */
export function hexToPixel(layout: HexLayout, hex: HexCoord): Point {
  const m = matrix(layout.orientation);
  return {
    x: (m.f0 * hex.q + m.f1 * hex.r) * layout.size + layout.origin.x,
    y: (m.f2 * hex.q + m.f3 * hex.r) * layout.size + layout.origin.y,
  };
}

/** Hex containing a pixel point. */
export function pixelToHex(layout: HexLayout, p: Point): HexCoord {
  const m = matrix(layout.orientation);
  const px = (p.x - layout.origin.x) / layout.size;
  const py = (p.y - layout.origin.y) / layout.size;
  const q = m.b0 * px + m.b1 * py;
  const r = m.b2 * px + m.b3 * py;
  return hexRound(q, r);
}

/** The six corner points of a hex, in drawing order. */
export function hexCorners(layout: HexLayout, hex: HexCoord): Point[] {
  const center = hexToPixel(layout, hex);
  return hexCornerOffsets(layout).map((o) => ({ x: center.x + o.x, y: center.y + o.y }));
}

/** Corner offsets relative to a hex center (same for every hex). */
export function hexCornerOffsets(layout: HexLayout): Point[] {
  const m = matrix(layout.orientation);
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((m.startAngle + i) * Math.PI) / 3;
    corners.push({ x: layout.size * Math.cos(angle), y: layout.size * Math.sin(angle) });
  }
  return corners;
}

/** Width/height of a single hex's bounding box. */
export function hexBounds(layout: HexLayout): { width: number; height: number } {
  return layout.orientation === 'pointy'
    ? { width: SQRT3 * layout.size, height: 2 * layout.size }
    : { width: 2 * layout.size, height: SQRT3 * layout.size };
}

/** Axial hexes whose centers fall within a pixel-space rectangle (with 1-hex margin). */
export function hexesInPixelRect(
  layout: HexLayout,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): HexCoord[] {
  const corners = [
    pixelToHex(layout, { x: minX, y: minY }),
    pixelToHex(layout, { x: maxX, y: minY }),
    pixelToHex(layout, { x: minX, y: maxY }),
    pixelToHex(layout, { x: maxX, y: maxY }),
  ];
  const qMin = Math.min(...corners.map((c) => c.q)) - 1;
  const qMax = Math.max(...corners.map((c) => c.q)) + 1;
  const rMin = Math.min(...corners.map((c) => c.r)) - 1;
  const rMax = Math.max(...corners.map((c) => c.r)) + 1;
  const result: HexCoord[] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const p = hexToPixel(layout, { q, r });
      if (p.x >= minX - layout.size && p.x <= maxX + layout.size && p.y >= minY - layout.size && p.y <= maxY + layout.size) {
        result.push({ q, r });
      }
    }
  }
  return result;
}
