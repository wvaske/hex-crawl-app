import { useTick } from '@pixi/react';
import { useCallback, useEffect, useRef } from 'react';
import { Container } from 'pixi.js';
import { hexKey } from '@hex-crawl/shared';
import { pixelToHex } from '../hex/coordinates';
import { useMapStore } from '../stores/useMapStore';
import { useUIStore } from '../stores/useUIStore';
import { getViewportRef } from './ViewportContext';

/** Maximum pixel movement to still count as a "click" (not a drag) */
const CLICK_THRESHOLD = 5;

/** Minimum shift+drag distance to start area selection */
const DRAG_SELECT_THRESHOLD = 8;

/**
 * Convert a browser pointer event's coordinates to viewport screen coordinates.
 * Accounts for the canvas element's position in the page.
 */
function eventToScreen(
  e: PointerEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

/**
 * Compute the approximate world-space center of a hex from its axial coords.
 * Uses flat-top hex math: x = size * 3/2 * q, y = size * sqrt(3) * (r + q/2)
 * This matches honeycomb-grid's output for flat-top hexes.
 */
function hexCenterWorld(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * (3 / 2) * q,
    y: size * Math.sqrt(3) * (r + q / 2),
  };
}

/**
 * Non-visual component that handles all mouse interaction with the hex canvas.
 *
 * Responsibilities:
 * - Hover detection: converts mouse position to hex coordinates, updates hoveredHex
 * - Click selection: single click selects hex, shift-click toggles multi-select
 * - Click vs drag distinction: only triggers selection if pointer moved < 5px
 * - Shift+drag area selection: selects all hexes within the drag rectangle
 *
 * Lives inside the @pixi/react tree. Accesses the viewport via module-level ref.
 * Attaches pointer event listeners to the HTML canvas element.
 */
