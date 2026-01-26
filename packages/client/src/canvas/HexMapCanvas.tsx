import { Application, extend, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { generateTerrainTextures, areTexturesReady } from '../hex/textures';
import { ViewportContainer } from './ViewportContainer';
import { useMapStore } from '../stores/useMapStore';

// Register PixiJS components for JSX use (Pattern 6 from RESEARCH.md)
// Also register pixi-viewport's Viewport as a custom component
extend({ Container, Sprite, Graphics, Text, Viewport });

interface HexMapCanvasProps {
  /** Layer children to render inside the viewport */
  children?: ReactNode;
}

/**
 * Inner content rendered inside the @pixi/react Application.
 * Uses useApplication() to access the app instance for viewport setup.
 * Initializes terrain textures on mount.
 */
function HexMapContent({ children }: HexMapCanvasProps) {
  const { app } = useApplication();
  const [texturesReady, setTexturesReady] = useState(areTexturesReady());
  const gridWidth = useMapStore((s) => s.gridWidth);
  const gridHeight = useMapStore((s) => s.gridHeight);
  const hexSize = useMapStore((s) => s.hexSize);

  useEffect(() => {
    if (!texturesReady) {
      generateTerrainTextures();
      setTexturesReady(true);
    }
  }, [texturesReady]);

  // Handle resize events from the Application
  useEffect(() => {
    const onResize = () => {
      // Force a re-render to update viewport screen dimensions
      app.renderer.resize(app.screen.width, app.screen.height);
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [app]);

  if (!texturesReady) return null;

  // Calculate world dimensions based on grid size
  // Flat-top hex: horizontal spacing = 3/2 * size, vertical spacing = sqrt(3) * size
  const worldWidth = gridWidth * hexSize * 1.5 + hexSize * 2;
  const worldHeight = gridHeight * Math.sqrt(3) * hexSize + hexSize * 2;

  return (
    <ViewportContainer worldWidth={worldWidth} worldHeight={worldHeight}>
      {children}
    </ViewportContainer>
  );
}

/**
 * @pixi/react Application wrapper for the hex map.
 * Renders a full PixiJS canvas with pixi-viewport for pan/zoom navigation.
 *
 * Usage:
 *   <HexMapCanvas>
 *     <TerrainLayer />
 *     <GridLineLayer />
 *   </HexMapCanvas>
 */
export function HexMapCanvas({ children }: HexMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="w-full h-full">
      <Application
        resizeTo={containerRef}
        background={0x1a1a2e}
        antialias
      >
        <HexMapContent>{children}</HexMapContent>
      </Application>
    </div>
  );
}
