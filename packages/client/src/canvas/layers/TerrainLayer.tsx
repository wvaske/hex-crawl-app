import { useTick } from '@pixi/react';
import { Container, Sprite } from 'pixi.js';
import { useCallback, useEffect, useRef } from 'react';
import { useMapStore } from '../../stores/useMapStore';
import { getTerrainTexture, areTexturesReady } from '../../hex/textures';
import { createGrid, GameHex } from '../../hex/grid';
import type { TerrainType } from '@hex-crawl/shared';
import { hexKey } from '@hex-crawl/shared';

/**
 * Sprite-based hex terrain rendering layer with viewport culling.
 *
 * Renders each hex as a positioned Sprite using pre-generated terrain textures.
 * Implements viewport culling: only creates/shows sprites for hexes visible
 * in the current viewport bounds (plus 1-hex padding).
 *
 * IMPORTANT: Uses Sprites, NOT Graphics.drawPolygon (PITFALL 1 from RESEARCH.md).
 * Graphics breaks GPU batching and causes frame drops at 500+ hexes.
 */
export function TerrainLayer() {
  const containerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Map<string, Sprite>>(new Map());
  const gridRef = useRef<ReturnType<typeof createGrid> | null>(null);
  const lastBoundsRef = useRef({ left: 0, right: 0, top: 0, bottom: 0 });

  // Read store data
  const hexes = useMapStore((s) => s.hexes);
  const gridWidth = useMapStore((s) => s.gridWidth);
  const gridHeight = useMapStore((s) => s.gridHeight);

  // Create the honeycomb-grid once when dimensions change (Anti-Pattern: don't recreate per render)
  useEffect(() => {
    if (gridWidth > 0 && gridHeight > 0) {
      gridRef.current = createGrid(gridWidth, gridHeight);
    }
  }, [gridWidth, gridHeight]);

  // Build/update sprites when hex data or grid changes
  useEffect(() => {
    const container = containerRef.current;
    const grid = gridRef.current;
    if (!container || !grid || !areTexturesReady() || hexes.size === 0) return;

    // Clear existing sprites
    const oldSprites = spritesRef.current;
    oldSprites.forEach((sprite) => {
      container.removeChild(sprite);
      sprite.destroy();
    });
    oldSprites.clear();

    // Create a sprite for each hex in the grid
    grid.forEach((hex: GameHex) => {
      const key = hexKey(hex.q, hex.r);
      const hexData = hexes.get(key);
      if (!hexData) return;

      const texture = getTerrainTexture(
        hexData.terrain as TerrainType,
        hexData.terrainVariant,
      );
      const sprite = new Sprite(texture);

      // Position sprite at the hex's top-left corner.
      // Despite origin: 'topLeft', hex.x/hex.y returns the hex CENTER,
      // so we subtract half width/height to get the bounding-box top-left.
      sprite.position.set(hex.x - hex.width / 2, hex.y - hex.height / 2);
      sprite.anchor.set(0, 0);

      // Start invisible; viewport culling will show visible ones
      sprite.visible = false;

      container.addChild(sprite);
      oldSprites.set(key, sprite);
    });

    // Force an initial culling pass
    lastBoundsRef.current = { left: -1, right: -1, top: -1, bottom: -1 };
  }, [hexes, gridWidth, gridHeight]);

  // Viewport culling callback: show/hide sprites based on viewport bounds
  const cullSprites = useCallback(() => {
    const container = containerRef.current;
    if (!container || !container.parent) return;

    // Get the viewport (parent of the container)
    const viewport = container.parent as unknown as {
      left: number;
      right: number;
      top: number;
      bottom: number;
      scale: { x: number; y: number };
    };

    // Check if viewport bounds have significantly changed
    const bounds = {
      left: viewport.left,
      right: viewport.right,
      top: viewport.top,
      bottom: viewport.bottom,
    };

    const last = lastBoundsRef.current;
    const threshold = 10; // pixels threshold to avoid excessive recalculation
    if (
      Math.abs(bounds.left - last.left) < threshold &&
      Math.abs(bounds.right - last.right) < threshold &&
      Math.abs(bounds.top - last.top) < threshold &&
      Math.abs(bounds.bottom - last.bottom) < threshold
    ) {
      return;
    }
    lastBoundsRef.current = bounds;

    // Add padding (one hex worth of pixels) for smooth scrolling
    const pad = 100;
    const visLeft = bounds.left - pad;
    const visRight = bounds.right + pad;
    const visTop = bounds.top - pad;
    const visBottom = bounds.bottom + pad;

    // Update visibility of all sprites
    const sprites = spritesRef.current;
    sprites.forEach((sprite) => {
      const sx = sprite.x;
      const sy = sprite.y;
      sprite.visible =
        sx + sprite.width > visLeft &&
        sx < visRight &&
        sy + sprite.height > visTop &&
        sy < visBottom;
    });
  }, []);

  // Use tick to perform viewport culling each frame
  useTick(cullSprites);

  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}
