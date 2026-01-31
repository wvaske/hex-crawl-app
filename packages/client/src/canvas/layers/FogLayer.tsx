import { useTick } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';
import { useCallback, useEffect, useRef } from 'react';
import { parseHexKey } from '@hex-crawl/shared';
import { createGrid, GameHex } from '../../hex/grid';
import { useSessionStore } from '../../stores/useSessionStore';
import { useMapStore } from '../../stores/useMapStore';

/** Tier 2: Deep fog -- nearly opaque, hides all terrain detail */
const TIER2_FILL = 0x1a1a2e;
const TIER2_ALPHA = 0.95;

/** Tier 1: Adjacent fog -- dimmed but terrain visible underneath */
const TIER1_FILL = 0x2a2a3e;
const TIER1_ALPHA = 0.55;

/** DM hatching on unrevealed hexes: diagonal slash pattern */
const DM_HATCH_COLOR = 0xff4444;
const DM_HATCH_ALPHA = 0.35;
const DM_HATCH_SPACING = 12;
const DM_HATCH_WIDTH = 2;

/**
 * Draw a filled hex polygon on a Graphics object.
 */
function drawHexFog(
  gfx: Graphics,
  hex: GameHex,
  fillColor: number,
  fillAlpha: number,
): void {
  const corners = hex.corners;
  if (corners.length < 6) return;

  const first = corners[0]!;
  gfx.moveTo(first.x, first.y);
  for (let i = 1; i < corners.length; i++) {
    const corner = corners[i]!;
    gfx.lineTo(corner.x, corner.y);
  }
  gfx.lineTo(first.x, first.y);
  gfx.fill({ color: fillColor, alpha: fillAlpha });
}

/**
 * Accumulate diagonal slash line segments clipped to a hex polygon.
 * Adds clipped segments to the provided array for batched stroke() later.
 */
function collectHexHatchSegments(
  hex: GameHex,
  spacing: number,
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>,
): void {
  const corners = hex.corners;
  if (corners.length < 6) return;

  // Bounding box of hex
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  // Build edge list for clipping (convex polygon)
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  // Generate diagonal lines (bottom-left to top-right, slope = 1)
  const totalSpan = (maxX - minX) + (maxY - minY);

  for (let offset = 0; offset <= totalSpan; offset += spacing) {
    const lx1 = minX - 1;
    const ly1 = maxY - offset;
    const lx2 = maxX + 1;
    const ly2 = ly1 + (lx2 - lx1); // slope = 1

    // Clip line to convex hex polygon using Cyrus-Beck
    let tMin = 0, tMax = 1;
    const dx = lx2 - lx1;
    const dy = ly2 - ly1;
    let clipped = true;

    for (const e of edges) {
      const nx = -(e.y2 - e.y1);
      const ny = e.x2 - e.x1;
      const denom = nx * dx + ny * dy;
      const num = nx * (lx1 - e.x1) + ny * (ly1 - e.y1);

      if (Math.abs(denom) < 1e-10) {
        if (num > 0) { clipped = false; break; }
      } else {
        const t = -num / denom;
        if (denom < 0) {
          if (t > tMin) tMin = t;
        } else {
          if (t < tMax) tMax = t;
        }
        if (tMin > tMax) { clipped = false; break; }
      }
    }

    if (clipped && tMin <= tMax) {
      segments.push({
        x1: lx1 + tMin * dx,
        y1: ly1 + tMin * dy,
        x2: lx1 + tMax * dx,
        y2: ly1 + tMax * dy,
      });
    }
  }
}

/**
 * Renders two-tier fog of war overlays on the hex map.
 *
 * Players:
 *   - Revealed hexes: no overlay
 *   - Adjacent hexes (tier 1): semi-transparent dimmed overlay
 *   - Hidden hexes (tier 2): nearly opaque dark overlay
 *
 * DM:
 *   - Unrevealed hexes: diagonal red slash pattern (terrain visible through hatching)
 *   - Revealed hexes: no overlay (clear view, same as what players see)
 *
 * Uses Graphics for dynamic overlays with viewport culling.
 * Sits between GridLineLayer and HighlightLayer.
 */
