import { AlphaFilter, Application, Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type {
  CampaignState,
  Content,
  ContentPlayerView,
  FogCell,
  HexCell,
  HexCoord,
  HexLayout,
  ImageLayer,
  MapInfo,
  Marker,
  SeatRole,
  Token,
} from '@hexcrawl/shared';
import {
  CONTENT_TYPE_GLYPHS,
  MAX_SCALE_LEVEL,
  SUPER_SCALE,
  TERRAINS,
  fineToIndex,
  fractionalIndex,
  hexCornerOffsets,
  hexDistance,
  hexKey,
  hexRange,
  hexToPixel,
  hexesInPixelRect,
  indexToFineCenter,
  pixelToHex,
  superCornerOffsets,
  superIndexRange,
  superMembers,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';

const STROKE_FLUSH_MS = 180;
/** Base font pins are rasterized at; scaling maps this to world/screen size. */
const PIN_BASE_FONT = 32;
/** Minimum on-screen token diameter in px. */
const TOKEN_MIN_SCREEN = 26;

type PinContainer = Container & {
  __pin?: { worldSize: number; minScreen: number };
};

interface TokenView {
  root: Container;
  body: Graphics;
  glyph: Text;
  label: Text;
  token: Token;
  targetX: number;
  targetY: number;
  dragging: boolean;
}

/**
 * Owns the PixiJS scene. React never touches Pixi: the engine subscribes to
 * the session/ui stores and reconciles the display list imperatively.
 */
export class CanvasEngine {
  private app = new Application();
  private viewport!: Viewport;
  private host!: HTMLElement;

  private imageLayerC = new Container();
  private terrainG = new Graphics();
  private gridG = new Graphics();
  // Fog is a dark sheet with the non-hidden hexes erased out of it. The erase
  // happens inside a filtered container (its own offscreen pass), so holes are
  // pixel-perfect — no polygon-with-holes triangulation, which produced sliver
  // artifacts between adjacent hexes.
  private fogC = new Container();
  private fogSheetG = new Graphics();
  private fogEraseG = new Graphics();
  private fogAlpha = new AlphaFilter({ alpha: 1 });
  private exploredC = new Container();
  private exploredG = new Graphics();
  private exploredAlpha = new AlphaFilter({ alpha: 0.55 });
  private pinsC = new Container();
  private tokensC = new Container();
  private highlightG = new Graphics();

  private tokens = new Map<string, TokenView>();
  private images = new Map<string, Sprite>();

  private layout: HexLayout | null = null;
  private layoutKey = '';
  private lastMap: MapInfo | null = null;
  private lastHexes: HexCell[] = [];
  private lastFog: FogCell[] = [];
  private lastMarkers: Marker[] = [];
  private lastContents: (Content | ContentPlayerView)[] = [];
  private lastImages: ImageLayer[] = [];
  private role: SeatRole = 'player';
  private myCharacterId: string | null = null;

  private viewDirty = true;
  /** Current hex scale level (0=fine, 1=x sqrt7, 2=x7), derived from zoom. */
  private scaleLevel = 0;
  private destroyed = false;
  private needsRecenter = false;
  private resizeObserver: ResizeObserver | null = null;
  private unsubs: (() => void)[] = [];

  private stroke: { mode: 'paint' | 'fog'; pending: Map<string, HexCoord>; timer: number } | null =
    null;
  private drag: { view: TokenView } | null = null;
  private panning = false;

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    await this.app.init({
      background: 0x0b0d12,
      resizeTo: host,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);

    this.viewport = new Viewport({
      events: this.app.renderer.events,
      screenWidth: host.clientWidth,
      screenHeight: host.clientHeight,
    });
    this.viewport
      .drag({ mouseButtons: 'all' })
      .wheel({ smooth: 4 })
      .pinch()
      .decelerate({ friction: 0.9 })
      .clampZoom({ minScale: 0.05, maxScale: 6 });
    this.app.stage.addChild(this.viewport);

    this.fogEraseG.blendMode = 'erase';
    this.fogC.addChild(this.fogSheetG, this.fogEraseG);
    this.fogC.filters = [this.fogAlpha];
    this.exploredC.addChild(this.exploredG);
    this.exploredC.filters = [this.exploredAlpha];

    this.viewport.addChild(this.imageLayerC);
    this.viewport.addChild(this.terrainG);
    this.viewport.addChild(this.gridG);
    this.viewport.addChild(this.pinsC);
    this.viewport.addChild(this.tokensC);
    this.viewport.addChild(this.exploredC);
    this.viewport.addChild(this.fogC);
    this.viewport.addChild(this.highlightG);

    this.viewport.on('moved', () => {
      this.viewDirty = true;
    });
    this.app.renderer.on('resize', (w: number, h: number) => {
      this.viewport.resize(w, h);
      this.viewDirty = true;
    });
    // Pixi's resizeTo only reacts to window resizes; track the host element
    // directly so a 0-sized mount (layout not settled yet) recovers.
    this.resizeObserver = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0 && (this.viewport.screenWidth !== w || this.viewport.screenHeight !== h)) {
        this.app.renderer.resize(w, h);
        this.viewport.resize(w, h);
        this.viewDirty = true;
        if (this.needsRecenter) this.recenter();
      }
    });
    this.resizeObserver.observe(host);

    this.wireInteraction();

    this.app.ticker.add(() => this.tick());

    const sessionUnsub = useSession.subscribe((s, prev) => {
      if (s.version !== prev.version) this.applyState();
    });
    const uiUnsub = useUi.subscribe((u, prev) => {
      if (u.spacePan !== prev.spacePan) {
        this.updateDragMode();
        this.viewport.cursor = u.spacePan ? 'grab' : 'default';
      }
      if (u.movingContentId !== prev.movingContentId) {
        this.viewport.cursor = u.movingContentId ? 'crosshair' : 'default';
      }
      if (u.scaleLock !== prev.scaleLock) {
        this.updateScaleLevel();
      }
      if (
        u.tool !== prev.tool ||
        u.selectedHex !== prev.selectedHex ||
        u.hoverHex !== prev.hoverHex ||
        u.brushRadius !== prev.brushRadius ||
        u.measureStart !== prev.measureStart ||
        u.selectedTokenId !== prev.selectedTokenId
      ) {
        if (u.tool !== prev.tool) this.updateDragMode();
        this.drawHighlight();
      }
    });
    this.unsubs.push(sessionUnsub, uiUnsub);

    this.applyState();
    this.recenter();
    if (import.meta.env.DEV) {
      (window as unknown as { __engine?: CanvasEngine }).__engine = this;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    for (const u of this.unsubs) u();
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
    }
  }

  // -- state application -----------------------------------------------------

  private applyState(): void {
    const session = useSession.getState();
    const state = session.state;
    this.role = session.role ?? 'player';
    this.myCharacterId =
      state?.seats.find((seat) => seat.id === session.seatId)?.characterId ?? null;
    const map = activeMap(state);

    if (!state || !map || !state.mapState) {
      this.clearAll();
      return;
    }

    const layoutKey = `${map.id}|${map.orientation}|${map.hexSize}|${map.originX}|${map.originY}`;
    const layoutChanged = layoutKey !== this.layoutKey;
    if (layoutChanged) {
      const isNewMap = this.lastMap?.id !== map.id;
      this.layoutKey = layoutKey;
      this.layout = {
        orientation: map.orientation,
        size: map.hexSize,
        origin: { x: map.originX, y: map.originY },
      };
      if (isNewMap) {
        this.tokensReset();
      }
    }
    const styleChanged =
      layoutChanged || JSON.stringify(map.gridStyle) !== JSON.stringify(this.lastMap?.gridStyle);
    this.lastMap = map;

    const ms = state.mapState;

    if (layoutChanged || !hexCellsEqual(ms.hexes, this.lastHexes) || styleChanged) {
      this.lastHexes = ms.hexes;
      this.drawTerrain();
    }
    if (layoutChanged || !fogCellsEqual(ms.fog, this.lastFog)) {
      this.lastFog = ms.fog;
      this.viewDirty = true; // fog drawn with view-dependent cover
    }
    if (styleChanged) this.viewDirty = true;

    if (layoutChanged || !imagesEqual(ms.imageLayers, this.lastImages)) {
      this.lastImages = ms.imageLayers;
      void this.reconcileImages(ms.imageLayers);
    }

    this.reconcileTokens(ms.tokens, layoutChanged);

    if (
      layoutChanged ||
      !markersEqual(ms.markers, this.lastMarkers) ||
      !contentsEqual(ms.contents, this.lastContents)
    ) {
      this.lastMarkers = ms.markers;
      this.lastContents = ms.contents;
      this.drawPins();
    }

    this.drawHighlight();

    if (layoutChanged && this.lastMapIdForCenter !== map.id) {
      this.lastMapIdForCenter = map.id;
      this.recenter();
    }
  }

  private lastMapIdForCenter = '';

  private clearAll(): void {
    this.terrainG.clear();
    this.gridG.clear();
    this.fogSheetG.clear();
    this.fogEraseG.clear();
    this.exploredG.clear();
    this.highlightG.clear();
    this.pinsC.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.tokensReset();
    for (const sprite of this.images.values()) sprite.destroy();
    this.images.clear();
    this.imageLayerC.removeChildren();
    this.layout = null;
    this.layoutKey = '';
    this.lastMap = null;
    this.lastHexes = [];
    this.lastFog = [];
    this.lastMarkers = [];
    this.lastContents = [];
    this.lastImages = [];
  }

  private tokensReset(): void {
    for (const view of this.tokens.values()) view.root.destroy({ children: true });
    this.tokens.clear();
    this.tokensC.removeChildren();
  }

  /** Center the viewport on the map's content. */
  recenter(): void {
    if (!this.layout) return;
    if (this.viewport.screenWidth <= 0 || this.viewport.screenHeight <= 0) {
      // Layout hasn't settled; the resize observer re-runs this.
      this.needsRecenter = true;
      return;
    }
    this.needsRecenter = false;
    const cells = this.lastHexes;
    if (cells.length > 0) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const c of cells) {
        const p = hexToPixel(this.layout, c);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const w = maxX - minX + this.layout.size * 4;
      const h = maxY - minY + this.layout.size * 4;
      const scale = Math.min(
        this.viewport.screenWidth / w,
        this.viewport.screenHeight / h,
        1.5,
      );
      this.viewport.setZoom(Math.max(scale, 0.05), true);
      this.viewport.moveCenter(cx, cy);
    } else if (this.images.size > 0) {
      const sprite = [...this.images.values()][0]!;
      this.viewport.moveCenter(sprite.x + sprite.width / 2, sprite.y + sprite.height / 2);
    } else {
      this.viewport.setZoom(1, true);
      this.viewport.moveCenter(this.layout.origin.x, this.layout.origin.y);
    }
    this.viewDirty = true;
  }

  // -- drawing ---------------------------------------------------------------

  private corners(): { x: number; y: number }[] {
    return hexCornerOffsets(this.layout!);
  }

  private polyPoints(center: { x: number; y: number }, corners: { x: number; y: number }[]): number[] {
    const pts: number[] = [];
    for (const c of corners) {
      pts.push(center.x + c.x, center.y + c.y);
    }
    return pts;
  }

  private drawTerrain(): void {
    const g = this.terrainG;
    g.clear();
    if (!this.layout || !this.lastMap) return;
    const alpha = this.lastMap.gridStyle.terrainOpacity;
    if (alpha <= 0) return;
    const corners = this.corners();
    // Group by terrain to minimize fill switches.
    const byTerrain = new Map<string, HexCell[]>();
    for (const cell of this.lastHexes) {
      const list = byTerrain.get(cell.terrain) ?? [];
      list.push(cell);
      byTerrain.set(cell.terrain, list);
    }
    for (const [terrain, cells] of byTerrain) {
      const color = TERRAINS[terrain as keyof typeof TERRAINS]?.color ?? '#888888';
      for (const cell of cells) {
        const center = hexToPixel(this.layout, cell);
        g.poly(this.polyPoints(center, corners));
      }
      g.fill({ color, alpha });
    }
  }

  /**
   * Derive the hex scale level from zoom (with hysteresis) unless the user
   * locked a level. Fine hexes below ~15 screen px step up to the next scale.
   */
  private updateScaleLevel(): void {
    if (!this.layout) return;
    const lock = useUi.getState().scaleLock;
    let next: number;
    if (lock !== 'auto') {
      next = lock;
    } else {
      const zoom = this.viewport.scale.x;
      const fineWidth = 2 * this.layout.size * zoom;
      next = 0;
      // Step up while the current level's hexes are under the threshold.
      while (next < MAX_SCALE_LEVEL && fineWidth * Math.pow(SUPER_SCALE, next) < 15) next++;
      // Hysteresis: resist flapping right at the boundary.
      if (next !== this.scaleLevel) {
        const width = fineWidth * Math.pow(SUPER_SCALE, Math.min(next, this.scaleLevel));
        if (Math.abs(width - 15) < 1.5) next = this.scaleLevel;
      }
    }
    if (next !== this.scaleLevel) {
      this.scaleLevel = next;
      useUi.getState().set('currentScale', next as 0 | 1 | 2);
      this.viewDirty = true;
      this.drawPins();
    }
  }

  /** Enumerate coarse cell centers (fine axial) covering a pixel rect. */
  private superCellsInRect(
    level: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): { q: number; r: number }[] {
    const layout = this.layout!;
    const cornersPx = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: maxX, y: maxY },
    ];
    let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
    for (const pnt of cornersPx) {
      const fine = pixelToHex(layout, pnt);
      const f = fractionalIndex(fine.q, fine.r, level);
      iMin = Math.min(iMin, f.i); iMax = Math.max(iMax, f.i);
      jMin = Math.min(jMin, f.j); jMax = Math.max(jMax, f.j);
    }
    const out: { q: number; r: number }[] = [];
    for (let i = Math.floor(iMin) - 1; i <= Math.ceil(iMax) + 1; i++) {
      for (let j = Math.floor(jMin) - 1; j <= Math.ceil(jMax) + 1; j++) {
        out.push(indexToFineCenter({ q: i, r: j }, level));
      }
    }
    return out;
  }

  /** Grid lines + fog cover are viewport-dependent; redrawn when the view moves. */
  private drawViewDependent(): void {
    if (!this.layout || !this.lastMap) {
      this.gridG.clear();
      this.fogSheetG.clear();
      this.fogEraseG.clear();
      this.exploredG.clear();
      return;
    }
    const bounds = this.viewport.getVisibleBounds();
    const pad = this.layout.size * 2;
    const cells = hexesInPixelRect(
      this.layout,
      bounds.x - pad,
      bounds.y - pad,
      bounds.x + bounds.width + pad,
      bounds.y + bounds.height + pad,
    );
    const tooMany = cells.length > 12000;
    const corners = this.corners();

    // Grid lines: fine hexes at level 0, rotated superhex lattice above.
    const grid = this.gridG;
    grid.clear();
    const style = this.lastMap.gridStyle;
    if (style.lineOpacity > 0) {
      if (this.scaleLevel === 0) {
        if (!tooMany) {
          for (const cell of cells) {
            const center = hexToPixel(this.layout, cell);
            const pts = this.polyPoints(center, corners);
            grid.moveTo(pts[0]!, pts[1]!);
            for (let i = 2; i < pts.length; i += 2) grid.lineTo(pts[i]!, pts[i + 1]!);
            grid.closePath();
          }
        }
      } else {
        const superCorners = superCornerOffsets(this.layout, this.scaleLevel);
        const centers = this.superCellsInRect(
          this.scaleLevel,
          bounds.x - pad,
          bounds.y - pad,
          bounds.x + bounds.width + pad,
          bounds.y + bounds.height + pad,
        );
        for (const c of centers) {
          const center = hexToPixel(this.layout, c);
          const pts = this.polyPoints(center, superCorners);
          grid.moveTo(pts[0]!, pts[1]!);
          for (let i = 2; i < pts.length; i += 2) grid.lineTo(pts[i]!, pts[i + 1]!);
          grid.closePath();
        }
      }
      grid.stroke({
        width: (style.lineWidth * (this.scaleLevel > 0 ? 1.6 : 1)) / this.viewport.scale.x,
        color: style.lineColor,
        alpha: style.lineOpacity,
      });
    }

    // Fog cover: an opaque dark sheet; non-hidden hexes are erased out of it
    // (the container's filter isolates the erase to the fog layer). Erasing is
    // idempotent, so slightly-enlarged hexes overlap cleanly with no seams.
    const isDm = this.role === 'dm';
    this.fogAlpha.alpha = isDm ? 0.55 : 1;
    this.exploredAlpha.alpha = isDm ? 0.25 : 0.55;

    this.fogSheetG.clear();
    this.fogEraseG.clear();
    this.exploredG.clear();

    const margin = Math.max(bounds.width, bounds.height);
    this.fogSheetG.rect(
      bounds.x - margin,
      bounds.y - margin,
      bounds.width + margin * 2,
      bounds.height + margin * 2,
    );
    this.fogSheetG.fill({ color: 0x07080c });

    const holeCorners = corners.map((c) => ({ x: c.x * 1.03, y: c.y * 1.03 }));
    const minX = bounds.x - pad;
    const minY = bounds.y - pad;
    const maxX = bounds.x + bounds.width + pad;
    const maxY = bounds.y + bounds.height + pad;
    for (const f of this.lastFog) {
      const center = hexToPixel(this.layout, f);
      if (center.x < minX || center.x > maxX || center.y < minY || center.y > maxY) continue;
      this.fogEraseG.poly(this.polyPoints(center, holeCorners));
      if (f.state === 'explored') {
        this.exploredG.poly(this.polyPoints(center, holeCorners));
      }
    }
    this.fogEraseG.fill({ color: 0xffffff });
    this.exploredG.fill({ color: 0x0b0d12 });

    this.updatePinScales();
  }

  /**
   * Scale pins and tokens: each occupies its intended world footprint, clamped
   * to a minimum on-screen size so nothing vanishes when zoomed out. Because
   * pins are rasterized at PIN_BASE_FONT with extra resolution, they stay
   * sharp as the player zooms in.
   */
  private updatePinScales(): void {
    if (!this.layout) return;
    const zoom = this.viewport.scale.x;
    for (const child of this.pinsC.children) {
      const meta = (child as PinContainer).__pin;
      if (!meta) continue;
      const effectiveWorld = Math.max(meta.worldSize, meta.minScreen / zoom);
      child.scale.set(effectiveWorld / PIN_BASE_FONT);
    }
    // Party/NPC tokens: same guarantee — never smaller than a thumbprint.
    const tokenWorldDiameter = this.layout.size * 1.1;
    const tokenScale = Math.max(1, TOKEN_MIN_SCREEN / (tokenWorldDiameter * zoom));
    for (const view of this.tokens.values()) {
      view.root.scale.set(tokenScale);
    }
  }

  private drawHighlight(): void {
    const g = this.highlightG;
    g.clear();
    if (!this.layout) return;
    const ui = useUi.getState();
    const corners = this.corners();
    const lineW = 2 / this.viewport.scale.x;

    const lvl = this.scaleLevel;
    const activeCorners = lvl === 0 ? corners : superCornerOffsets(this.layout, lvl);
    const cellCenter = (h: { q: number; r: number }) =>
      hexToPixel(this.layout!, lvl === 0 ? h : indexToFineCenter(fineToIndex(h, lvl), lvl));

    if (ui.selectedHex) {
      const center = cellCenter(ui.selectedHex);
      g.poly(this.polyPoints(center, activeCorners));
      g.stroke({ width: lineW * 1.5, color: 0xc9a24b, alpha: 1 });
    }
    if (ui.hoverHex) {
      const isBrush = (ui.tool === 'paint' || ui.tool === 'fog') && this.role === 'dm';
      let centers: { x: number; y: number }[];
      if (lvl === 0) {
        const cells = isBrush ? hexRange(ui.hoverHex, ui.brushRadius) : [ui.hoverHex];
        centers = cells.map((c) => hexToPixel(this.layout!, c));
      } else {
        const idx = fineToIndex(ui.hoverHex, lvl);
        const indices = isBrush ? superIndexRange(idx, ui.brushRadius) : [idx];
        centers = indices.map((i2) => hexToPixel(this.layout!, indexToFineCenter(i2, lvl)));
      }
      for (const center of centers) {
        g.poly(this.polyPoints(center, activeCorners));
      }
      g.stroke({ width: lineW, color: 0xffffff, alpha: 0.6 });
      if (isBrush) {
        for (const center of centers) {
          g.poly(this.polyPoints(center, activeCorners));
        }
        g.fill({ color: 0xffffff, alpha: 0.08 });
      }
    }
    if (ui.tool === 'measure' && ui.measureStart && ui.hoverHex) {
      const a = hexToPixel(this.layout, ui.measureStart);
      const b = hexToPixel(this.layout, ui.hoverHex);
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke({ width: lineW * 1.5, color: 0x8b7fd4, alpha: 0.9 });
    }
  }

  /**
   * Pins are authored at a fixed base font (crisp rasterization) and scaled:
   * they occupy a real footprint in world space (cities at least a full hex),
   * never shrink below a readable on-screen minimum when zoomed out, and grow
   * naturally — still sharp — as players zoom in.
   */
  private buildPin(opts: {
    glyph: string;
    label?: string;
    chip: boolean;
    dmOnly?: boolean;
    worldSize: number;
    minScreen: number;
  }): Container {
    const pin = new Container();
    if (opts.chip) {
      const chip = new Graphics();
      chip.circle(0, 0, PIN_BASE_FONT * 0.72);
      chip.fill({ color: 0x12151d, alpha: 0.88 });
      chip.stroke({ width: PIN_BASE_FONT * 0.07, color: 0xdcb968, alpha: 0.95 });
      pin.addChild(chip);
    }
    const text = new Text({
      text: opts.glyph,
      style: { fontSize: PIN_BASE_FONT, align: 'center' },
      resolution: 3,
    });
    text.anchor.set(0.5);
    pin.addChild(text);
    if (opts.label) {
      const label = new Text({
        text: opts.label,
        style: {
          fontSize: PIN_BASE_FONT * 0.55,
          fill: 0xffffff,
          fontWeight: '600',
          stroke: { color: 0x000000, width: PIN_BASE_FONT * 0.14 },
          align: 'center',
        },
        resolution: 3,
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, PIN_BASE_FONT * 0.8);
      pin.addChild(label);
    }
    if (opts.dmOnly) {
      const badge = new Text({
        text: '🚫',
        style: { fontSize: PIN_BASE_FONT * 0.42 },
        resolution: 2,
      });
      badge.anchor.set(0.5);
      badge.position.set(PIN_BASE_FONT * 0.55, -PIN_BASE_FONT * 0.5);
      pin.addChild(badge);
      pin.alpha = 0.7;
    }
    (pin as PinContainer).__pin = { worldSize: opts.worldSize, minScreen: opts.minScreen };
    return pin;
  }

  private drawPins(): void {
    this.pinsC.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!this.layout) return;
    const size = this.layout.size;
    const hexWidth = size * 2; // flat-top hex width; the "covers a hex" yardstick

    for (const content of this.lastContents) {
      if (content.scaleVisibility < this.scaleLevel) continue;
      const glyph = content.glyph || CONTENT_TYPE_GLYPHS[content.type];
      const isCity = content.type === 'settlement' && content.glyph === '🏰';
      // Cities cover at least a full hex; labeled places sit between; the rest
      // still get a solid footprint.
      const worldSize = isCity ? hexWidth * 1.15 : content.showLabel ? hexWidth * 0.85 : hexWidth * 0.6;
      const minScreen = isCity ? 36 : content.showLabel ? 28 : 21;
      const pin = this.buildPin({
        glyph,
        label: content.showLabel ? content.title : undefined,
        chip: true,
        worldSize,
        minScreen,
      });
      const center = hexToPixel(this.layout, { q: content.q, r: content.r });
      pin.position.set(center.x, center.y);
      this.pinsC.addChild(pin);
    }

    // Markers per hex, spread along the bottom.
    const byHex = new Map<string, Marker[]>();
    for (const m of this.lastMarkers) {
      const key = hexKey(m.q, m.r);
      const list = byHex.get(key) ?? [];
      list.push(m);
      byHex.set(key, list);
    }
    for (const markers of byHex.values()) {
      markers.forEach((m, i) => {
        const center = hexToPixel(this.layout!, { q: m.q, r: m.r });
        const spread = (i - (markers.length - 1) / 2) * size * 0.7;
        const pin = this.buildPin({
          glyph: m.glyph,
          chip: false,
          dmOnly: m.dmOnly,
          worldSize: size * 1.0,
          minScreen: 19,
        });
        pin.position.set(center.x + spread, center.y + size * 0.55);
        this.pinsC.addChild(pin);
      });
    }
    this.updatePinScales();
  }

  // -- images ----------------------------------------------------------------

  private async reconcileImages(layers: ImageLayer[]): Promise<void> {
    const wanted = new Set(layers.map((l) => l.id));
    for (const [id, sprite] of this.images) {
      if (!wanted.has(id)) {
        sprite.destroy();
        this.images.delete(id);
      }
    }
    for (const layer of layers) {
      let sprite = this.images.get(layer.id);
      if (!sprite) {
        try {
          const texture = await Assets.load(layer.path);
          if (this.destroyed) return;
          sprite = new Sprite(texture);
          this.images.set(layer.id, sprite);
          this.imageLayerC.addChild(sprite);
        } catch {
          continue;
        }
      }
      sprite.position.set(layer.x, layer.y);
      sprite.scale.set(layer.scale);
      sprite.alpha = layer.dmOnly && this.role === 'dm' ? layer.opacity * 0.6 : layer.opacity;
      sprite.visible = layer.visible;
      sprite.zIndex = layer.z;
    }
    this.imageLayerC.sortableChildren = true;
  }

  // -- tokens ----------------------------------------------------------------

  private reconcileTokens(tokens: Token[], jump: boolean): void {
    if (!this.layout) return;
    const wanted = new Map(tokens.map((t) => [t.id, t]));
    for (const [id, view] of this.tokens) {
      if (!wanted.has(id)) {
        view.root.destroy({ children: true });
        this.tokens.delete(id);
      }
    }
    for (const token of tokens) {
      let view = this.tokens.get(token.id);
      const target = hexToPixel(this.layout, token);
      if (!view) {
        view = this.createTokenView(token);
        this.tokens.set(token.id, view);
        view.root.position.set(target.x, target.y);
      } else if (visualChanged(view.token, token)) {
        this.styleTokenView(view, token);
      }
      view.token = token;
      view.targetX = target.x;
      view.targetY = target.y;
      if (jump && !view.dragging) view.root.position.set(target.x, target.y);
    }
    this.updatePinScales();
  }

  private createTokenView(token: Token): TokenView {
    const root = new Container();
    const body = new Graphics();
    const glyph = new Text({ text: '', style: { fontSize: 10 }, resolution: 3 });
    glyph.anchor.set(0.5);
    const label = new Text({
      text: '',
      style: { fontSize: 10, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } },
      resolution: 3,
    });
    label.anchor.set(0.5, 0);
    root.addChild(body, glyph, label);
    this.tokensC.addChild(root);
    const view: TokenView = { root, body, glyph, label, token, targetX: 0, targetY: 0, dragging: false };
    this.styleTokenView(view, token);
    this.wireTokenDrag(view);
    return view;
  }

  private styleTokenView(view: TokenView, token: Token): void {
    const size = (this.layout?.size ?? 40) * 0.55;
    view.body.clear();
    view.body.circle(0, 0, size);
    view.body.fill({ color: token.color });
    view.body.stroke({ width: size * 0.09, color: token.kind === 'pc' ? 0xffffff : 0x22252e });
    if (token.kind === 'npc' && !token.playerVisible) {
      view.body.circle(0, 0, size);
      view.body.stroke({ width: size * 0.09, color: 0xd96c4f, alpha: 0.9 });
    }
    const text = token.glyph || initials(token.label);
    view.glyph.text = text;
    view.glyph.style.fontSize = size * (token.glyph ? 1.0 : 0.75);
    view.glyph.style.fill = 0xffffff;
    view.label.text = token.label;
    view.label.style.fontSize = size * 0.42;
    view.label.position.set(0, size * 1.12);
    view.root.alpha = token.kind === 'npc' && !token.playerVisible ? 0.75 : 1;
  }

  private wireTokenDrag(view: TokenView): void {
    const root = view.root;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointerdown', (e) => {
      if (e.button !== 0) return;
      const ui = useUi.getState();
      if (ui.spacePan) return; // space held: pan instead of dragging the token
      if (ui.tool !== 'select') return;
      if (!this.canMove(view.token)) {
        // Still allow selecting it.
        e.stopPropagation();
        useUi.getState().set('selectedTokenId', view.token.id);
        useUi.getState().set('selectedHex', { q: view.token.q, r: view.token.r });
        return;
      }
      e.stopPropagation();
      view.dragging = true;
      this.drag = { view };
      this.viewport.plugins.pause('drag');
      useUi.getState().set('selectedTokenId', view.token.id);
    });
  }

  private canMove(token: Token): boolean {
    if (this.role === 'dm') return true;
    return token.kind === 'pc' && !!token.characterId && token.characterId === this.myCharacterId;
  }

  // -- interaction -----------------------------------------------------------

  private updateDragMode(): void {
    const ui = useUi.getState();
    const panWithLeft = ui.spacePan || ui.tool === 'select' || this.role !== 'dm';
    this.viewport.plugins.remove('drag');
    this.viewport.drag({ mouseButtons: panWithLeft ? 'all' : 'middle-right' });
  }

  private worldHex(e: { global: { x: number; y: number } }): HexCoord | null {
    if (!this.layout) return null;
    const world = this.viewport.toWorld(e.global.x, e.global.y);
    return pixelToHex(this.layout, world);
  }

  private wireInteraction(): void {
    this.viewport.eventMode = 'static';

    this.viewport.on('pointerdown', (e) => {
      if (e.button !== 0) {
        this.panning = true;
        return;
      }
      const ui = useUi.getState();
      if (ui.spacePan) {
        // Space held: this drag pans, no tool action.
        this.panning = true;
        return;
      }
      const hex = this.worldHex(e);
      if (!hex) return;
      const isDm = this.role === 'dm';

      // Armed "move content" mode: next click relocates the entry.
      if (ui.movingContentId && isDm) {
        send({ kind: 'content.move', contentId: ui.movingContentId, q: hex.q, r: hex.r });
        useUi.getState().set('movingContentId', null);
        this.viewport.cursor = 'default';
        useSession.getState().pushToast({ kind: 'info', title: 'Moved', text: 'Location updated.' });
        return;
      }

      switch (ui.tool) {
        case 'select':
          this.panning = true;
          useUi.getState().selectHex(hex);
          break;
        case 'paint':
          if (!isDm) return;
          this.beginStroke('paint', hex);
          break;
        case 'fog':
          if (!isDm) return;
          this.beginStroke('fog', hex);
          break;
        case 'marker': {
          if (!isDm || !this.lastMap) return;
          send({
            kind: 'marker.place',
            marker: {
              mapId: this.lastMap.id,
              q: hex.q,
              r: hex.r,
              glyph: ui.markerGlyph,
              label: '',
              dmOnly: ui.markerDmOnly,
            },
          });
          break;
        }
        case 'content':
          if (!isDm) return;
          useUi.getState().set('contentDialogHex', hex);
          useUi.getState().set('editingContentId', null);
          break;
        case 'measure':
          if (ui.measureStart && hexDistance(ui.measureStart, hex) > 0) {
            useUi.getState().set('measureStart', null);
          } else {
            useUi.getState().set('measureStart', hex);
          }
          break;
      }
    });

    this.viewport.on('pointermove', (e) => {
      const hex = this.worldHex(e);
      const ui = useUi.getState();
      if (
        hex &&
        (!ui.hoverHex || ui.hoverHex.q !== hex.q || ui.hoverHex.r !== hex.r)
      ) {
        useUi.getState().set('hoverHex', hex);
        if (this.stroke && hex) this.strokeApply(hex);
      }
      if (this.drag) {
        const world = this.viewport.toWorld(e.global.x, e.global.y);
        this.drag.view.root.position.set(world.x, world.y);
      }
    });

    const finish = () => {
      this.panning = false;
      if (this.stroke) this.endStroke();
      if (this.drag) this.endTokenDrag();
    };
    this.viewport.on('pointerup', finish);
    this.viewport.on('pointerupoutside', finish);
  }

  private beginStroke(mode: 'paint' | 'fog', hex: HexCoord): void {
    this.viewport.plugins.pause('drag');
    this.stroke = { mode, pending: new Map(), timer: 0 };
    this.strokeApply(hex);
  }

  private strokeApply(hex: HexCoord): void {
    if (!this.stroke || !this.lastMap) return;
    const ui = useUi.getState();
    const lvl = this.scaleLevel;
    const cells =
      lvl === 0
        ? hexRange(hex, ui.brushRadius)
        : superIndexRange(fineToIndex(hex, lvl), ui.brushRadius).flatMap((idx) =>
            superMembers(idx, lvl),
          );
    const fresh: HexCoord[] = [];
    for (const cell of cells) {
      const key = hexKey(cell.q, cell.r);
      if (!this.stroke.pending.has(key)) {
        this.stroke.pending.set(key, cell);
        fresh.push(cell);
      }
    }
    if (!fresh.length) return;
    const session = useSession.getState();
    if (this.stroke.mode === 'paint') {
      session.optimisticPaint(this.lastMap.id, fresh, ui.paintTerrain);
    } else {
      session.optimisticFog(this.lastMap.id, fresh, ui.fogTarget);
    }
    const now = performance.now();
    if (now - this.stroke.timer > STROKE_FLUSH_MS) {
      this.flushStroke(false);
      this.stroke.timer = now;
    }
  }

  private flushStroke(final: boolean): void {
    if (!this.stroke || !this.lastMap) return;
    const cells = [...this.stroke.pending.values()];
    if (cells.length) {
      const ui = useUi.getState();
      if (this.stroke.mode === 'paint') {
        send({ kind: 'terrain.paint', mapId: this.lastMap.id, cells, terrain: ui.paintTerrain });
      } else {
        send({ kind: 'fog.set', mapId: this.lastMap.id, cells, state: ui.fogTarget });
      }
    }
    if (final) this.stroke = null;
    else if (this.stroke) this.stroke.pending.clear();
  }

  private endStroke(): void {
    this.flushStroke(true);
    this.updateDragMode();
  }

  private endTokenDrag(): void {
    const drag = this.drag;
    this.drag = null;
    this.updateDragMode();
    if (!drag || !this.layout) return;
    drag.view.dragging = false;
    const dropHex = pixelToHex(this.layout, {
      x: drag.view.root.position.x,
      y: drag.view.root.position.y,
    });
    const token = drag.view.token;
    if (dropHex.q === token.q && dropHex.r === token.r) {
      const p = hexToPixel(this.layout, token);
      drag.view.targetX = p.x;
      drag.view.targetY = p.y;
      return;
    }
    // Step-mode limit for players (server validates too).
    const map = this.lastMap;
    if (
      this.role !== 'dm' &&
      map?.moveMode === 'step' &&
      hexDistance(token, dropHex) > 1
    ) {
      const p = hexToPixel(this.layout, token);
      drag.view.targetX = p.x;
      drag.view.targetY = p.y;
      useSession.getState().pushToast({
        kind: 'info',
        title: 'One hex at a time',
        text: 'This map only allows single-hex steps.',
      });
      return;
    }
    useSession.getState().optimisticTokenMove(token.id, dropHex.q, dropHex.r);
    send({ kind: 'token.move', tokenId: token.id, q: dropHex.q, r: dropHex.r });
  }

  // -- ticker ----------------------------------------------------------------

  private tick(): void {
    this.updateScaleLevel();
    if (this.viewDirty) {
      this.viewDirty = false;
      this.drawViewDependent();
      this.drawHighlight();
    }
    // Ease tokens toward their targets.
    for (const view of this.tokens.values()) {
      if (view.dragging) continue;
      const dx = view.targetX - view.root.position.x;
      const dy = view.targetY - view.root.position.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.5) {
        view.root.position.set(view.targetX, view.targetY);
      } else {
        view.root.position.set(
          view.root.position.x + dx * 0.25,
          view.root.position.y + dy * 0.25,
        );
      }
    }
  }
}

