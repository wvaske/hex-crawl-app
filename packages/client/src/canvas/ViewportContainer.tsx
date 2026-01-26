import { useApplication } from '@pixi/react';
import { type Viewport } from 'pixi-viewport';
import { useCallback, useRef, type ReactNode } from 'react';
import { setViewportRef } from './ViewportContext';

interface ViewportContainerProps {
  worldWidth: number;
  worldHeight: number;
  children?: ReactNode;
}

/**
 * Wrapper around pixi-viewport's Viewport, registered via extend() as <viewport>.
 * Provides drag-to-pan, scroll-wheel zoom, pinch-to-zoom, and decelerate.
 *
 * Shares the viewport instance via setViewportRef() so sibling components
 * (HexInteraction, HighlightLayer, UIOverlayLayer) can access it.
 *
 * CRITICAL: passes events={app.renderer.events} (PITFALL 3 from RESEARCH.md).
 * Without this, no mouse/touch events will work on the viewport.
 */
export function ViewportContainer({
  worldWidth,
  worldHeight,
  children,
}: ViewportContainerProps) {
  const { app } = useApplication();
  const viewportConfigured = useRef(false);

  const viewportRef = useCallback(
    (vp: Viewport | null) => {
      // Share viewport with other components via module-level ref
      setViewportRef(vp);

      if (!vp || viewportConfigured.current) return;

      // Configure viewport interaction plugins
      vp
        .drag()
        .pinch()
        .wheel({ smooth: 5 })
        .decelerate({ friction: 0.93 })
        .clampZoom({ minScale: 0.25, maxScale: 4.0 });

      viewportConfigured.current = true;
    },
    [],
  );

  return (
    <viewport
      ref={viewportRef}
      screenWidth={app.screen.width}
      screenHeight={app.screen.height}
      worldWidth={worldWidth}
      worldHeight={worldHeight}
      events={app.renderer.events}
    >
      {children}
    </viewport>
  );
}
