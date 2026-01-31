import { useTick } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';
import { useCallback, useEffect, useRef } from 'react';
import { hexKey, parseHexKey } from '@hex-crawl/shared';
import { useUIStore, DragRect } from '../../stores/useUIStore';
import { createGrid, GameHex } from '../../hex/grid';
import { useMapStore } from '../../stores/useMapStore';
import { offsetToAxial } from '../../hex/coordinates';

/** Hover highlight style */
const HOVER_FILL_COLOR = 0xffff00;
const HOVER_FILL_ALPHA = 0.3;
const HOVER_STROKE_COLOR = 0xffff00;
const HOVER_STROKE_ALPHA = 0.8;
const HOVER_STROKE_WIDTH = 3;

/** Selection highlight style */
const SELECT_FILL_COLOR = 0x3388ff;
const SELECT_FILL_ALPHA = 0.25;
const SELECT_STROKE_COLOR = 0x3388ff;
const SELECT_STROKE_ALPHA = 0.7;
const SELECT_STROKE_WIDTH = 2;

/** Drag preview highlight style */
const DRAG_FILL_COLOR = 0x3388ff;
const DRAG_FILL_ALPHA = 0.12;
const DRAG_STROKE_COLOR = 0x3388ff;
const DRAG_STROKE_ALPHA = 0.4;
const DRAG_STROKE_WIDTH = 1;

/**
 * Compute the approximate world-space center of a hex from its axial coords.
 * Uses flat-top hex math matching HexInteraction's hexCenterWorld.
 */
function hexCenterWorld(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * (3 / 2) * q,
    y: size * Math.sqrt(3) * (r + q / 2),
  };
}

/**
 * Find hex keys whose polygon touches the given world-space rectangle.
 * Expands rect by the hex inradius so edge-touching hexes are included.
 */
function hexKeysInRect(
  rect: DragRect,
  gridW: number, gridH: number,
): Set<string> {
  const hexSize = useMapStore.getState().hexSize;
  // Expand by circumradius (full hex size) so any hex whose polygon touches the rect is included
  const eMinX = rect.minX - hexSize;
  const eMaxX = rect.maxX + hexSize;
  const eMinY = rect.minY - hexSize;
  const eMaxY = rect.maxY + hexSize;
  const keys = new Set<string>();
  for (let col = 0; col < gridW; col++) {
    for (let row = 0; row < gridH; row++) {
      const { q, r } = offsetToAxial(col, row);
      const center = hexCenterWorld(q, r, hexSize);
      if (center.x >= eMinX && center.x <= eMaxX && center.y >= eMinY && center.y <= eMaxY) {
        keys.add(hexKey(q, r));
      }
    }
  }
  return keys;
}

/**
 * Draw a filled hex polygon with a stroke outline on a Graphics object.
 */
function drawHexHighlight(
  gfx: Graphics,
  hex: GameHex,
  fillColor: number,
  fillAlpha: number,
  strokeColor: number,
  strokeAlpha: number,
  strokeWidth: number,
): void {
  const corners = hex.corners;
  if (corners.length < 6) return;

  // Draw fill
  const first = corners[0]!;
  gfx.moveTo(first.x, first.y);
  for (let i = 1; i < corners.length; i++) {
    const corner = corners[i]!;
    gfx.lineTo(corner.x, corner.y);
  }
  gfx.lineTo(first.x, first.y);
  gfx.fill({ color: fillColor, alpha: fillAlpha });
  gfx.stroke({ width: strokeWidth, color: strokeColor, alpha: strokeAlpha });
}

/**
 * Renders hover and selection highlight overlays on hexes.
 *
 * - Hover: yellow semi-transparent fill + thick yellow border
 * - Selection: cyan semi-transparent fill + cyan border
 *
 * Uses Graphics (not Sprites) since these are dynamic overlays
 * that change frequently. Graphics is appropriate for a small number
 * of dynamic shapes (1 hover + N selected).
 *
 * Sits at z-index 2 (above terrain and grid lines).
 */
