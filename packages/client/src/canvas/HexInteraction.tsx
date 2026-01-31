import { useTick } from '@pixi/react';
import { useCallback, useEffect, useRef } from 'react';
import { Container } from 'pixi.js';
import { hexKey, parseHexKey } from '@hex-crawl/shared';
import { pixelToHex, axialToOffset, offsetToAxial } from '../hex/coordinates';
import { useMapStore } from '../stores/useMapStore';
import { useUIStore } from '../stores/useUIStore';
import { useTokenStore } from '../stores/useTokenStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useImageLayerStore } from '../stores/useImageLayerStore';
import { getViewportRef } from './ViewportContext';

/** Maximum pixel movement to still count as a "click" (not a drag) */
const CLICK_THRESHOLD = 5;

/** Minimum shift+drag distance to start area selection */
const DRAG_SELECT_THRESHOLD = 8;

/** Animation duration for token move (ms) */
const TOKEN_MOVE_DURATION = 200;

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
 * Get the 6 axial neighbors of a hex.
 */
function getNeighborKeys(hexKeyStr: string): string[] {
  const { q, r } = parseHexKey(hexKeyStr);
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1],
  ];
  return directions.map(([dq, dr]) => hexKey(q + dq!, r + dr!));
}

/**
 * Ease-out quad: t * (2 - t)
 */
function easeOutQuad(t: number): number {
  return t * (2 - t);
}

/**
 * Find all hex keys whose polygon touches the given world-space rectangle.
 * Expands rect by the hex inradius (apothem) so edge-touching hexes are included.
 */