// -- diff helpers ------------------------------------------------------------

function hexCellsEqual(a: HexCell[], b: HexCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!,
      y = b[i]!;
    if (x.q !== y.q || x.r !== y.r || x.terrain !== y.terrain) return false;
  }
  return true;
}

function fogCellsEqual(a: FogCell[], b: FogCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!,
      y = b[i]!;
    if (x.q !== y.q || x.r !== y.r || x.state !== y.state) return false;
  }
  return true;
}

function markersEqual(a: Marker[], b: Marker[]): boolean {
  return a.length === b.length && a.every((m, i) => shallowEqual(m, b[i]!));
}

function contentsEqual(
  a: (Content | ContentPlayerView)[],
  b: (Content | ContentPlayerView)[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((c, i) => {
    const o = b[i]!;
    return (
      c.id === o.id &&
      c.q === o.q &&
      c.r === o.r &&
      c.glyph === o.glyph &&
      c.type === o.type &&
      c.title === o.title &&
      c.showLabel === o.showLabel
    );
  });
}

function imagesEqual(a: ImageLayer[], b: ImageLayer[]): boolean {
  return a.length === b.length && a.every((l, i) => shallowEqual(l, b[i]!));
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const key of Object.keys(a)) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function visualChanged(a: Token, b: Token): boolean {
  return (
    a.label !== b.label ||
    a.color !== b.color ||
    a.glyph !== b.glyph ||
    a.kind !== b.kind ||
    a.playerVisible !== b.playerVisible
  );
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
