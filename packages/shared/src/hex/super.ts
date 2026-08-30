/**
 * Multi-scale hexes via 7-cell clustering (H3/Gosper-style).
 *
 * A level-1 "superhex" is a fine hex plus its 6 neighbors — seven cells that
 * tile the plane perfectly. The superhex centers themselves form a hexagonal
 * lattice, rotated atan(√3/5) ≈ 19.1° and scaled √7, so the construction
 * recurses: level 2 = 49 fine hexes, etc. Linear scale per level is √7
 * (6-mile hexes → ≈15.9 → 42).
 */
import {
  HEX_DIRECTIONS,
  hexAdd,
  hexDistance,
  hexNeighbors,
  type HexCoord,
} from './coords.js';
import { hexCornerOffsets, type HexLayout, type Point } from './layout.js';

/** Rotation between successive levels, radians. */
export const SUPER_ROTATION = Math.atan(Math.sqrt(3) / 5);
/** Linear scale between successive levels. */
export const SUPER_SCALE = Math.sqrt(7);
export const MAX_SCALE_LEVEL = 2;

/** Sublattice basis in child-frame axial coords: u=(2,1), v = u rotated 60°. */
function clusterCenterOf(i: number, j: number): HexCoord {
  return { q: 2 * i - j, r: i + 3 * j };
}

/**
 * Index (axial coords in the parent frame) of the 7-cluster containing `h`
 * (child-frame axial). Every hex is either a cluster center or adjacent to
 * exactly one, so the nearest candidate within distance 1 is the answer.
 */
export function clusterIndex(h: HexCoord): HexCoord {
  const fi = (3 * h.q + h.r) / 7;
  const fj = (-h.q + 2 * h.r) / 7;
  const i0 = Math.round(fi);
  const j0 = Math.round(fj);
  let best: HexCoord = { q: i0, r: j0 };
  let bestD = Infinity;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const c = clusterCenterOf(i0 + di, j0 + dj);
      const d = hexDistance(h, c);
      if (d < bestD) {
        bestD = d;
        best = { q: i0 + di, r: j0 + dj };
      }
    }
  }
  return best;
}

/** Map an index in frame `level` down to its center in fine (level-0) axial coords. */
export function indexToFineCenter(index: HexCoord, level: number): HexCoord {
  let c = index;
  for (let l = 0; l < level; l++) {
    c = clusterCenterOf(c.q, c.r);
  }
  return c;
}

/** Index (in frame `level`) of the cell containing fine hex `h`. */
export function fineToIndex(h: HexCoord, level: number): HexCoord {
  let idx = h;
  for (let l = 0; l < level; l++) {
    idx = clusterIndex(idx);
  }
  return idx;
}

/** Center (fine axial) of the level-`level` cell containing fine hex `h`. */
export function superCenter(h: HexCoord, level: number): HexCoord {
  return indexToFineCenter(fineToIndex(h, level), level);
}

/** All fine hexes belonging to the cell with `index` in frame `level`. */
export function superMembers(index: HexCoord, level: number): HexCoord[] {
  if (level <= 0) return [index];
  const centerBelow = clusterCenterOf(index.q, index.r);
  const cellsBelow = [centerBelow, ...hexNeighbors(centerBelow)];
  return cellsBelow.flatMap((c) => superMembers(c, level - 1));
}

/** Members (fine hexes) of the cell containing fine hex `h`. */
export function superMembersOf(h: HexCoord, level: number): HexCoord[] {
  return superMembers(fineToIndex(h, level), level);
}

/** Neighbor indices of a cell in its own frame (standard hex adjacency). */
export function superIndexRange(index: HexCoord, radius: number): HexCoord[] {
  const out: HexCoord[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const rMin = Math.max(-radius, -dq - radius);
    const rMax = Math.min(radius, -dq + radius);
    for (let dr = rMin; dr <= rMax; dr++) {
      out.push(hexAdd(index, { q: dq, r: dr }));
    }
  }
  return out;
}

/** Corner offsets for a level-`level` cell (rotated + scaled fine corners). */
export function superCornerOffsets(layout: HexLayout, level: number): Point[] {
  const scale = Math.pow(SUPER_SCALE, level);
  const angle = SUPER_ROTATION * level;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return hexCornerOffsets(layout).map((c) => ({
    x: (c.x * cos - c.y * sin) * scale,
    y: (c.x * sin + c.y * cos) * scale,
  }));
}

/** Fractional index of a fine fractional axial coord in frame `level`. */
export function fractionalIndex(fq: number, fr: number, level: number): { i: number; j: number } {
  let i = fq;
  let j = fr;
  for (let l = 0; l < level; l++) {
    const ni = (3 * i + j) / 7;
    const nj = (-i + 2 * j) / 7;
    i = ni;
    j = nj;
  }
  return { i, j };
}

export { HEX_DIRECTIONS };