export function HexInteraction() {
  const containerRef = useRef<Container | null>(null);
  const lastHoveredRef = useRef<string | null>(null);
  const pointerDownRef = useRef<{
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
    shiftKey: boolean;
  } | null>(null);
  const isDraggingRef = useRef(false);
  const dragSelectRef = useRef<{
    startWorldX: number;
    startWorldY: number;
  } | null>(null);
  const lastMoveTimeRef = useRef(0);

  // Read the hexes map to validate hex existence during hover/click
  const hexes = useMapStore((s) => s.hexes);
  const hexesRef = useRef(hexes);
  hexesRef.current = hexes;

  // Pending world position for throttled hover updates
  const pendingWorldPos = useRef<{ x: number; y: number } | null>(null);

  /** Throttled hover update running each tick (~60fps, but only processes ~30fps) */
  const updateHover = useCallback(() => {
    const pos = pendingWorldPos.current;
    if (!pos) return;

    // Throttle to ~30fps (every ~33ms)
    const now = performance.now();
    if (now - lastMoveTimeRef.current < 33) return;
    lastMoveTimeRef.current = now;

    const { q, r } = pixelToHex(pos.x, pos.y);
    const key = hexKey(q, r);

    // Only update store if the hovered hex changed
    if (key !== lastHoveredRef.current) {
      const exists = hexesRef.current.has(key);
      if (exists) {
        lastHoveredRef.current = key;
        useUIStore.getState().setHoveredHex(key);
      } else if (lastHoveredRef.current !== null) {
        lastHoveredRef.current = null;
        useUIStore.getState().setHoveredHex(null);
      }
    }

    pendingWorldPos.current = null;
  }, []);

  useTick(updateHover);

  // Attach viewport event listeners
  useEffect(() => {
    const viewport = getViewportRef();
    if (!viewport) return;

    const htmlCanvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!htmlCanvas) return;

    const onPointerMove = (e: PointerEvent) => {
      const screen = eventToScreen(e, htmlCanvas);
      const worldPos = viewport.toWorld(screen.x, screen.y);
      pendingWorldPos.current = { x: worldPos.x, y: worldPos.y };

      // Track drag state
      const down = pointerDownRef.current;
      if (!down) return;

      const dx = e.clientX - down.screenX;
      const dy = e.clientY - down.screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (down.shiftKey && dist > DRAG_SELECT_THRESHOLD) {
        isDraggingRef.current = true;
        dragSelectRef.current = {
          startWorldX: down.worldX,
          startWorldY: down.worldY,
        };
      } else if (!down.shiftKey && dist > CLICK_THRESHOLD) {
        isDraggingRef.current = true;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) return;

      const screen = eventToScreen(e, htmlCanvas);
      const worldPos = viewport.toWorld(screen.x, screen.y);

      pointerDownRef.current = {
        screenX: e.clientX,
        screenY: e.clientY,
        worldX: worldPos.x,
        worldY: worldPos.y,
        shiftKey: e.shiftKey,
      };
      isDraggingRef.current = false;
      dragSelectRef.current = null;

      // If shift is held, pause viewport dragging to allow area select
      if (e.shiftKey) {
        viewport.plugins.pause('drag');
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;

      const down = pointerDownRef.current;

      // Re-enable viewport drag if we paused it
      if (down?.shiftKey) {
        viewport.plugins.resume('drag');
      }

      if (!down) {
        pointerDownRef.current = null;
        isDraggingRef.current = false;
        dragSelectRef.current = null;
        return;
      }

      // Handle shift+drag area selection
      if (isDraggingRef.current && dragSelectRef.current && down.shiftKey) {
        const screen = eventToScreen(e, htmlCanvas);
        const endWorld = viewport.toWorld(screen.x, screen.y);

        const minX = Math.min(dragSelectRef.current.startWorldX, endWorld.x);
        const maxX = Math.max(dragSelectRef.current.startWorldX, endWorld.x);
        const minY = Math.min(dragSelectRef.current.startWorldY, endWorld.y);
        const maxY = Math.max(dragSelectRef.current.startWorldY, endWorld.y);

        const currentHexes = hexesRef.current;
        const hexSize = useMapStore.getState().hexSize;
        const keysToSelect: string[] = [];

        // Find all hexes whose center falls within the drag rectangle
        for (const [key] of currentHexes) {
          const parts = key.split(',');
          const q = Number(parts[0]);
          const r = Number(parts[1]);
          const center = hexCenterWorld(q, r, hexSize);

          if (
            center.x >= minX &&
            center.x <= maxX &&
            center.y >= minY &&
            center.y <= maxY
          ) {
            keysToSelect.push(key);
          }
        }

        // Add all found hexes to selection
        const store = useUIStore.getState();
        for (const key of keysToSelect) {
          if (!store.selectedHexes.has(key)) {
            store.toggleSelectHex(key);
            // Re-read store since toggleSelectHex creates new Set
          }
        }

        pointerDownRef.current = null;
        isDraggingRef.current = false;
        dragSelectRef.current = null;
        return;
      }

      // Handle click (not a drag)
      if (!isDraggingRef.current) {
        const screen = eventToScreen(e, htmlCanvas);
        const worldPos = viewport.toWorld(screen.x, screen.y);
        const { q, r } = pixelToHex(worldPos.x, worldPos.y);
        const key = hexKey(q, r);
        const exists = hexesRef.current.has(key);

        if (exists) {
          if (e.shiftKey) {
            useUIStore.getState().toggleSelectHex(key);
          } else {
            useUIStore.getState().selectHex(key);
          }
        } else {
          // Clicked empty space -- clear selection
          useUIStore.getState().clearSelection();
        }
      }

      pointerDownRef.current = null;
      isDraggingRef.current = false;
      dragSelectRef.current = null;
    };

    htmlCanvas.addEventListener('pointermove', onPointerMove);
    htmlCanvas.addEventListener('pointerdown', onPointerDown);
    htmlCanvas.addEventListener('pointerup', onPointerUp);

    return () => {
      htmlCanvas.removeEventListener('pointermove', onPointerMove);
      htmlCanvas.removeEventListener('pointerdown', onPointerDown);
      htmlCanvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [hexes]);

  // Non-visual component: renders an empty container
  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}
