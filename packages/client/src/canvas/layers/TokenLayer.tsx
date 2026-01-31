import { Container } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { parseHexKey } from '@hex-crawl/shared';
import type { Token } from '@hex-crawl/shared';
import { useTokenStore } from '../../stores/useTokenStore';
import { useMapStore } from '../../stores/useMapStore';
import { useSessionStore } from '../../stores/useSessionStore';
import {
  createTokenDisplayObject,
  layoutTokensInHex,
  updateTokenDisplayObject,
} from '../TokenSprite';
import { registerTokenDisplay, unregisterTokenDisplay } from '../HexInteraction';

/**
 * Compute the world-space center of a hex from axial coords.
 * Flat-top hex math matching HexInteraction / HighlightLayer.
 */
function hexCenterWorld(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * (3 / 2) * q,
    y: size * Math.sqrt(3) * (r + q / 2),
  };
}

/**
 * Imperative PixiJS token rendering layer.
 *
 * Subscribes to useTokenStore and renders each token as a display object
 * positioned at its hex center. Multiple tokens sharing a hex use
 * shrink-and-arrange layout. Hidden tokens are filtered for players.
 *
 * Z-order: sits between FogLayer and HighlightLayer in the viewport.
 */
export function TokenLayer() {
  const containerRef = useRef<Container | null>(null);
  const tokenDisplaysRef = useRef<Map<string, Container>>(new Map());

  const tokens = useTokenStore((s) => s.tokens);
  const hexSize = useMapStore((s) => s.hexSize);
  const userRole = useSessionStore((s) => s.userRole);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const displays = tokenDisplaysRef.current;
    const currentTokenIds = new Set<string>();

    // Filter tokens: players don't see hidden tokens
    const visibleTokens: Token[] = [];
    tokens.forEach((token) => {
      if (userRole === 'player' && !token.visible) return;
      visibleTokens.push(token);
    });

    // Group tokens by hexKey
    const byHex = new Map<string, Token[]>();
    for (const token of visibleTokens) {
      currentTokenIds.add(token.id);
      let group = byHex.get(token.hexKey);
      if (!group) {
        group = [];
        byHex.set(token.hexKey, group);
      }
      group.push(token);
    }

    // Remove stale display objects
    displays.forEach((display, id) => {
      if (!currentTokenIds.has(id)) {
        container.removeChild(display);
        display.destroy({ children: true });
        unregisterTokenDisplay(id);
        displays.delete(id);
      }
    });

    // Create/update display objects per hex group
    byHex.forEach((group, hexKeyStr) => {
      const { q, r } = parseHexKey(hexKeyStr);
      const center = hexCenterWorld(q, r, hexSize);
      const layout = layoutTokensInHex(group.length, hexSize);

      for (let i = 0; i < group.length; i++) {
        const token = group[i];
        const pos = layout[i];
        let display = displays.get(token.id);

        if (!display) {
          // Create new display object
          display = createTokenDisplayObject(token, hexSize);
          container.addChild(display);
          displays.set(token.id, display);
          registerTokenDisplay(token.id, display);
        } else {
          // Update existing display object visuals
          updateTokenDisplayObject(display, token, hexSize);
        }

        // Position at hex center + layout offset, apply scale
        display.position.set(center.x + pos.x, center.y + pos.y);
        display.scale.set(pos.scale);
      }
    });
  }, [tokens, hexSize, userRole]);

  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}
