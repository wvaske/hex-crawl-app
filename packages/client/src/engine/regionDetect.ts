import {
  FLOOD_MAX_CELLS,
  FLOOD_MAX_RADIUS,
  floodFill,
  floodFillByTerrain,
  hexKey,
  hexToPixel,
  type HexCell,
  type HexCoord,
  type HexLayout,
  type ImageLayer,
  type TerrainId,
} from '@hexcrawl/shared';

/**
 * Region auto-detect (issue #113): recommend a footprint from a region's
 * anchor hex. Two engines, one traversal — the flood fill itself lives in
 * shared (`rules/flood.ts`, unit-tested); everything here is about deciding
 * whether one hex belongs with the seed.
 *
 * Both return the recommended cells EXCLUDING the anchor (the anchor is an
 * implicit member of every footprint, and `content.area` ignores it anyway).
 */

export interface DetectLimits {
  maxCells?: number;
  maxRadius?: number;
}

function withoutAnchor(cells: HexCoord[], anchor: HexCoord): HexCoord[] {
  return cells.filter((c) => !(c.q === anchor.q && c.r === anchor.r));
}

/**
 * Terrain match: contiguous hexes whose painted terrain is in `terrains`.
 * Unpainted hexes stop the fill — an empty hex is the edge of the world, not
 * a match for anything.
 */
export function detectByTerrain(opts: {
  hexes: HexCell[];
  anchor: HexCoord;
  terrains: Set<TerrainId>;
  limits?: DetectLimits;
}): HexCoord[] {
  const terrainAt = new Map<string, TerrainId>();
  for (const cell of opts.hexes) terrainAt.set(hexKey(cell.q, cell.r), cell.terrain);
  const cells = floodFillByTerrain(terrainAt, opts.anchor, opts.terrains, {
    maxCells: opts.limits?.maxCells,
    maxRadius: opts.limits?.maxRadius,
  });
  return withoutAnchor(cells, opts.anchor);
}

/**
 * The base art for colour detection: the BOTTOM-most visible, player-visible
 * image layer. A DM-only overlay (secret annotations, a grid tracing) is not
 * what the region's colours live in, and the bottom layer is the sourcebook
 * scan everything else is drawn over.
 */
export function baseImageLayer(layers: ImageLayer[]): ImageLayer | null {
  const candidates = layers.filter((l) => l.visible && !l.dmOnly);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => a.z - b.z)[0]!;
}

/** RGB triple, 0–255. */
type Rgb = [number, number, number];

/**
 * Perceptually weighted RGB distance (the "low-cost approximation" weights
 * 2/4/3). Plain Euclidean RGB over-weights blue, which on parchment-toned
 * sourcebook art puts sea and sky closer together than the eye does. Range is
 * 0 (identical) to ~441 (black vs white), which is the scale the tolerance
 * slider (5–80) is calibrated against.
 */
function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/** Above this, the source image is drawn down before it is read back. */
const MAX_SAMPLE_DIMENSION = 4096;

interface SampledImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Canvas pixels per source-image pixel (≤ 1 when the art was drawn down). */
  drawScale: number;
}

/**
 * Load an image layer's art and read it back ONCE. Uploads are served from
 * the app's own origin (`/uploads`), so the canvas stays untainted and
 * `getImageData` is allowed. Very large scans are drawn down first: one
 * readback of a 12000px map would cost hundreds of megabytes, and hex-sized
 * sampling doesn't need that resolution.
 */
async function loadImageData(path: string): Promise<SampledImage> {
  const img = new Image();
  img.src = path;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('Image has no pixels');
  const drawScale = Math.min(1, MAX_SAMPLE_DIMENSION / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * drawScale));
  const ch = Math.max(1, Math.round(h * drawScale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.drawImage(img, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  return { width: cw, height: ch, data, drawScale };
}

/** Average colour of a small kernel around a canvas point; null if off-image. */
function sample(image: SampledImage, x: number, y: number, spread: number): Rgb | null {
  const offsets: [number, number][] = [
    [0, 0],
    [-spread, 0],
    [spread, 0],
    [0, -spread],
    [0, spread],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [dx, dy] of offsets) {
    const px = Math.round(x + dx);
    const py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
    const i = (py * image.width + px) * 4;
    // Fully transparent pixels carry no colour — treat them as off-image.
    if (image.data[i + 3]! < 8) continue;
    r += image.data[i]!;
    g += image.data[i + 1]!;
    b += image.data[i + 2]!;
    n++;
  }
  if (n === 0) return null;
  return [r / n, g / n, b / n];
}

/**
 * Map-colour match: region-grow from the anchor across hexes whose sampled
 * colour is within `tolerance` of the SEED hex's colour.
 *
 * The reference is fixed at the anchor's colour rather than a running mean of
 * the accepted cells: a running mean drifts, so a gentle gradient (a coastal
 * fade, a parchment vignette) would walk the fill clean off the region it
 * started in. A fixed seed means the tolerance says exactly what it looks
 * like it says — "within this much of where I clicked".
 *
 * The transform is the image layer's: a sprite is drawn at `layer.x/y` scaled
 * by `layer.scale`, so world = layer.xy + imageXY * scale, and therefore
 * imageXY = (world - layer.xy) / scale.
 */
export async function detectByImage(opts: {
  layer: ImageLayer;
  layout: HexLayout;
  anchor: HexCoord;
  /** 5–80 on the weighted-RGB scale above. */
  tolerance: number;
  limits?: DetectLimits;
}): Promise<HexCoord[]> {
  const image = await loadImageData(opts.layer.path);
  const { layer, layout } = opts;
  // World pixels → source-image pixels → canvas pixels.
  const toCanvas = (p: { x: number; y: number }) => ({
    x: ((p.x - layer.x) / layer.scale) * image.drawScale,
    y: ((p.y - layer.y) / layer.scale) * image.drawScale,
  });
  // Kernel spread: a bit under half a hex, in canvas pixels.
  const spread = Math.max(1, (0.4 * layout.size * image.drawScale) / layer.scale);
  const colorOf = (hex: HexCoord): Rgb | null => {
    const p = toCanvas(hexToPixel(layout, hex));
    return sample(image, p.x, p.y, spread);
  };

  const seed = colorOf(opts.anchor);
  if (!seed) return []; // the anchor isn't on the art — nothing to grow from
  const cells = floodFill({
    anchor: opts.anchor,
    accept: (hex) => {
      const c = colorOf(hex);
      return c !== null && colorDistance(c, seed) <= opts.tolerance;
    },
    maxCells: opts.limits?.maxCells,
    maxRadius: opts.limits?.maxRadius,
  });
  return withoutAnchor(cells, opts.anchor);
}

export { FLOOD_MAX_CELLS, FLOOD_MAX_RADIUS };
