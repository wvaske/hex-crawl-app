import type { Viewport } from 'pixi-viewport';
import type { PixiReactElementProps } from '@pixi/react';

// Augment @pixi/react's PixiElements to include pixi-viewport's Viewport
// This enables <viewport> and <pixiViewport> JSX elements
declare module '@pixi/react' {
  interface PixiElements {
    viewport: PixiReactElementProps<typeof Viewport>;
    pixiViewport: PixiReactElementProps<typeof Viewport>;
  }
}
