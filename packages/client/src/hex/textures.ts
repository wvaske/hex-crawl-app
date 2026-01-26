import { Texture } from 'pixi.js';
import type { TerrainType } from '@hex-crawl/shared';
import { TERRAIN_COLORS, TERRAIN_TYPES } from '@hex-crawl/shared';

/** Default hex circumradius in pixels */
const HEX_SIZE = 40;

/** Flat-top hex dimensions: width = 2 * size, height = sqrt(3) * size */
const HEX_WIDTH = HEX_SIZE * 2; // 80
const HEX_HEIGHT = Math.round(Math.sqrt(3) * HEX_SIZE); // ~69

/** Number of visual variants per terrain type */
const VARIANTS_PER_TERRAIN = 3;

/** Storage for generated textures, keyed by "terrain_variant" */
const textureMap = new Map<string, Texture>();

/** Whether textures have been generated */
let texturesGenerated = false;

/**
 * Compute the 6 corner points of a flat-top hexagon centered in a bounding box.
 * Flat-top hex corners (centered at cx, cy with circumradius r):
 *   angle = 60 * i degrees, i = 0..5
 *   x = cx + r * cos(angle)
 *   y = cy + r * sin(angle)
 */
function getHexCorners(
  cx: number,
  cy: number,
  size: number,
): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i;
    const angleRad = (Math.PI / 180) * angleDeg;
    corners.push({
      x: cx + size * Math.cos(angleRad),
      y: cy + size * Math.sin(angleRad),
    });
  }
  return corners;
}

/**
 * Simple seeded pseudo-random number generator (mulberry32).
 * Returns a function that produces values in [0, 1).
 */
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Parse a hex color string (#RRGGBB) to { r, g, b } values (0-255).
 */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

/**
 * Generate a single hex-shaped terrain texture using offscreen Canvas 2D.
 * The texture is a hex polygon filled with the terrain color plus noise overlay.
 *
 * @param color - Hex color string (e.g., "#2d5a27")
 * @param variant - Variant index (0-2) for different noise seed
 * @param terrainIndex - Index of the terrain type for seed diversification
 */
function generateHexCanvas(
  color: string,
  variant: number,
  terrainIndex: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = HEX_WIDTH;
  canvas.height = HEX_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context for texture generation');

  const cx = HEX_WIDTH / 2;
  const cy = HEX_HEIGHT / 2;
  const corners = getHexCorners(cx, cy, HEX_SIZE);

  // Create hex clipping path
  ctx.beginPath();
  const first = corners[0]!;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < corners.length; i++) {
    const corner = corners[i]!;
    ctx.lineTo(corner.x, corner.y);
  }
  ctx.closePath();
  ctx.clip();

  // Fill with base terrain color
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, HEX_WIDTH, HEX_HEIGHT);

  // Add noise overlay for visual variety
  const rgb = parseHexColor(color);
  const seed = terrainIndex * 1000 + variant * 100 + 42;
  const rng = seededRandom(seed);

  // Scatter semi-transparent dots for noise
  const dotCount = 80 + Math.floor(rng() * 60);
  for (let d = 0; d < dotCount; d++) {
    const dx = rng() * HEX_WIDTH;
    const dy = rng() * HEX_HEIGHT;
    const radius = 1 + rng() * 3;
    const brighten = rng() > 0.5;
    const amount = 15 + rng() * 30;

    const nr = Math.min(255, Math.max(0, rgb.r + (brighten ? amount : -amount)));
    const ng = Math.min(255, Math.max(0, rgb.g + (brighten ? amount : -amount)));
    const nb = Math.min(255, Math.max(0, rgb.b + (brighten ? amount : -amount)));
    const alpha = 0.15 + rng() * 0.3;

    ctx.fillStyle = `rgba(${Math.round(nr)}, ${Math.round(ng)}, ${Math.round(nb)}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(dx, dy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Add a second pass of smaller, denser noise for texture
  const fineCount = 40 + Math.floor(rng() * 40);
  for (let d = 0; d < fineCount; d++) {
    const dx = rng() * HEX_WIDTH;
    const dy = rng() * HEX_HEIGHT;
    const radius = 0.5 + rng() * 1.5;
    const brighten = rng() > 0.4;
    const amount = 20 + rng() * 25;

    const nr = Math.min(255, Math.max(0, rgb.r + (brighten ? amount : -amount)));
    const ng = Math.min(255, Math.max(0, rgb.g + (brighten ? amount : -amount)));
    const nb = Math.min(255, Math.max(0, rgb.b + (brighten ? amount : -amount)));
    const alpha = 0.1 + rng() * 0.2;

    ctx.fillStyle = `rgba(${Math.round(nr)}, ${Math.round(ng)}, ${Math.round(nb)}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(dx, dy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

/**
 * Generate terrain textures for all terrain types and variants.
 * Creates 30 textures total (10 terrain types x 3 variants).
 * Stores them in the internal texture map for retrieval via getTerrainTexture().
 */
export function generateTerrainTextures(): void {
  if (texturesGenerated) return;

  TERRAIN_TYPES.forEach((terrain, terrainIndex) => {
    const color = TERRAIN_COLORS[terrain];
    for (let variant = 0; variant < VARIANTS_PER_TERRAIN; variant++) {
      const canvas = generateHexCanvas(color, variant, terrainIndex);
      const texture = Texture.from({ resource: canvas, label: `${terrain}_${variant}` });
      textureMap.set(`${terrain}_${variant}`, texture);
    }
  });

  texturesGenerated = true;
  console.log(`[textures] Generated ${textureMap.size} terrain textures (${TERRAIN_TYPES.length} types x ${VARIANTS_PER_TERRAIN} variants)`);
}

/**
 * Look up a terrain texture by type and variant index.
 * Must call generateTerrainTextures() first.
 *
 * @param terrain - The terrain type
 * @param variant - The variant index (0-2)
 * @returns The PixiJS Texture, or Texture.WHITE if not found
 */
export function getTerrainTexture(terrain: TerrainType, variant: number): Texture {
  const key = `${terrain}_${variant}`;
  const texture = textureMap.get(key);
  if (!texture) {
    console.warn(`[textures] Texture not found: ${key}. Returning fallback.`);
    return Texture.WHITE;
  }
  return texture;
}

/** Get the hex width used for texture generation */
export function getHexWidth(): number {
  return HEX_WIDTH;
}

/** Get the hex height used for texture generation */
export function getHexHeight(): number {
  return HEX_HEIGHT;
}

/** Check if textures have been generated */
export function areTexturesReady(): boolean {
  return texturesGenerated;
}