export function HighlightLayer() {
  const containerRef = useRef<Container | null>(null);
  const graphicsRef = useRef<Graphics | null>(null);
  const gridRef = useRef<ReturnType<typeof createGrid> | null>(null);

  // Subscribe to store values
  const hoveredHex = useUIStore((s) => s.hoveredHex);
  const selectedHexes = useUIStore((s) => s.selectedHexes);
  const dragRect = useUIStore((s) => s.dragRect);
  const gridWidth = useMapStore((s) => s.gridWidth);
  const gridHeight = useMapStore((s) => s.gridHeight);

  // Refs for use in tick callback
  const hoveredHexRef = useRef(hoveredHex);
  hoveredHexRef.current = hoveredHex;
  const selectedHexesRef = useRef(selectedHexes);
  selectedHexesRef.current = selectedHexes;
  const dragRectRef = useRef(dragRect);
  dragRectRef.current = dragRect;
  const gridDimsRef = useRef({ w: gridWidth, h: gridHeight });
  gridDimsRef.current = { w: gridWidth, h: gridHeight };

  // Track last drawn state to avoid unnecessary redraws
  const lastDrawnRef = useRef<{
    hovered: string | null;
    selectedCount: number;
    selectedKeys: string;
    dragRect: DragRect | null;
  }>({ hovered: null, selectedCount: 0, selectedKeys: '', dragRect: null });

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

  /** Redraw highlights when hover/selection state changes */
  const drawHighlights = useCallback(() => {
    const gfx = graphicsRef.current;
    const grid = gridRef.current;
    if (!gfx || !grid) return;

    const hovered = hoveredHexRef.current;
    const selected = selectedHexesRef.current;
    const currentDragRect = dragRectRef.current;

    // Check if state actually changed to avoid unnecessary redraws
    const selectedKeysStr = [...selected].sort().join(';');
    const last = lastDrawnRef.current;
    if (
      hovered === last.hovered &&
      selected.size === last.selectedCount &&
      selectedKeysStr === last.selectedKeys &&
      currentDragRect === last.dragRect
    ) {
      return;
    }
    lastDrawnRef.current = {
      hovered,
      selectedCount: selected.size,
      selectedKeys: selectedKeysStr,
      dragRect: currentDragRect,
    };

    // Clear previous highlights
    gfx.clear();

    // Build a lookup map from grid hexes for coordinate-to-pixel conversion
    // This is needed because we need the hex corners for drawing
    const hexLookup = new Map<string, GameHex>();
    grid.forEach((hex: GameHex) => {
      hexLookup.set(`${hex.q},${hex.r}`, hex);
    });

    // Draw selection highlights (drawn first, so hover draws on top)
    for (const key of selected) {
      const coord = parseHexKey(key);
      const hex = hexLookup.get(`${coord.q},${coord.r}`);
      if (hex) {
        drawHexHighlight(
          gfx,
          hex,
          SELECT_FILL_COLOR,
          SELECT_FILL_ALPHA,
          SELECT_STROKE_COLOR,
          SELECT_STROKE_ALPHA,
          SELECT_STROKE_WIDTH,
        );
      }
    }

    // Draw drag preview highlights
    if (currentDragRect) {
      const dims = gridDimsRef.current;
      const previewKeys = hexKeysInRect(currentDragRect, dims.w, dims.h);
      for (const key of previewKeys) {
        if (selected.has(key)) continue; // already drawn as selected
        const coord = parseHexKey(key);
        const hex = hexLookup.get(`${coord.q},${coord.r}`);
        if (hex) {
          drawHexHighlight(
            gfx,
            hex,
            DRAG_FILL_COLOR,
            DRAG_FILL_ALPHA,
            DRAG_STROKE_COLOR,
            DRAG_STROKE_ALPHA,
            DRAG_STROKE_WIDTH,
          );
        }
      }
    }

    // Draw hover highlight on top
    if (hovered) {
      const coord = parseHexKey(hovered);
      const hex = hexLookup.get(`${coord.q},${coord.r}`);
      if (hex) {
        drawHexHighlight(
          gfx,
          hex,
          HOVER_FILL_COLOR,
          HOVER_FILL_ALPHA,
          HOVER_STROKE_COLOR,
          HOVER_STROKE_ALPHA,
          HOVER_STROKE_WIDTH,
        );
      }
    }
  }, []);

  useTick(drawHighlights);

  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}
