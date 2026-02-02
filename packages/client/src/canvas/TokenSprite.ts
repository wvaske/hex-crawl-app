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

  const radius = hexSize * 0.45;
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
 * Uses row-based packing: 1 token centered, 2 side-by-side,
 * 3 = 1 top + 2 bottom, 4+ uses rows with ceil(sqrt(n)) columns.
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
    const offset = hexSize * 0.25;
    return [
      { x: -offset, y: 0, scale: 0.55 },
      { x: offset, y: 0, scale: 0.55 },
    ];
  }

  // 3+ tokens: row-based packing
  // Determine grid: cols = ceil(sqrt(count)), rows = ceil(count/cols)
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  // Scale tokens to fit within the hex inner area
  const scale = Math.max(0.25, 0.8 / Math.max(cols, rows));
  const cellW = hexSize * 0.5 / (cols > 1 ? (cols - 1) / 2 : 1);
  const cellH = hexSize * 0.45 / (rows > 1 ? (rows - 1) / 2 : 1);
  const totalW = (cols - 1) * cellW;
  const totalH = (rows - 1) * cellH;

  const result: Array<{ x: number; y: number; scale: number }> = [];
  let idx = 0;
  for (let row = 0; row < rows && idx < count; row++) {
    // How many tokens in this row (last row may have fewer)
    const itemsInRow = Math.min(cols, count - idx);
    const rowW = (itemsInRow - 1) * cellW;
    const rowY = -totalH / 2 + row * cellH;

    for (let col = 0; col < itemsInRow; col++) {
      const colX = -rowW / 2 + col * cellW;
      result.push({ x: colX, y: rowY, scale });
      idx++;
    }
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
  const radius = hexSize * 0.45;
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
