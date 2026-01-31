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

/** DM tint: subtle red indicator on unrevealed hexes */
const DM_TINT_FILL = 0xff4444;
const DM_TINT_ALPHA = 0.08;

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
 * Renders two-tier fog of war overlays on the hex map.
 *
 * Players:
 *   - Revealed hexes: no overlay
 *   - Adjacent hexes (tier 1): semi-transparent dimmed overlay
 *   - Hidden hexes (tier 2): nearly opaque dark overlay
 *
 * DM:
 *   - Unrevealed hexes: subtle red tint (terrain fully visible)
 *   - Revealed hexes: no overlay
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
        // DM: subtle tint on unrevealed hexes
        if (!revealed.has(key)) {
          drawHexFog(gfx, hex, DM_TINT_FILL, DM_TINT_ALPHA);
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