export function FogLayer() {
  const containerRef = useRef<Container | null>(null);
  const graphicsRef = useRef<Graphics | null>(null);
  const gridRef = useRef<ReturnType<typeof createGrid> | null>(null);

  // Subscribe to store values
  const revealedHexKeys = useSessionStore((s) => s.revealedHexKeys);
  const adjacentHexKeys = useSessionStore((s) => s.adjacentHexKeys);
  const userRole = useSessionStore((s) => s.userRole);
  const gridWidth = useMapStore((s) => s.gridWidth);
  const gridHeight = useMapStore((s) => s.gridHeight);
  const hexes = useMapStore((s) => s.hexes);

  // Refs for use in tick callback
  const revealedRef = useRef(revealedHexKeys);
  revealedRef.current = revealedHexKeys;
  const adjacentRef = useRef(adjacentHexKeys);
  adjacentRef.current = adjacentHexKeys;
  const userRoleRef = useRef(userRole);
  userRoleRef.current = userRole;
  const hexesRef = useRef(hexes);
  hexesRef.current = hexes;

  // Track last drawn state to avoid unnecessary redraws
  const lastDrawnRef = useRef<{
    revealedSize: number;
    adjacentSize: number;
    role: string | null;
    hexCount: number;
  }>({ revealedSize: -1, adjacentSize: -1, role: null, hexCount: -1 });

  // Create grid for hex coordinate lookup
  useEffect(() => {
    if (gridWidth > 0 && gridHeight > 0) {
      gridRef.current = createGrid(gridWidth, gridHeight);
    }
  }, [gridWidth, gridHeight]);

  // Create and attach the Graphics object imperatively
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const gfx = new Graphics();
    graphicsRef.current = gfx;
    container.addChild(gfx);

    return () => {
      container.removeChild(gfx);
      gfx.destroy();
      graphicsRef.current = null;
    };
  }, []);

  /** Redraw fog overlays when state changes */
  const drawFog = useCallback(() => {
    const gfx = graphicsRef.current;
    const grid = gridRef.current;
    if (!gfx || !grid) return;

    const revealed = revealedRef.current;
    const adjacent = adjacentRef.current;
    const role = userRoleRef.current;
    const allHexes = hexesRef.current;

    // Check if state actually changed
    const last = lastDrawnRef.current;
    if (
      revealed.size === last.revealedSize &&
      adjacent.size === last.adjacentSize &&
      role === last.role &&
      allHexes.size === last.hexCount
    ) {
      return;
    }
    lastDrawnRef.current = {
      revealedSize: revealed.size,
      adjacentSize: adjacent.size,
      role,
      hexCount: allHexes.size,
    };

    gfx.clear();

    if (allHexes.size === 0) return;

    // Build hex lookup from grid
    const hexLookup = new Map<string, GameHex>();
    grid.forEach((hex: GameHex) => {
      hexLookup.set(`${hex.q},${hex.r}`, hex);
    });

    // Viewport culling bounds
    const container = containerRef.current;
    let visLeft = -Infinity,
      visRight = Infinity,
      visTop = -Infinity,
      visBottom = Infinity;
    if (container?.parent) {
      const viewport = container.parent as unknown as {
        left: number;
        right: number;
        top: number;
        bottom: number;
      };
      const pad = 100;
      visLeft = viewport.left - pad;
      visRight = viewport.right + pad;
      visTop = viewport.top - pad;
      visBottom = viewport.bottom + pad;
    }

    // Collect hatch segments for DM (batched stroke at end)
    const hatchSegments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

    // Iterate all hex keys from the map store
    for (const key of allHexes.keys()) {
      const coord = parseHexKey(key);
      const hex = hexLookup.get(`${coord.q},${coord.r}`);
      if (!hex) continue;

      // Viewport culling
      const hx = hex.x;
      const hy = hex.y;
      const hw = hex.width / 2;
      const hh = hex.height / 2;
      if (
        hx + hw < visLeft ||
        hx - hw > visRight ||
        hy + hh < visTop ||
        hy - hh > visBottom
      ) {
        continue;
      }

      if (role === 'dm') {
        // DM: diagonal slash pattern on unrevealed hexes, clear on revealed
        if (!revealed.has(key)) {
          collectHexHatchSegments(hex, DM_HATCH_SPACING, hatchSegments);
        }
      } else {
        // Player (or null role): two-tier fog
        if (revealed.has(key)) {
          // No fog on revealed hexes
          continue;
        } else if (adjacent.has(key)) {
          // Tier 1: adjacent -- dimmed
          drawHexFog(gfx, hex, TIER1_FILL, TIER1_ALPHA);
        } else {
          // Tier 2: hidden -- nearly opaque
          drawHexFog(gfx, hex, TIER2_FILL, TIER2_ALPHA);
        }
      }
    }

    // Batch stroke all DM hatch lines in one call
    if (hatchSegments.length > 0) {
      for (const seg of hatchSegments) {
        gfx.moveTo(seg.x1, seg.y1);
        gfx.lineTo(seg.x2, seg.y2);
      }
      gfx.stroke({ width: DM_HATCH_WIDTH, color: DM_HATCH_COLOR, alpha: DM_HATCH_ALPHA });
    }
  }, []);

  useTick(drawFog);

  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}
