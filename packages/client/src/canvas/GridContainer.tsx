import { Container } from 'pixi.js';
import { useEffect, useRef, type ReactNode } from 'react';
import { useImageLayerStore } from '../stores/useImageLayerStore';

/**
 * Wrapper container that applies grid offset and hex size scaling
 * from alignment settings. All grid-based layers (terrain, grid lines,
 * fog, tokens, highlights, UI overlay) sit inside this container so
 * they move together when the DM adjusts alignment.
 *
 * ImageLayer stays OUTSIDE this container since images are fixed
 * and the grid moves over them.
 */
export function GridContainer({ children }: { children: ReactNode }) {
  const containerRef = useRef<Container | null>(null);

  const gridOffsetX = useImageLayerStore((s) => s.gridSettings.gridOffsetX);
  const gridOffsetY = useImageLayerStore((s) => s.gridSettings.gridOffsetY);
  const hexSizeX = useImageLayerStore((s) => s.gridSettings.hexSizeX);
  const hexSizeY = useImageLayerStore((s) => s.gridSettings.hexSizeY);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const defaultSize = 40; // GameHex circumradius
    container.position.set(gridOffsetX, gridOffsetY);
    container.scale.set(hexSizeX / defaultSize, hexSizeY / defaultSize);
  }, [gridOffsetX, gridOffsetY, hexSizeX, hexSizeY]);

  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    >
      {children}
    </pixiContainer>
  );
}
