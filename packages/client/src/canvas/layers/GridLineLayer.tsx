import { useTick } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';
import { useCallback, useEffect, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore';
import { createGrid, GameHex } from '../../hex/grid';

/** Line style for grid borders: thin, semi-transparent white */
const GRID_LINE_COLOR = 0xffffff;
const GRID_LINE_ALPHA = 0.18;
const GRID_LINE_WIDTH = 1;

/**
 * Renders hex border outlines over the terrain layer.
 * Uses an imperative Graphics object managed within a Container.
 * Grid lines use Graphics (not Sprites) since they are thin outlines,
 * not filled polygons -- the performance concern from PITFALL 1 applies
 * only to filled hex tiles.
 *
 * Implements viewport culling: only draws outlines for visible hexes.
 * Sits above TerrainLayer in z-order.
 */
export function GridLineLayer() {
  const containerRef = useRef<Container | null>(null);
  const graphicsRef = useRef<Graphics | null>(null);
  const gridRef = useRef<ReturnType<typeof createGrid> | null>(null);
  const lastBoundsRef = useRef({ left: 0, right: 0, top: 0, bottom: 0 });

  const hexes = useMapStore((s) => s.hexes);
  const gridWidth = useMapStore((s) => s.gridWidth);
  const gridHeight = useMapStore((s) => s.gridHeight);

  // Create grid once when dimensions change
  useEffect(() => {
    if (gridWidth > 0 && gridHeight > 0) {
      gridRef.current = createGrid(gridWidth, gridHeight);
      // Force redraw on grid change
      lastBoundsRef.current = { left: -1, right: -1, top: -1, bottom: -1 };
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

  // Draw grid lines callback
  const drawGridLines = useCallback(() => {
    const gfx = graphicsRef.current;
    const grid = gridRef.current;
    const container = containerRef.current;
    if (!gfx || !grid || !container || hexes.size === 0) return;

    // Get the viewport (parent of container)
    const viewport = container.parent as unknown as {
      left: number;
      right: number;
      top: number;
      bottom: number;
    } | null;
    if (!viewport || typeof viewport.left !== 'number') return;

    // Check if viewport bounds have significantly changed
    const bounds = {
      left: viewport.left,
      right: viewport.right,
      top: viewport.top,
      bottom: viewport.bottom,
    };

    const last = lastBoundsRef.current;
    const threshold = 10;
    if (
      Math.abs(bounds.left - last.left) < threshold &&
      Math.abs(bounds.right - last.right) < threshold &&
      Math.abs(bounds.top - last.top) < threshold &&
      Math.abs(bounds.bottom - last.bottom) < threshold
    ) {
      return;
    }
    lastBoundsRef.current = bounds;

    // Add padding for smooth scrolling
    const pad = 100;
    const visLeft = bounds.left - pad;
    const visRight = bounds.right + pad;
    const visTop = bounds.top - pad;
    const visBottom = bounds.bottom + pad;

    // Clear previous drawing
    gfx.clear();

    // Draw hex outlines for visible hexes
    grid.forEach((hex: GameHex) => {
      // Quick AABB check using hex position.
      // hex.x/hex.y is the CENTER, so compute bounding-box edges.
      const hw = hex.width;
      const hh = hex.height;
      const hx = hex.x - hw / 2;
      const hy = hex.y - hh / 2;

      if (
        hx + hw < visLeft ||
        hx > visRight ||
        hy + hh < visTop ||
        hy > visBottom
      ) {
        return; // Skip hex -- not visible
      }

      // Draw hex outline using corner points
      const corners = hex.corners;
      if (corners.length < 6) return;

      const first = corners[0]!;
      gfx.moveTo(first.x, first.y);
      for (let i = 1; i < corners.length; i++) {
        const corner = corners[i]!;
        gfx.lineTo(corner.x, corner.y);
      }
      gfx.lineTo(first.x, first.y);
    });

    gfx.stroke({
      width: GRID_LINE_WIDTH,
      color: GRID_LINE_COLOR,
      alpha: GRID_LINE_ALPHA,
    });
  }, [hexes]);

  // Draw on each tick (only redraws when viewport bounds change)
  useTick(drawGridLines);

  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}
