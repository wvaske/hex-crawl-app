import type { Viewport } from 'pixi-viewport';

/**
 * Module-level viewport reference shared between canvas components.
 * Set by ViewportContainer when the viewport is created.
 * Read by HexInteraction, HighlightLayer, and UIOverlayLayer.
 *
 * This uses a module-level variable instead of React context because
 * the PixiJS render tree (@pixi/react) uses a custom reconciler that
 * doesn't support standard React context providers as children.
 */
let viewportInstance: Viewport | null = null;
const listeners: Array<(vp: Viewport | null) => void> = [];

/** Set the viewport instance (called by ViewportContainer) */
export function setViewportRef(vp: Viewport | null): void {
  viewportInstance = vp;
  for (const listener of listeners) {
    listener(vp);
  }
}

/** Get the current viewport instance */
export function getViewportRef(): Viewport | null {
  return viewportInstance;
}

/** Subscribe to viewport changes (returns unsubscribe function) */
export function onViewportChange(
  listener: (vp: Viewport | null) => void,
): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
