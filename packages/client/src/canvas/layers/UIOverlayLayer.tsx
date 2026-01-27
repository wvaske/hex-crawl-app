import { useTick } from '@pixi/react';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { useCallback, useEffect, useRef } from 'react';
import { parseHexKey } from '@hex-crawl/shared';
import { useUIStore } from '../../stores/useUIStore';
import { useMapStore } from '../../stores/useMapStore';
import { createGrid, GameHex } from '../../hex/grid';

/** Text style for coordinate display */
const COORD_TEXT_STYLE = new TextStyle({
  fontFamily: 'monospace',
  fontSize: 12,
  fill: 0xffffff,
  align: 'center',
});

/** Background padding around the coordinate text */
const BG_PADDING_X = 6;
const BG_PADDING_Y = 3;
const BG_COLOR = 0x000000;
const BG_ALPHA = 0.55;
const BG_RADIUS = 4;

/**
 * Renders coordinate text overlay on the currently hovered hex.
 *
 * Shows "q: {q}, r: {r}" as white monospace text with a dark
 * semi-transparent background for readability. Positioned at
 * the center of the hovered hex.
 *
 * Only shows on hover (CONTEXT.md decision: "Coordinates shown on hover only").
 * Sits at z-index 3 (topmost layer).
 */
export function UIOverlayLayer() {
  const containerRef = useRef<Container | null>(null);
  const textRef = useRef<Text | null>(null);
  const bgRef = useRef<Graphics | null>(null);
  const gridRef = useRef<ReturnType<typeof createGrid> | null>(null);
  const lastHoveredRef = useRef<string | null>(null);

  const hoveredHex = useUIStore((s) => s.hoveredHex);
  const gridWidth = useMapStore((s) => s.gridWidth);
  const gridHeight = useMapStore((s) => s.gridHeight);

  const hoveredHexRef = useRef(hoveredHex);
  hoveredHexRef.current = hoveredHex;

  // Create grid for hex position lookup
  useEffect(() => {
    if (gridWidth > 0 && gridHeight > 0) {
      gridRef.current = createGrid(gridWidth, gridHeight);
    }
  }, [gridWidth, gridHeight]);

  // Create Text and background Graphics imperatively
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const bg = new Graphics();
    bg.visible = false;
    bgRef.current = bg;
    container.addChild(bg);

    const text = new Text({ text: '', style: COORD_TEXT_STYLE });
    text.anchor.set(0.5, 0.5);
    text.visible = false;
    textRef.current = text;
    container.addChild(text);

    return () => {
      container.removeChild(bg);
      container.removeChild(text);
      bg.destroy();
      text.destroy();
      bgRef.current = null;
      textRef.current = null;
    };
  }, []);

  /** Update coordinate overlay position and text on each tick */
  const updateOverlay = useCallback(() => {
    const text = textRef.current;
    const bg = bgRef.current;
    const grid = gridRef.current;
    if (!text || !bg || !grid) return;

    const hovered = hoveredHexRef.current;

    // No change -- skip
    if (hovered === lastHoveredRef.current) return;
    lastHoveredRef.current = hovered;

    if (!hovered) {
      text.visible = false;
      bg.visible = false;
      return;
    }

    const coord = parseHexKey(hovered);

    // Find the hex in the grid to get its pixel position
    let targetHex: GameHex | null = null;
    grid.forEach((hex: GameHex) => {
      if (hex.q === coord.q && hex.r === coord.r) {
        targetHex = hex;
      }
    });

    if (!targetHex) {
      text.visible = false;
      bg.visible = false;
      return;
    }

    const hex = targetHex as GameHex;

    // Position at hex center (hex.x/hex.y IS the center despite origin: 'topLeft')
    const cx = hex.x;
    const cy = hex.y;

    // Update text content and position
    text.text = `q: ${coord.q}, r: ${coord.r}`;
    text.position.set(cx, cy);
    text.visible = true;

    // Draw background rectangle behind text
    bg.clear();
    const tw = text.width + BG_PADDING_X * 2;
    const th = text.height + BG_PADDING_Y * 2;
    bg.roundRect(cx - tw / 2, cy - th / 2, tw, th, BG_RADIUS);
    bg.fill({ color: BG_COLOR, alpha: BG_ALPHA });
    bg.visible = true;
  }, []);

  useTick(updateOverlay);

  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}