function hexesInRect(
  minX: number, maxX: number, minY: number, maxY: number,
  grid: { w: number; h: number },
): string[] {
  const hexSize = useMapStore.getState().hexSize;
  // Expand by circumradius (full hex size) so any hex whose polygon touches the rect is included
  const eMinX = minX - hexSize;
  const eMaxX = maxX + hexSize;
  const eMinY = minY - hexSize;
  const eMaxY = maxY + hexSize;
  const keys: string[] = [];
  for (let col = 0; col < grid.w; col++) {
    for (let row = 0; row < grid.h; row++) {
      const { q, r } = offsetToAxial(col, row);
      const center = hexCenterWorld(q, r, hexSize);
      if (center.x >= eMinX && center.x <= eMaxX && center.y >= eMinY && center.y <= eMaxY) {
        keys.push(hexKey(q, r));
      }
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Module-level map for token display objects (set by TokenLayer-like code)
// Token drag needs to move display objects directly during drag.
// We store references keyed by tokenId.
// ---------------------------------------------------------------------------

const tokenDisplayMap = new Map<string, Container>();

/** Register a token display object for drag interaction */
export function registerTokenDisplay(tokenId: string, container: Container): void {
  tokenDisplayMap.set(tokenId, container);
}

/** Unregister a token display object */
export function unregisterTokenDisplay(tokenId: string): void {
  tokenDisplayMap.delete(tokenId);
}

// ---------------------------------------------------------------------------
// Pending token move animations (for remote moves and snap-back)
// ---------------------------------------------------------------------------

interface TokenAnimation {
  tokenId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startTime: number;
  duration: number;
}

const activeAnimations: TokenAnimation[] = [];

/** Queue a smooth token animation */
export function animateTokenMove(
  tokenId: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  duration: number = TOKEN_MOVE_DURATION,
): void {
  // Remove any existing animation for this token
  const idx = activeAnimations.findIndex((a) => a.tokenId === tokenId);
  if (idx >= 0) activeAnimations.splice(idx, 1);

  activeAnimations.push({
    tokenId,
    fromX,
    fromY,
    toX,
    toY,
    startTime: performance.now(),
    duration,
  });
}

// Tokens currently being dragged (prevent double-drag)
const pendingMoves = new Set<string>();

/**
 * Non-visual component that handles all mouse interaction with the hex canvas.
 *
 * Responsibilities:
 * - Hover detection: converts mouse position to hex coordinates, updates hoveredHex
 * - Click selection: single click selects hex, shift-click toggles multi-select
 * - Click vs drag distinction: only triggers selection if pointer moved < 5px
 * - Shift+drag area selection: selects all hexes within the drag rectangle
 * - Token drag: pointerdown hit-tests tokens, pointermove follows cursor, pointerup validates and sends WS
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

  // Token drag state
  const tokenDragRef = useRef<{
    tokenId: string;
    startHexKey: string;
    startWorldX: number;
    startWorldY: number;
    originalContainerX: number;
    originalContainerY: number;
  } | null>(null);

  // Read grid dimensions for bounds checking (allows interacting with empty hexes)
  const gridWidth = useMapStore((s) => s.gridWidth);
  const gridHeight = useMapStore((s) => s.gridHeight);
  const gridRef = useRef({ w: gridWidth, h: gridHeight });
  gridRef.current = { w: gridWidth, h: gridHeight };

  /** Check whether axial coords fall within the grid (converts to offset for bounds check) */
  const isInBounds = (q: number, r: number) => {
    const { col, row } = axialToOffset(q, r);
    return col >= 0 && col < gridRef.current.w && row >= 0 && row < gridRef.current.h;
  };

  // Pending world position for throttled hover updates
  const pendingWorldPos = useRef<{ x: number; y: number } | null>(null);

  /** Throttled hover update running each tick (~60fps, but only processes ~30fps) */
  const updateHover = useCallback(() => {
    const pos = pendingWorldPos.current;
    if (!pos) {
      // Process animations even when no pending hover
      processAnimations();
      return;
    }

    // Throttle to ~30fps (every ~33ms)
    const now = performance.now();
    if (now - lastMoveTimeRef.current < 33) {
      processAnimations();
      return;
    }
    lastMoveTimeRef.current = now;

    const { q, r } = pixelToHex(pos.x, pos.y);
    const key = hexKey(q, r);

    // Only update store if the hovered hex changed
    if (key !== lastHoveredRef.current) {
      if (isInBounds(q, r)) {
        lastHoveredRef.current = key;
        useUIStore.getState().setHoveredHex(key);
      } else if (lastHoveredRef.current !== null) {
        lastHoveredRef.current = null;
        useUIStore.getState().setHoveredHex(null);
      }
    }

    pendingWorldPos.current = null;
    processAnimations();
  }, []);

  useTick(updateHover);

  // Attach viewport event listeners
  useEffect(() => {
    const viewport = getViewportRef();
    if (!viewport) return;

    const htmlCanvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!htmlCanvas) return;

    const onPointerMove = (e: PointerEvent) => {
      // Skip all hex interaction during alignment mode
      if (useImageLayerStore.getState().alignmentMode) return;

      const screen = eventToScreen(e, htmlCanvas);
      const worldPos = viewport.toWorld(screen.x, screen.y);
      pendingWorldPos.current = { x: worldPos.x, y: worldPos.y };

      // Handle token drag move
      const tokenDrag = tokenDragRef.current;
      if (tokenDrag) {
        const container = tokenDisplayMap.get(tokenDrag.tokenId);
        if (container && container.parent) {
          // Move the display object to follow cursor in world coords
          // The container is a child of a hex-group container positioned at hex center.
          // We need to set it in world-space by adjusting parent-relative coords.
          const parentWorldTransform = container.parent.worldTransform;
          // Compute local coords from world coords
          const localX = (worldPos.x - parentWorldTransform.tx) / parentWorldTransform.a;
          const localY = (worldPos.y - parentWorldTransform.ty) / parentWorldTransform.d;
          container.x = localX;
          container.y = localY;
        }
        return;
      }

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
        // Update live drag rectangle for preview
        useUIStore.getState().setDragRect({
          minX: Math.min(down.worldX, worldPos.x),
          maxX: Math.max(down.worldX, worldPos.x),
          minY: Math.min(down.worldY, worldPos.y),
          maxY: Math.max(down.worldY, worldPos.y),
        });
      } else if (!down.shiftKey && dist > CLICK_THRESHOLD) {
        isDraggingRef.current = true;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) return;

      // Skip all hex interaction during alignment mode
      if (useImageLayerStore.getState().alignmentMode) return;

      const screen = eventToScreen(e, htmlCanvas);
      const worldPos = viewport.toWorld(screen.x, screen.y);

      // --- Token hit-testing ---
      const hexSize = useMapStore.getState().hexSize;
      const tokens = useTokenStore.getState().tokens;
      const userRole = useSessionStore.getState().userRole;
      const userId = useSessionStore.getState().userId;

      // Collect all tokens with their world positions for hit-testing
      type TokenHit = { tokenId: string; dist: number };
      const hits: TokenHit[] = [];

      for (const [tokenId, token] of tokens) {
        if (pendingMoves.has(tokenId)) continue; // Skip tokens mid-move
        const { q, r } = parseHexKey(token.hexKey);
        const center = hexCenterWorld(q, r, hexSize);
        // TODO: account for layout offset when multiple tokens share a hex
        const dx = worldPos.x - center.x;
        const dy = worldPos.y - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitRadius = hexSize * 0.35; // Same as token visual radius
        if (dist <= hitRadius) {
          hits.push({ tokenId, dist });
        }
      }

      // Sort by distance (closest first)
      hits.sort((a, b) => a.dist - b.dist);

      if (hits.length > 0) {
        const hit = hits[0]!;
        const token = tokens.get(hit.tokenId)!;

        // Permission check
        const canDrag =
          userRole === 'dm' || (userRole === 'player' && token.ownerId === userId);

        if (canDrag) {
          // Start token drag
          const container = tokenDisplayMap.get(hit.tokenId);
          tokenDragRef.current = {
            tokenId: hit.tokenId,
            startHexKey: token.hexKey,
            startWorldX: worldPos.x,
            startWorldY: worldPos.y,
            originalContainerX: container?.x ?? 0,
            originalContainerY: container?.y ?? 0,
          };

          // Pause viewport drag to prevent panning
          viewport.plugins.pause('drag');

          // Set pointer down but skip hex selection
          pointerDownRef.current = {
            screenX: e.clientX,
            screenY: e.clientY,
            worldX: worldPos.x,
            worldY: worldPos.y,
            shiftKey: e.shiftKey,
          };
          isDraggingRef.current = false;
          dragSelectRef.current = null;
          return;
        }
        // If not permitted, fall through to normal hex interaction
      }

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

      // Skip all hex interaction during alignment mode
      if (useImageLayerStore.getState().alignmentMode) return;

      const down = pointerDownRef.current;

      // --- Token drag release ---
      const tokenDrag = tokenDragRef.current;
      if (tokenDrag) {
        const screen = eventToScreen(e, htmlCanvas);
        const worldPos = viewport.toWorld(screen.x, screen.y);
        const { q, r } = pixelToHex(worldPos.x, worldPos.y);
        const targetKey = hexKey(q, r);

        const hexSize = useMapStore.getState().hexSize;
        const userRole = useSessionStore.getState().userRole;
        const sendMessage = useSessionStore.getState().sendMessage;

        const startCoord = parseHexKey(tokenDrag.startHexKey);
        const startCenter = hexCenterWorld(startCoord.q, startCoord.r, hexSize);

        // Check if same hex (no move)
        if (targetKey === tokenDrag.startHexKey) {
          // Snap back to original position
          const container = tokenDisplayMap.get(tokenDrag.tokenId);
          if (container) {
            animateTokenMove(
              tokenDrag.tokenId,
              container.x,
              container.y,
              tokenDrag.originalContainerX,
              tokenDrag.originalContainerY,
            );
          }
        } else {
          // Validate: players can only move to adjacent hex
          const neighbors = getNeighborKeys(tokenDrag.startHexKey);
          const isAdjacent = neighbors.includes(targetKey);
          const isValid = userRole === 'dm' || isAdjacent;

          if (isValid && sendMessage) {
            // Optimistic move: animate to target hex center
            const targetCoord = parseHexKey(targetKey);
            const targetCenter = hexCenterWorld(targetCoord.q, targetCoord.r, hexSize);

            const container = tokenDisplayMap.get(tokenDrag.tokenId);
            if (container && container.parent) {
              const parentWorldTransform = container.parent.worldTransform;
              const toLocalX = (targetCenter.x - parentWorldTransform.tx) / parentWorldTransform.a;
              const toLocalY = (targetCenter.y - parentWorldTransform.ty) / parentWorldTransform.d;
              animateTokenMove(
                tokenDrag.tokenId,
                container.x,
                container.y,
                toLocalX,
                toLocalY,
              );
            }

            // Mark as pending and send move message
            pendingMoves.add(tokenDrag.tokenId);
            sendMessage({
              type: 'token:move',
              tokenId: tokenDrag.tokenId,
              toHexKey: targetKey,
            });

            // Optimistically update store
            useTokenStore.getState().moveToken(tokenDrag.tokenId, targetKey);

            // Clear pending after a timeout (server response should clear it via token:moved)
            setTimeout(() => pendingMoves.delete(tokenDrag.tokenId), 3000);
          } else {
            // Invalid move: snap back
            const container = tokenDisplayMap.get(tokenDrag.tokenId);
            if (container) {
              animateTokenMove(
                tokenDrag.tokenId,
                container.x,
                container.y,
                tokenDrag.originalContainerX,
                tokenDrag.originalContainerY,
              );
            }
          }
        }

        // Resume viewport drag and clear token drag state
        viewport.plugins.resume('drag');
        tokenDragRef.current = null;
        pointerDownRef.current = null;
        isDraggingRef.current = false;
        dragSelectRef.current = null;
        return;
      }

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

        const keysToSelect = hexesInRect(minX, maxX, minY, maxY, gridRef.current);

        // Replace selection with newly selected hexes
        useUIStore.getState().clearSelection();
        for (const key of keysToSelect) {
          useUIStore.getState().toggleSelectHex(key);
        }

        useUIStore.getState().setDragRect(null);
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
        if (isInBounds(q, r)) {
          if (e.shiftKey) {
            useUIStore.getState().toggleSelectHex(key);
          } else {
            useUIStore.getState().selectHex(key);
          }
        } else {
          // Clicked outside grid bounds -- clear selection
          useUIStore.getState().clearSelection();
        }
      }

      useUIStore.getState().setDragRect(null);
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
  }, [gridWidth, gridHeight]);

  // Non-visual component: renders an empty container
  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Animation processor (called each tick)
// ---------------------------------------------------------------------------

function processAnimations(): void {
  const now = performance.now();
  const toRemove: number[] = [];

  for (let i = 0; i < activeAnimations.length; i++) {
    const anim = activeAnimations[i]!;
    const elapsed = now - anim.startTime;
    const t = Math.min(elapsed / anim.duration, 1);
    const eased = easeOutQuad(t);

    const container = tokenDisplayMap.get(anim.tokenId);
    if (container) {
      container.x = anim.fromX + (anim.toX - anim.fromX) * eased;
      container.y = anim.fromY + (anim.toY - anim.fromY) * eased;
    }

    if (t >= 1) {
      toRemove.push(i);
    }
  }

  // Remove completed animations in reverse order
  for (let i = toRemove.length - 1; i >= 0; i--) {
    activeAnimations.splice(toRemove[i]!, 1);
  }
}

/** Clear pending move for a token (called when server confirms) */
export function clearPendingMove(tokenId: string): void {
  pendingMoves.delete(tokenId);
}
