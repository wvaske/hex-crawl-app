import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Token } from '@hex-crawl/shared';

/**
 * Parse a CSS color string (hex like "#ff0000" or named) to a numeric color.
 * Falls back to white (0xffffff) on failure.
 */
function parseColor(color: string): number {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const parsed = parseInt(hex, 16);
    return isNaN(parsed) ? 0xffffff : parsed;
  }
  // Fallback for named colors or other formats
  return 0xffffff;
}

/**
 * Create a PixiJS Container for a token with a colored ring and emoji icon.
 *
 * @param token - Token data from the store
 * @param hexSize - Hex circumradius in pixels (used to scale the token)
 * @returns A Container with Graphics ring + Text icon as children
 */
export function createTokenDisplayObject(
  token: Token,
  hexSize: number,
): Container {
  const container = new Container();
  container.label = `token-${token.id}`;

  const radius = hexSize * 0.35;
  const colorNum = parseColor(token.color);

  // Ring background (filled circle with alpha + solid stroke)
  const ring = new Graphics();
  ring.circle(0, 0, radius);
  ring.fill({ color: colorNum, alpha: 0.25 });
  ring.stroke({ color: colorNum, width: 3 });
  ring.label = 'ring';
  container.addChild(ring);

  // Emoji icon centered in the ring
  const style = new TextStyle({
    fontSize: radius * 1.2,
    fill: 0xffffff,
    align: 'center',
  });
  const text = new Text({ text: token.icon, style });
  text.anchor.set(0.5, 0.5);
  text.label = 'icon';
  container.addChild(text);

  return container;
}

/**
 * Compute layout positions for multiple tokens sharing a single hex.
 *
 * @param count - Number of tokens in the hex
 * @param hexSize - Hex circumradius in pixels
 * @returns Array of { x, y, scale } offsets relative to hex center
 */
export function layoutTokensInHex(
  count: number,
  hexSize: number,
): Array<{ x: number; y: number; scale: number }> {
  if (count <= 0) return [];

  if (count === 1) {
    return [{ x: 0, y: 0, scale: 1 }];
  }

  if (count === 2) {
    const offset = hexSize * 0.22;
    return [
      { x: -offset, y: 0, scale: 0.65 },
      { x: offset, y: 0, scale: 0.65 },
    ];
  }

  // 3+ tokens: circular arrangement
  const scale = Math.max(0.35, 0.65 - (count - 3) * 0.07);
  const ringRadius = hexSize * 0.25;
  const result: Array<{ x: number; y: number; scale: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    result.push({
      x: Math.cos(angle) * ringRadius,
      y: Math.sin(angle) * ringRadius,
      scale,
    });
  }
  return result;
}

/**
 * Update an existing token display object's visual properties.
 *
 * @param container - The Container created by createTokenDisplayObject
 * @param token - Updated token data
 * @param hexSize - Hex circumradius in pixels
 */
export function updateTokenDisplayObject(
  container: Container,
  token: Token,
  hexSize: number,
): void {
  const radius = hexSize * 0.35;
  const colorNum = parseColor(token.color);

  // Update ring
  const ring = container.getChildByLabel('ring') as Graphics | null;
  if (ring) {
    ring.clear();
    ring.circle(0, 0, radius);
    ring.fill({ color: colorNum, alpha: 0.25 });
    ring.stroke({ color: colorNum, width: 3 });
  }

  // Update icon text
  const icon = container.getChildByLabel('icon') as Text | null;
  if (icon) {
    icon.text = token.icon;
    icon.style.fontSize = radius * 1.2;
  }
}
