import {
  AlphaFilter,
  Application,
  Assets,
  Circle,
  Container,
  Graphics,
  Sprite,
  Text,
  type Texture,
} from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type {
  CampaignSettings,
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
  Trail,
  TrailSign,
  SeatRole,
  Token,
} from '@hexcrawl/shared';
import {
  CONTENT_TYPE_GLYPHS,
  contentCells,
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
  isNight,
  MINUTES_PER_DAY,
  pixelToHex,
  superCornerOffsets,
  superIndexRange,
  superMembers,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { stickerUrl } from '../stickers.js';
import { isCoarsePointer } from '../ui/responsive.js';

const STROKE_FLUSH_MS = 180;
/** Base font pins are rasterized at; scaling maps this to world/screen size. */
const PIN_BASE_FONT = 32;
/** Minimum on-screen token diameter in px. */
const TOKEN_MIN_SCREEN = 26;
/**
 * How far the pointer must travel before a token grab becomes a drag (issue
 * #75). A mouse is precise; a fingertip is ~10mm wide and never lands still,
 * so on touch the token has to stay put until the move is clearly deliberate.
 */
const DRAG_THRESHOLD_MOUSE = 3;
const DRAG_THRESHOLD_TOUCH = 12;
/** Tag colour for a party note whose owner has no character colour. */
const NOTE_DEFAULT_TINT = 0x8fb4ff;

type PinContainer = Container & {
  __pin?: { worldSize: number; minScreen: number; maxScreen?: number; baseAlpha?: number };
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
  /** Shrink factor when sharing a hex with other tokens. */
  crowdScale: number;
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
  // Light tint over *visible* hexes so the explored trail reads brightest.
  private exploredC = new Container();
  private exploredG = new Graphics();
  private exploredAlpha = new AlphaFilter({ alpha: 0.3 });
  private pinsC = new Container();
  // Day/night tint: a single generous rect above pins/terrain, below tokens,
  // redrawn whenever the view, clock or toggle changes. Cheap — no per-hex work.
  private tintG = new Graphics();
  private tokensC = new Container();
  private pendingC = new Container();
  private senseG = new Graphics();
  private trailHighlightG = new Graphics();
  private areaHighlightG = new Graphics();
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
  private lastTrails: Trail[] = [];
  private lastTrailSigns: TrailSign[] = [];
  private lastImages: ImageLayer[] = [];
  private lastDiscoveriesRef: unknown = null;
  private lastTintKey = '';
  private role: SeatRole = 'player';
  private myCharacterId: string | null = null;

  private viewDirty = true;
  /** Current hex scale level (0=fine, 1=x sqrt7, 2=x7), derived from zoom. */
  private scaleLevel = 0;
  private destroyed = false;
  private needsRecenter = false;
  private resizeObserver: ResizeObserver | null = null;
  private unsubs: (() => void)[] = [];

  /**
   * A brush stroke in progress. Terrain and fog paint cells; `region` paints
   * membership of a content footprint (issue #108) — either into the content
   * dialog's local draft (`contentId: null`, committed on save) or straight to
   * the server as `content.area` deltas.
   */
  private stroke: {
    mode: 'paint' | 'fog' | 'region';
    pending: Map<string, HexCoord>;
    timer: number;
    /** Region mode: the content being painted, or null for the dialog draft. */
    contentId?: string | null;
    /** Region mode: polarity, latched at stroke start so it can't flip mid-drag. */
    erase?: boolean;
  } | null = null;
  /**
   * A token grab in progress. It starts *armed* (`active: false`): the token
   * only follows the pointer once it has travelled past DRAG_THRESHOLD, so a
   * tap (or the wobble of a finger) selects the token instead of dispatching a
   * move, and a second finger landing on the map cancels it back into a pinch.
   */
  private drag: { view: TokenView; startX: number; startY: number; active: boolean } | null = null;
  private panning = false;
  /** DM shift+drag rubber band (world coords) for bulk content selection. */
  private boxSelect: { start: { x: number; y: number }; end: { x: number; y: number } } | null =
    null;

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
    if (import.meta.env.DEV) {
      (window as unknown as { __engine: CanvasEngine }).__engine = this;
    }

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
    this.viewport.addChild(this.tintG);
    this.viewport.addChild(this.tokensC);
    this.viewport.addChild(this.pendingC);
    this.viewport.addChild(this.exploredC);
    this.viewport.addChild(this.fogC);
    this.viewport.addChild(this.senseG);
    this.viewport.addChild(this.trailHighlightG);
    this.viewport.addChild(this.areaHighlightG);
    this.viewport.addChild(this.highlightG);

    // Every layer except tokensC must be event-transparent: Pixi treats any
    // Graphics whose geometry covers the pointer as a hit-search terminator
    // even when non-interactive, which would steal pointerdown from tokens
    // under the fog/highlight overlays.
    for (const layer of [
      this.imageLayerC,
      this.terrainG,
      this.gridG,
      this.pinsC,
      this.tintG,
      this.pendingC,
      this.exploredC,
      this.fogC,
      this.senseG,
      this.trailHighlightG,
      this.areaHighlightG,
      this.highlightG,
    ]) {
      layer.eventMode = 'none';
    }

    this.viewport.on('moved', () => {
      this.viewDirty = true;
      this.updatePinPopupPos();
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
      if (u.movingContentId !== prev.movingContentId || u.movingTokenId !== prev.movingTokenId) {
        this.viewport.cursor = u.movingContentId || u.movingTokenId ? 'crosshair' : 'default';
      }
      if (u.scaleLock !== prev.scaleLock) {
        this.updateScaleLevel();
      }
      if (u.dimUnexplored !== prev.dimUnexplored) {
        this.drawPins();
      }
      if (u.dayNightTint !== prev.dayNightTint) {
        this.viewDirty = true;
      }
      if (u.senseHighlight !== prev.senseHighlight) {
        this.drawSenseHighlight();
      }
      if (u.trailHighlight !== prev.trailHighlight) {
        this.drawTrailHighlight();
      }
      if (u.areaHighlight !== prev.areaHighlight || u.areaPaint !== prev.areaPaint) {
        this.drawAreaHighlight();
        if ((u.areaPaint !== null) !== (prev.areaPaint !== null)) {
          this.viewport.cursor = u.areaPaint ? 'crosshair' : 'default';
          this.drawHighlight(); // the brush ring follows the pointer in paint mode
        }
      }
      // A cancelled/accepted proposal hands the highlight back to the region
      // tool's own preview.
      if (u.areaProposal !== prev.areaProposal && u.areaProposal === null) {
        this.syncRegionHighlight();
      }
      if (u.tool !== prev.tool || u.regionTargetId !== prev.regionTargetId) {
        this.syncRegionHighlight();
        if ((u.tool === 'region') !== (prev.tool === 'region')) {
          this.viewport.cursor = u.tool === 'region' ? 'crosshair' : 'default';
        }
      }
      if (u.selectedHex !== prev.selectedHex) {
        this.updatePinPopupPos();
      }
      if (
        u.tool !== prev.tool ||
        u.selectedHex !== prev.selectedHex ||
        u.hoverHex !== prev.hoverHex ||
        u.brushRadius !== prev.brushRadius ||
        u.measureStart !== prev.measureStart ||
        u.selectedTokenId !== prev.selectedTokenId ||
        u.trailDraft !== prev.trailDraft
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

    // Day/night tint tracks the clock and daylight settings, independent of
    // the map layers above — redraw the (cheap) tint rect when either moves.
    const tintKey = `${state.campaign.time.minutes}|${state.campaign.settings.sunriseHour}|${state.campaign.settings.sunsetHour}`;
    if (tintKey !== this.lastTintKey) {
      this.lastTintKey = tintKey;
      this.viewDirty = true;
    }

    if (layoutChanged || !hexCellsEqual(ms.hexes, this.lastHexes) || styleChanged) {
      this.lastHexes = ms.hexes;
      this.drawTerrain();
    }
    if (layoutChanged || !fogCellsEqual(ms.fog, this.lastFog)) {
      this.lastFog = ms.fog;
      this.viewDirty = true; // fog drawn with view-dependent cover
      if (useUi.getState().dimUnexplored && this.role === 'dm') this.drawPins();
    }
    if (state.discoveries !== this.lastDiscoveriesRef) {
      this.lastDiscoveriesRef = state.discoveries;
      if (useUi.getState().dimUnexplored && this.role === 'dm') this.drawPins();
    }
    if (styleChanged) this.viewDirty = true;

    if (layoutChanged || !imagesEqual(ms.imageLayers, this.lastImages)) {
      this.lastImages = ms.imageLayers;
      void this.reconcileImages(ms.imageLayers);
    }

    this.reconcileTokens(ms.tokens, layoutChanged);
    this.drawPendingMoves(ms.pendingMoves);

    if (
      layoutChanged ||
      !markersEqual(ms.markers, this.lastMarkers) ||
      !contentsEqual(ms.contents, this.lastContents) ||
      JSON.stringify(ms.trails) !== JSON.stringify(this.lastTrails) ||
      JSON.stringify(ms.trailSigns) !== JSON.stringify(this.lastTrailSigns)
    ) {
      this.lastMarkers = ms.markers;
      this.lastContents = ms.contents;
      this.lastTrails = ms.trails;
      this.lastTrailSigns = ms.trailSigns;
      this.drawPins();
      // The brush target may have grown/shrunk (this snapshot, another DM, an
      // undo) — refresh its preview unless a stroke is mid-flight.
      if (useUi.getState().tool === 'region') this.syncRegionHighlight();
    }

    this.drawHighlight();
    this.updatePinPopupPos();

    if (layoutChanged && this.lastMapIdForCenter !== map.id) {
      this.lastMapIdForCenter = map.id;
      this.recenter();
      // Sense/trail/area-highlight cells belong to the previous map.
      useUi.getState().set('senseHighlight', null);
      this.drawSenseHighlight();
      useUi.getState().set('trailHighlight', null);
      this.drawTrailHighlight();
      useUi.getState().set('areaHighlight', null);
      this.drawAreaHighlight();
    }
  }

  private lastMapIdForCenter = '';

  private clearAll(): void {
    this.pendingC.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.terrainG.clear();
    this.gridG.clear();
    this.fogSheetG.clear();
    this.fogEraseG.clear();
    this.exploredG.clear();
    this.senseG.clear();
    this.trailHighlightG.clear();
    this.areaHighlightG.clear();
    this.highlightG.clear();
    this.tintG.clear();
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
    this.lastTrails = [];
    this.lastTrailSigns = [];
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
    // Swapped per DM preference: explored (actually traversed) renders
    // brightest; visible gets a light tint.
    this.exploredAlpha.alpha = isDm ? 0.18 : 0.3;

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
      if (f.state === 'visible') {
        this.exploredG.poly(this.polyPoints(center, holeCorners));
      }
    }
    this.fogEraseG.fill({ color: 0xffffff });
    this.exploredG.fill({ color: 0x0b0d12 });

    this.drawTint(bounds);
    this.updatePinScales();
  }

  /**
   * Day/night map tint (#58): a single rect covering the visible area
   * generously, tinted to match the campaign clock. Purely cosmetic — no
   * per-hex work, cheap to redraw on every view/clock/toggle change.
   */
  private drawTint(bounds: { x: number; y: number; width: number; height: number }): void {
    this.tintG.clear();
    if (!useUi.getState().dayNightTint) return;
    const state = useSession.getState().state;
    const time = state?.campaign.time;
    if (!time) return;
    const settings = state.campaign.settings;
    const tint = tintForClock(time.minutes, settings);
    if (!tint) return;
    const margin = Math.max(bounds.width, bounds.height);
    this.tintG.rect(
      bounds.x - margin,
      bounds.y - margin,
      bounds.width + margin * 2,
      bounds.height + margin * 2,
    );
    this.tintG.fill({ color: tint.color, alpha: tint.alpha });
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
      let effectiveWorld = Math.max(meta.worldSize, meta.minScreen / zoom);
      // Region labels also cap in SCREEN pixels: zooming into a region should
      // shrink its printed-map name out of the way, not fill the viewport —
      // and once the viewer is well inside the region, fade it back like an
      // atlas label so it stops competing with the hexes underneath.
      if (meta.maxScreen !== undefined) {
        const capWorld = Math.max(meta.maxScreen, meta.minScreen) / zoom;
        effectiveWorld = Math.min(effectiveWorld, capWorld);
        if (meta.baseAlpha !== undefined) {
          // overshoot 1x → unchanged; 4x past the cap → faded to 25%.
          const overshoot = meta.worldSize / capWorld;
          const t = Math.min(1, Math.max(0, (overshoot - 1) / 3));
          child.alpha = meta.baseAlpha * (1 - 0.75 * t);
        }
      }
      child.scale.set(effectiveWorld / PIN_BASE_FONT);
    }
    // Party/NPC tokens: same guarantee — never smaller than a thumbprint.
    const tokenWorldDiameter = this.layout.size * 1.1;
    const tokenScale = Math.max(1, TOKEN_MIN_SCREEN / (tokenWorldDiameter * zoom));
    for (const view of this.tokens.values()) {
      view.root.scale.set(tokenScale * view.crowdScale);
    }
  }

  /** Brass wash over the visited hexes a clicked sense can be observed from. */
  private drawSenseHighlight(): void {
    const g = this.senseG;
    g.clear();
    if (!this.layout) return;
    const highlight = useUi.getState().senseHighlight;
    if (!highlight) return;
    const corners = this.corners();
    for (const cell of highlight.cells) {
      const center = hexToPixel(this.layout, cell);
      g.poly(this.polyPoints(center, corners));
    }
    g.fill({ color: 0xd9b44f, alpha: 0.22 });
    for (const cell of highlight.cells) {
      const center = hexToPixel(this.layout, cell);
      g.poly(this.polyPoints(center, corners));
    }
    g.stroke({ width: 1.5 / this.viewport.scale.x, color: 0xd9b44f, alpha: 0.55 });
  }

  /**
   * Highlight a clicked trail: soft fill over its cells plus a connecting
   * line in cell order. The DM gets the whole path; players get only the
   * cells passed in (their character's discovered signs) — the caller is
   * responsible for that knowledge boundary, this just draws what it's given.
   */
  private drawTrailHighlight(): void {
    const g = this.trailHighlightG;
    g.clear();
    if (!this.layout) return;
    const highlight = useUi.getState().trailHighlight;
    if (!highlight || highlight.cells.length === 0) return;
    const corners = this.corners();
    for (const cell of highlight.cells) {
      const center = hexToPixel(this.layout, cell);
      g.poly(this.polyPoints(center, corners));
    }
    g.fill({ color: 0x8b7fd4, alpha: 0.18 });
    if (highlight.cells.length > 1) {
      const pts = highlight.cells.map((c) => hexToPixel(this.layout!, c));
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) g.moveTo(pts[i]!.x, pts[i]!.y);
        else g.lineTo(pts[i]!.x, pts[i]!.y);
      }
      g.stroke({ width: 2.5 / this.viewport.scale.x, color: 0x8b7fd4, alpha: 0.75 });
    }
    for (const cell of highlight.cells) {
      const center = hexToPixel(this.layout, cell);
      g.poly(this.polyPoints(center, corners));
    }
    g.stroke({ width: 1.5 / this.viewport.scale.x, color: 0x8b7fd4, alpha: 0.55 });
  }

  /**
   * Region footprint (issue #69): a wash over every hex of a clicked
   * multi-hex content, or — while the DM is painting — the live draft. The
   * draft wins so the DM always sees what they're editing.
   */
  private drawAreaHighlight(): void {
    const g = this.areaHighlightG;
    g.clear();
    if (!this.layout) return;
    const ui = useUi.getState();
    // An auto-detect recommendation (issue #113) is not the footprint yet, so
    // it gets its own amber wash and a heavier outline — Pixi's Graphics has
    // no dashed stroke, and weight reads at every zoom where dashes wouldn't.
    const proposal = ui.areaPaint === null && ui.areaHighlight?.proposal === true;
    // "Painting" (a warmer wash) covers both authoring modes: the dialog's
    // draft and the Region tool's live target.
    const painting =
      !proposal && (ui.areaPaint !== null || (ui.tool === 'region' && this.role === 'dm'));
    const cells = ui.areaPaint?.cells ?? ui.areaHighlight?.cells ?? [];
    if (cells.length === 0) return;
    const color = proposal ? 0xd9a441 : painting ? 0x6fae6a : 0x59a5c4;
    const corners = this.corners();
    for (const cell of cells) {
      const center = hexToPixel(this.layout, cell);
      g.poly(this.polyPoints(center, corners));
    }
    g.fill({ color, alpha: proposal ? 0.28 : painting ? 0.3 : 0.2 });
    for (const cell of cells) {
      const center = hexToPixel(this.layout, cell);
      g.poly(this.polyPoints(center, corners));
    }
    g.stroke({
      width: (proposal ? 2.5 : 1.5) / this.viewport.scale.x,
      color,
      alpha: proposal ? 0.95 : 0.6,
    });
  }

  /** The content item on this map with that id, if it's still there. */
  private findContent(contentId: string): Content | ContentPlayerView | null {
    return this.lastContents.find((c) => c.id === contentId) ?? null;
  }

  /**
   * Point the footprint highlight at the region tool's target (issue #108):
   * picking a tool or a target shows what the brush will paint into. A stroke
   * in progress owns the highlight — a snapshot landing mid-drag must not
   * yank the optimistic cells back.
   */
  private syncRegionHighlight(): void {
    if (this.stroke?.mode === 'region') return;
    const ui = useUi.getState();
    // A pending auto-detect proposal owns the highlight until it's accepted
    // or cancelled — a snapshot must not swap it back for the stored area.
    if (ui.areaProposal) return;
    if (ui.tool !== 'region' || this.role !== 'dm') {
      // Leaving the tool takes its own preview with it; a highlight the DM
      // opened from a panel (a different item) stays put.
      if (ui.areaHighlight && ui.areaHighlight.contentId === ui.regionTargetId) {
        ui.set('areaHighlight', null);
        this.drawAreaHighlight();
      }
      return;
    }
    const target = ui.regionTargetId ? this.findContent(ui.regionTargetId) : null;
    ui.set('areaHighlight', target ? { contentId: target.id, cells: contentCells(target) } : null);
    this.drawAreaHighlight();
  }

  /** Keep the DM pin-action popup glued above the selected hex. */
  private updatePinPopupPos(): void {
    const ui = useUi.getState();
    if (this.role !== 'dm' || !this.layout || !ui.selectedHex) {
      if (ui.pinPopup) ui.set('pinPopup', null);
      return;
    }
    const p = hexToPixel(this.layout, ui.selectedHex);
    const sp = this.viewport.toScreen(p.x, p.y);
    const zoom = this.viewport.scale.x;
    ui.set('pinPopup', { x: sp.x, y: sp.y - this.layout.size * zoom * 0.95 });
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
      const isBrush =
        (ui.tool === 'paint' || ui.tool === 'fog' || ui.tool === 'region' || ui.areaPaint !== null) &&
        this.role === 'dm';
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

    // Shift+drag rubber band for content selection.
    if (this.boxSelect) {
      const b = this.boxSelect;
      g.rect(
        Math.min(b.start.x, b.end.x),
        Math.min(b.start.y, b.end.y),
        Math.abs(b.end.x - b.start.x),
        Math.abs(b.end.y - b.start.y),
      );
      g.fill({ color: 0xd9b44f, alpha: 0.08 });
      g.rect(
        Math.min(b.start.x, b.end.x),
        Math.min(b.start.y, b.end.y),
        Math.abs(b.end.x - b.start.x),
        Math.abs(b.end.y - b.start.y),
      );
      g.stroke({ width: lineW * 1.5, color: 0xd9b44f, alpha: 0.9 });
    }

    // Trail tool: preview the path being drawn.
    if (ui.tool === 'trail' && ui.trailDraft.length) {
      const pts = ui.trailDraft.map((c) => hexToPixel(this.layout!, c));
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) g.moveTo(pts[i]!.x, pts[i]!.y);
        else g.lineTo(pts[i]!.x, pts[i]!.y);
      }
      if (pts.length > 1) g.stroke({ width: lineW * 2, color: 0x8a6f4d, alpha: 0.85 });
      for (const p of pts) {
        g.circle(p.x, p.y, this.layout.size * 0.18);
      }
      g.fill({ color: 0x8a6f4d, alpha: 0.9 });
    }
  }

  /**
   * Pins are authored at a fixed base font (crisp rasterization) and scaled:
   * they occupy a real footprint in world space (cities at least a full hex),
   * never shrink below a readable on-screen minimum when zoomed out, and grow
   * naturally — still sharp — as players zoom in.
   */
  /**
   * Sticker id → rasterized SVG texture. SVGs load asynchronously, so the
   * first draw falls back to the marker's emoji glyph and `drawPins` is
   * replayed once the texture lands (each id is fetched at most once).
   */
  private stickerTextures = new Map<string, Texture>();
  private stickerLoading = new Set<string>();

  private stickerTexture(icon: string): Texture | null {
    const cached = this.stickerTextures.get(icon);
    if (cached) return cached;
    if (this.stickerLoading.has(icon)) return null;
    const url = stickerUrl(icon);
    if (!url) return null; // unknown id (older client/newer data): keep the glyph
    this.stickerLoading.add(icon);
    void Assets.load<Texture>(url)
      .then((texture) => {
        if (this.destroyed) return;
        this.stickerTextures.set(icon, texture);
        this.drawPins();
      })
      .catch(() => {
        /* leave the glyph fallback in place */
      });
    return null;
  }

  private buildPin(opts: {
    glyph: string;
    /** Sticker id; when its texture is loaded it replaces the glyph. */
    icon?: string;
    label?: string;
    chip: boolean;
    /** Player-placed party note: rounded-rect tag tinted with the owner's colour. */
    note?: boolean;
    tint?: number;
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
    if (opts.note) {
      const tint = opts.tint ?? NOTE_DEFAULT_TINT;
      const w = PIN_BASE_FONT * 1.6;
      const h = PIN_BASE_FONT * 1.3;
      const tag = new Graphics();
      tag.roundRect(-w / 2, -h / 2, w, h, PIN_BASE_FONT * 0.32);
      tag.fill({ color: 0x12151d, alpha: 0.82 });
      tag.stroke({ width: PIN_BASE_FONT * 0.1, color: tint, alpha: 0.95 });
      pin.addChild(tag);
      // Owner-coloured dog-ear so a note reads as a note even at a glance.
      const corner = new Graphics();
      corner.circle(w / 2 - PIN_BASE_FONT * 0.12, -h / 2 + PIN_BASE_FONT * 0.12, PIN_BASE_FONT * 0.2);
      corner.fill({ color: tint, alpha: 0.95 });
      pin.addChild(corner);
    }
    const sticker = opts.icon ? this.stickerTexture(opts.icon) : null;
    if (sticker) {
      const sprite = new Sprite(sticker);
      sprite.anchor.set(0.5);
      sprite.setSize(PIN_BASE_FONT * 1.2, PIN_BASE_FONT * 1.2);
      pin.addChild(sprite);
    } else {
      const text = new Text({
        text: opts.glyph,
        style: { fontSize: PIN_BASE_FONT, align: 'center' },
        resolution: 3,
      });
      text.anchor.set(0.5);
      pin.addChild(text);
    }
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

  /** seatId → the colour of the character that seat plays (for party notes). */
  private seatTints(): Map<string, number> {
    const st = useSession.getState().state;
    const colors = new Map((st?.characters ?? []).map((c) => [c.id, c.color]));
    const tints = new Map<string, number>();
    for (const seat of st?.seats ?? []) {
      const hex = seat.characterId ? colors.get(seat.characterId) : undefined;
      if (hex) tints.set(seat.id, Number.parseInt(hex.replace('#', ''), 16));
    }
    return tints;
  }

  /** Disabled content: dimmed with a red X — staged, not live for players. */
  private markDisabled(pin: Container): void {
    pin.alpha *= 0.45;
    const x = new Text({
      text: '❌',
      style: { fontSize: PIN_BASE_FONT * 0.55 },
      resolution: 2,
    });
    x.anchor.set(0.5);
    x.position.set(0, 0);
    pin.addChild(x);
  }

  /** World-space midpoint of a footprint, for labelling a region across it. */
  private footprintCentroid(cells: HexCoord[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const cell of cells) {
      const p = hexToPixel(this.layout!, cell);
      x += p.x;
      y += p.y;
    }
    return { x: x / cells.length, y: y / cells.length };
  }

  /** World-space horizontal extent of a footprint. */
  private footprintWidth(cells: HexCoord[]): number {
    let min = Infinity;
    let max = -Infinity;
    for (const cell of cells) {
      const p = hexToPixel(this.layout!, cell);
      min = Math.min(min, p.x);
      max = Math.max(max, p.x);
    }
    return max - min;
  }

  private drawPins(): void {
    this.pinsC.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!this.layout) return;
    const size = this.layout.size;
    const hexWidth = size * 2; // flat-top hex width; the "covers a hex" yardstick

    // DM aid: dim what the players cannot see. For locations the player
    // filter is discovery-based (a pin shows once a character has discovered
    // at least one clue), so that's the signal — not fog.
    const dimUnexplored = useUi.getState().dimUnexplored && this.role === 'dm';
    let discoveredClues: Set<string> | null = null;
    let fogByKey: Map<string, FogCell['state']> | null = null;
    if (dimUnexplored) {
      const st = useSession.getState().state;
      discoveredClues = new Set((st?.discoveries ?? []).map((d) => d.clueId));
      fogByKey = new Map(this.lastFog.map((f) => [hexKey(f.q, f.r), f.state]));
    }

    for (const content of this.lastContents) {
      if (content.scaleVisibility < this.scaleLevel) continue;
      // A multi-hex region reads best labelled across the middle of its
      // footprint; single-hex content (and every pin) stays on its anchor.
      const anchor = hexToPixel(this.layout, { q: content.q, r: content.r });
      const center =
        content.type === 'region' && content.area.length > 0
          ? this.footprintCentroid(contentCells(content))
          : anchor;

      // Regions render as printed-map style text labels, not pins.
      if (content.type === 'region') {
        const label = new Text({
          text: content.title,
          style: {
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontStyle: 'italic',
            fontWeight: '600',
            fontSize: PIN_BASE_FONT,
            fill: 0x3d4633,
            stroke: { color: 0xf2eddd, width: PIN_BASE_FONT * 0.14 },
            align: 'center',
            letterSpacing: 2,
          },
          resolution: 3,
        });
        label.anchor.set(0.5);
        const pin = new Container();
        pin.addChild(label);
        // Bigger footprint for bigger regions; readable minimum when far out.
        // A painted area nudges the label up with the ground it covers, but
        // gently — a province-sized footprint should not shout (the 3x cap
        // made Forest of Wyrms comically large once its area was painted).
        const base = size * (content.scaleVisibility === 2 ? 2.6 : 1.8);
        const worldSize =
          content.area.length > 0
            ? Math.min(base * 1.8, Math.max(base, this.footprintWidth(contentCells(content)) * 0.35))
            : base;
        pin.position.set(center.x, center.y);
        if (discoveredClues) {
          const known =
            'clues' in content && content.clues.some((cl) => discoveredClues.has(cl.id));
          pin.alpha *= known ? 1 : 0.25;
        }
        if ('enabled' in content && content.enabled === false) this.markDisabled(pin);
        // baseAlpha captured after the dimming above: updatePinScales fades
        // the label further as the viewer zooms inside the region.
        (pin as PinContainer).__pin = {
          worldSize,
          minScreen: 15,
          maxScreen: 26,
          baseAlpha: pin.alpha,
        };
        this.pinsC.addChild(pin);
        continue;
      }

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
      pin.position.set(center.x, center.y);
      if (discoveredClues) {
        const known =
          'clues' in content && content.clues.some((cl) => discoveredClues.has(cl.id));
        pin.alpha *= known ? 1 : 0.25;
      }
      if ('enabled' in content && content.enabled === false) this.markDisabled(pin);
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
    // Party notes (issue #74) get a tag in the placing player's colour.
    const noteTint = this.lastMarkers.some((m) => m.playerPlaced) ? this.seatTints() : null;
    for (const markers of byHex.values()) {
      markers.forEach((m, i) => {
        const center = hexToPixel(this.layout!, { q: m.q, r: m.r });
        const spread = (i - (markers.length - 1) / 2) * size * 0.7;
        // Sticker markers (issue #67) carry their own size multiplier; it
        // scales both the world footprint and the zoomed-out floor so a big
        // sticker stays big at every zoom.
        const scale = m.scale || 1;
        const pin = this.buildPin({
          glyph: m.glyph,
          icon: m.icon,
          chip: false,
          note: m.playerPlaced,
          tint: m.playerPlaced ? noteTint?.get(m.ownerSeatId ?? '') : undefined,
          label: m.playerPlaced && m.label ? truncateLabel(m.label) : undefined,
          dmOnly: m.dmOnly,
          worldSize: size * (m.playerPlaced ? 1.15 : 1.0) * scale,
          minScreen: (m.playerPlaced ? 21 : 19) * scale,
        });
        pin.position.set(center.x + spread, center.y + size * 0.55);
        if (fogByKey) {
          const fog = fogByKey.get(hexKey(m.q, m.r)) ?? 'hidden';
          const playerVisible = !m.dmOnly && fog !== 'hidden';
          pin.alpha *= playerVisible ? 1 : 0.35;
        }
        this.pinsC.addChild(pin);
      });
    }
    this.drawTrails();
    this.updatePinScales();
  }

  /**
   * Trail signs: footstep glyphs with push-direction arrows. Players see the
   * cells their character has discovered (server-computed signs); the DM sees
   * every cell plus a faint connecting line.
   */
  private drawTrails(): void {
    if (!this.layout) return;
    const size = this.layout.size;
    const signs: { q: number; r: number; glyph: string; forwardAngle: number | null; backwardAngle: number | null }[] = [];
    if (this.role === 'dm') {
      for (const trail of this.lastTrails) {
        // Connecting line for the DM only.
        const line = new Graphics();
        const pts = trail.cells.map((c) => hexToPixel(this.layout!, c));
        for (let i = 0; i < pts.length; i++) {
          if (i === 0) line.moveTo(pts[i]!.x, pts[i]!.y);
          else line.lineTo(pts[i]!.x, pts[i]!.y);
        }
        line.stroke({ width: Math.max(1.5, size * 0.06), color: 0x8a6f4d, alpha: 0.4 });
        this.pinsC.addChild(line);
        trail.cells.forEach((cell, i) => {
          const next = trail.cells[i + 1];
          const prev = trail.cells[i - 1];
          const angle = (a: { q: number; r: number }, b: { q: number; r: number }) => {
            const pa = hexToPixel(this.layout!, a);
            const pb = hexToPixel(this.layout!, b);
            return (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
          };
          signs.push({
            q: cell.q,
            r: cell.r,
            glyph: trail.glyph,
            forwardAngle: next ? angle(cell, next) : null,
            backwardAngle: prev ? angle(cell, prev) : null,
          });
        });
      }
    } else {
      for (const s of this.lastTrailSigns) signs.push(s);
    }

    for (const s of signs) {
      const center = hexToPixel(this.layout, { q: s.q, r: s.r });
      const pin = new Container();
      const glyph = new Text({
        text: s.glyph,
        style: { fontSize: PIN_BASE_FONT * 0.7 },
        resolution: 3,
      });
      glyph.anchor.set(0.5);
      pin.addChild(glyph);
      if (s.forwardAngle !== null) {
        const arrow = new Text({
          text: '➤',
          style: { fontSize: PIN_BASE_FONT * 0.5, fill: 0xd9b44f },
          resolution: 3,
        });
        arrow.anchor.set(0.5);
        arrow.rotation = (s.forwardAngle * Math.PI) / 180;
        arrow.position.set(
          Math.cos(arrow.rotation) * PIN_BASE_FONT * 0.75,
          Math.sin(arrow.rotation) * PIN_BASE_FONT * 0.75,
        );
        pin.addChild(arrow);
      }
      if (s.backwardAngle !== null) {
        const back = new Text({
          text: '➤',
          style: { fontSize: PIN_BASE_FONT * 0.34, fill: 0xffffff },
          resolution: 3,
        });
        back.anchor.set(0.5);
        back.alpha = 0.45;
        back.rotation = (s.backwardAngle * Math.PI) / 180;
        back.position.set(
          Math.cos(back.rotation) * PIN_BASE_FONT * 0.7,
          Math.sin(back.rotation) * PIN_BASE_FONT * 0.7,
        );
        pin.addChild(back);
      }
      (pin as PinContainer).__pin = { worldSize: size * 0.9, minScreen: 17 };
      pin.position.set(center.x, center.y - size * 0.25);
      this.pinsC.addChild(pin);
    }
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
    // Tokens sharing a hex spread into a ring and shrink so all stay visible.
    const byHex = new Map<string, Token[]>();
    for (const t of tokens) {
      const key = hexKey(t.q, t.r);
      const list = byHex.get(key) ?? [];
      list.push(t);
      byHex.set(key, list);
    }
    const size = this.layout.size;
    for (const token of tokens) {
      let view = this.tokens.get(token.id);
      const group = byHex.get(hexKey(token.q, token.r))!;
      const n = group.length;
      const idx = group.findIndex((t) => t.id === token.id);
      const center = hexToPixel(this.layout, token);
      let offX = 0;
      let offY = 0;
      let crowd = 1;
      if (n > 1) {
        const angle = (2 * Math.PI * idx) / n - Math.PI / 2;
        const radius = size * (n === 2 ? 0.34 : 0.48);
        offX = Math.cos(angle) * radius;
        offY = Math.sin(angle) * radius;
        crowd = n === 2 ? 0.62 : n <= 4 ? 0.5 : 0.4;
      }
      const target = { x: center.x + offX, y: center.y + offY };
      if (!view) {
        view = this.createTokenView(token);
        this.tokens.set(token.id, view);
        view.root.position.set(target.x, target.y);
      } else if (visualChanged(view.token, token)) {
        this.styleTokenView(view, token);
      }
      view.token = token;
      view.crowdScale = crowd;
      view.targetX = target.x;
      view.targetY = target.y;
      if (jump && !view.dragging) view.root.position.set(target.x, target.y);
    }
    this.updatePinScales();
  }

  /** Dashed declared-travel paths with a ghost token at the destination. */
  private drawPendingMoves(pending: { fromQ: number; fromR: number; toQ: number; toR: number; color: string; label: string }[]): void {
    this.pendingC.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!this.layout || !pending.length) return;
    const size = this.layout.size;
    for (const pm of pending) {
      const a = hexToPixel(this.layout, { q: pm.fromQ, r: pm.fromR });
      const b = hexToPixel(this.layout, { q: pm.toQ, r: pm.toR });
      const g = new Graphics();
      // dashed line
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const dash = Math.max(6, size * 0.6);
      const n = Math.floor(dist / (dash * 1.6));
      for (let i = 0; i <= n; i++) {
        const t0 = (i * dash * 1.6) / dist;
        const t1 = Math.min(1, t0 + dash / dist);
        g.moveTo(a.x + dx * t0, a.y + dy * t0);
        g.lineTo(a.x + dx * t1, a.y + dy * t1);
      }
      g.stroke({ width: Math.max(2, size * 0.12), color: pm.color, alpha: 0.9 });
      g.circle(b.x, b.y, size * 0.55);
      g.fill({ color: pm.color, alpha: 0.35 });
      g.circle(b.x, b.y, size * 0.55);
      g.stroke({ width: Math.max(1.5, size * 0.08), color: 0xffffff, alpha: 0.8 });
      this.pendingC.addChild(g);
      const label = new Text({
        text: `${pm.label}?`,
        style: {
          fontSize: 13,
          fill: 0xffffff,
          fontWeight: '700',
          stroke: { color: 0x000000, width: 3 },
        },
        resolution: 3,
      });
      label.anchor.set(0.5, 0);
      label.position.set(b.x, b.y + size * 0.7);
      (label as unknown as PinContainer).__pin = { worldSize: size, minScreen: 14 };
      this.pendingC.addChild(label);
    }
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
    const view: TokenView = { root, body, glyph, label, token, targetX: 0, targetY: 0, dragging: false, crowdScale: 1 };
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
    if (token.partyId) {
      // Halo marking a party member — the group moves as one.
      view.body.circle(0, 0, size * 1.18);
      view.body.stroke({ width: size * 0.07, color: 0xd9b44f, alpha: 0.75 });
    }
    const text = token.glyph || initials(token.label);
    view.glyph.text = text;
    view.glyph.style.fontSize = size * (token.glyph ? 1.0 : 0.75);
    view.glyph.style.fill = 0xffffff;
    view.label.text = token.label;
    view.label.style.fontSize = size * 0.42;
    view.label.position.set(0, size * 1.12);
    view.root.alpha = token.kind === 'npc' && !token.playerVisible ? 0.75 : 1;
    // Explicit grab target: hit-testing a bare Container depends on child
    // geometry, which is fragile; a hitArea makes the whole disc grabbable.
    // Touch gets a wider collar than the disc itself — the hit area scales
    // with the token, whose on-screen size is floored at TOKEN_MIN_SCREEN, so
    // this stays a ~44px target even zoomed all the way out.
    view.root.hitArea = new Circle(0, 0, size * (isCoarsePointer() ? 1.7 : 1.25));
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
      // Armed, not dragging: the map stays put and the token stays home until
      // the pointer clears the threshold in `pointermove`.
      this.drag = { view, startX: e.global.x, startY: e.global.y, active: false };
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
      // A second finger while a token is held: that gesture is a pinch, not a
      // move. Hand the map back its token and let pixi-viewport zoom.
      if (this.drag && e.pointerType !== 'mouse') {
        this.cancelTokenDrag();
        return;
      }
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

      // DM shift+drag with the select tool: rubber-band content selection.
      if (isDm && ui.tool === 'select' && e.shiftKey) {
        const world = this.viewport.toWorld(e.global.x, e.global.y);
        this.boxSelect = { start: { x: world.x, y: world.y }, end: { x: world.x, y: world.y } };
        this.viewport.plugins.pause('drag');
        this.drawHighlight();
        return;
      }

      // Armed "paint area" mode: drag the brush over footprint membership
      // until the dialog's Done (or Escape) ends it. Nothing is sent until
      // save — the dialog owns this draft (a new item has no id yet).
      if (ui.areaPaint && isDm) {
        this.beginStroke('region', hex, null);
        return;
      }

      // Armed "move content" mode: next click relocates the entry.
      if (ui.movingContentId && isDm) {
        send({ kind: 'content.move', contentId: ui.movingContentId, q: hex.q, r: hex.r });
        useUi.getState().set('movingContentId', null);
        this.viewport.cursor = 'default';
        useSession.getState().pushToast({ kind: 'info', title: 'Moved', text: 'Location updated.' });
        return;
      }

      // Armed "send token here" mode (from the sidebar): next click is the
      // destination — same rules as a drag, without the long mouse travel.
      if (ui.movingTokenId) {
        const view = this.tokens.get(ui.movingTokenId);
        useUi.getState().set('movingTokenId', null);
        this.viewport.cursor = 'default';
        if (view && this.canMove(view.token)) {
          if (!(hex.q === view.token.q && hex.r === view.token.r)) {
            this.dispatchMove(view.token, hex);
          }
        }
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
              // `glyph` stays the non-SVG fallback even when a sticker is
              // chosen; `icon` wins wherever the sticker library is available.
              glyph: ui.markerGlyph,
              icon: ui.markerIcon,
              scale: ui.markerScale,
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
        case 'trail': {
          if (!isDm) return;
          const draft = useUi.getState().trailDraft;
          const idx = draft.findIndex((c) => c.q === hex.q && c.r === hex.r);
          if (idx >= 0) {
            // Clicking an existing node removes it (neighbors reconnect).
            useUi.getState().set('trailDraft', draft.filter((_, i) => i !== idx));
          } else if (draft.length < 2) {
            useUi.getState().set('trailDraft', [...draft, hex]);
          } else {
            // Insert into whichever segment grows the least — so clicking
            // between two nodes bends that segment, and clicking past the
            // end extends the trail.
            let best = draft.length; // append
            let bestCost = hexDistance(draft[draft.length - 1]!, hex);
            const prependCost = hexDistance(hex, draft[0]!);
            if (prependCost < bestCost) {
              best = 0;
              bestCost = prependCost;
            }
            for (let i = 0; i < draft.length - 1; i++) {
              const a = draft[i]!;
              const b = draft[i + 1]!;
              const cost = hexDistance(a, hex) + hexDistance(hex, b) - hexDistance(a, b);
              if (cost < bestCost) {
                best = i + 1;
                bestCost = cost;
              }
            }
            const next = [...draft];
            next.splice(best, 0, hex);
            useUi.getState().set('trailDraft', next);
          }
          this.drawHighlight();
          break;
        }
        case 'region': {
          // Region brush (issue #108): drag over the map to grow (or erase)
          // the chosen region's footprint. Without a target there's nothing
          // to paint into — the toolbar panel says so.
          if (!isDm || !ui.regionTargetId) return;
          if (!this.findContent(ui.regionTargetId)) return;
          this.beginStroke('region', hex, ui.regionTargetId);
          break;
        }
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
      if (this.boxSelect) {
        const world = this.viewport.toWorld(e.global.x, e.global.y);
        this.boxSelect.end = { x: world.x, y: world.y };
        this.drawHighlight();
      }
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
        if (!this.drag.active) {
          const threshold =
            e.pointerType === 'mouse' ? DRAG_THRESHOLD_MOUSE : DRAG_THRESHOLD_TOUCH;
          const travelled = Math.hypot(
            e.global.x - this.drag.startX,
            e.global.y - this.drag.startY,
          );
          if (travelled < threshold) return;
          this.drag.active = true;
          this.drag.view.dragging = true;
        }
        const world = this.viewport.toWorld(e.global.x, e.global.y);
        this.drag.view.root.position.set(world.x, world.y);
      }
    });

    const finish = () => {
      this.panning = false;
      if (this.stroke) this.endStroke();
      if (this.drag) this.endTokenDrag();
      if (this.boxSelect) this.endBoxSelect();
    };
    this.viewport.on('pointerup', finish);
    this.viewport.on('pointerupoutside', finish);
  }

  /** Resolve the rubber band into a bulk content selection. */
  private endBoxSelect(): void {
    const box = this.boxSelect;
    this.boxSelect = null;
    this.updateDragMode();
    this.drawHighlight();
    if (!box || !this.layout) return;
    const minX = Math.min(box.start.x, box.end.x);
    const maxX = Math.max(box.start.x, box.end.x);
    const minY = Math.min(box.start.y, box.end.y);
    const maxY = Math.max(box.start.y, box.end.y);
    if (maxX - minX < 4 && maxY - minY < 4) return; // just a shift-click
    const ids: string[] = [];
    for (const content of this.lastContents) {
      const p = hexToPixel(this.layout, { q: content.q, r: content.r });
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) ids.push(content.id);
    }
    useUi.getState().set('contentSelection', ids.length ? ids : null);
  }

  private beginStroke(mode: 'paint' | 'fog', hex: HexCoord): void;
  private beginStroke(mode: 'region', hex: HexCoord, contentId: string | null): void;
  private beginStroke(
    mode: 'paint' | 'fog' | 'region',
    hex: HexCoord,
    contentId: string | null = null,
  ): void {
    this.viewport.plugins.pause('drag');
    this.stroke = {
      mode,
      pending: new Map(),
      timer: 0,
      contentId,
      erase: useUi.getState().regionErase,
    };
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
    } else if (this.stroke.mode === 'fog') {
      session.optimisticFog(this.lastMap.id, fresh, ui.fogTarget);
    } else {
      this.regionStrokePreview(fresh);
    }
    const now = performance.now();
    if (now - this.stroke.timer > STROKE_FLUSH_MS) {
      this.flushStroke(false);
      this.stroke.timer = now;
    }
  }

  /**
   * Show a region stroke the moment the brush passes: the dialog's draft and
   * the tool's footprint highlight are the same wash on screen, so both get
   * the cells before any server round trip.
   */
  private regionStrokePreview(fresh: HexCoord[]): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const ui = useUi.getState();
    const target = stroke.contentId ? this.findContent(stroke.contentId) : null;
    const source = stroke.contentId ? ui.areaHighlight?.cells : ui.areaPaint?.cells;
    const cells = new Map<string, HexCoord>();
    for (const cell of source ?? []) cells.set(hexKey(cell.q, cell.r), cell);
    // The anchor hex is a member no matter what the brush does to it.
    const anchorKey = target ? hexKey(target.q, target.r) : null;
    for (const cell of fresh) {
      const key = hexKey(cell.q, cell.r);
      if (stroke.erase) {
        if (key !== anchorKey) cells.delete(key);
      } else {
        cells.set(key, cell);
      }
    }
    const next = [...cells.values()];
    if (stroke.contentId) {
      ui.set('areaHighlight', { contentId: stroke.contentId, cells: next });
    } else {
      ui.set('areaPaint', { cells: next });
    }
  }

  private flushStroke(final: boolean): void {
    if (!this.stroke || !this.lastMap) return;
    const cells = [...this.stroke.pending.values()];
    if (cells.length) {
      const ui = useUi.getState();
      if (this.stroke.mode === 'paint') {
        send({ kind: 'terrain.paint', mapId: this.lastMap.id, cells, terrain: ui.paintTerrain });
      } else if (this.stroke.mode === 'fog') {
        send({ kind: 'fog.set', mapId: this.lastMap.id, cells, state: ui.fogTarget });
      } else if (this.stroke.contentId) {
        // The dialog's draft (contentId === null) is committed by its save;
        // the region tool paints an existing item, one delta per flush.
        send(
          this.stroke.erase
            ? { kind: 'content.area', contentId: this.stroke.contentId, remove: cells }
            : { kind: 'content.area', contentId: this.stroke.contentId, add: cells },
        );
      }
    }
    if (final) this.stroke = null;
    else if (this.stroke) this.stroke.pending.clear();
  }

  private endStroke(): void {
    this.flushStroke(true);
    this.updateDragMode();
  }

  /**
   * Give up a token grab without moving anything — the pointer never cleared
   * the drag threshold (a tap), or a second finger arrived and this gesture is
   * really a pinch.
   */
  private cancelTokenDrag(): void {
    const drag = this.drag;
    this.drag = null;
    this.updateDragMode();
    if (!drag || !this.layout) return;
    drag.view.dragging = false;
    // `targetX/Y` is where the sync loop wants this token (hex centre plus any
    // crowd offset) — snapping to it undoes a partial drag exactly.
    drag.view.root.position.set(drag.view.targetX, drag.view.targetY);
  }

  private endTokenDrag(): void {
    if (this.drag && !this.drag.active) {
      // A tap: the token is selected (done on pointerdown), nothing moves.
      this.cancelTokenDrag();
      return;
    }
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
    const outcome =
      dropHex.q === token.q && dropHex.r === token.r
        ? 'denied'
        : this.dispatchMove(token, dropHex);
    if (outcome !== 'moved') {
      // Snap home: the move became a request (ghost shows the destination)
      // or didn't happen at all.
      const p = hexToPixel(this.layout, token);
      drag.view.targetX = p.x;
      drag.view.targetY = p.y;
    }
  }

  /**
   * Send `token` toward a destination hex, honoring the same rules as a drag:
   * players on approval maps declare a request, step-mode limits players to
   * one hex, and a DM holding Alt teleports (no explored trail).
   */
  private dispatchMove(token: Token, dropHex: HexCoord): 'moved' | 'requested' | 'denied' {
    const map = this.lastMap;
    // DM-approved travel: the move becomes a request; a ghost shows the
    // declared destination until the DM resolves it.
    if (this.role !== 'dm' && map?.moveApproval) {
      send({ kind: 'move.request', tokenId: token.id, q: dropHex.q, r: dropHex.r });
      useSession.getState().pushToast({
        kind: 'info',
        title: 'Travel declared',
        text: 'Waiting for the DM to resolve your move.',
      });
      return 'requested';
    }
    // Step-mode limit for players (server validates too).
    if (this.role !== 'dm' && map?.moveMode === 'step' && hexDistance(token, dropHex) > 1) {
      useSession.getState().pushToast({
        kind: 'info',
        title: 'One hex at a time',
        text: 'This map only allows single-hex steps.',
      });
      return 'denied';
    }
    const teleport = this.role === 'dm' && useUi.getState().altTeleport;
    useSession.getState().optimisticTokenMove(token.id, dropHex.q, dropHex.r);
    // Party members shift by the same offset; the server moves them for real.
    if (token.partyId) {
      const dq = dropHex.q - token.q;
      const dr = dropHex.r - token.r;
      for (const other of this.tokens.values()) {
        if (other.token.id !== token.id && other.token.partyId === token.partyId) {
          useSession
            .getState()
            .optimisticTokenMove(other.token.id, other.token.q + dq, other.token.r + dr);
        }
      }
    }
    send({ kind: 'token.move', tokenId: token.id, q: dropHex.q, r: dropHex.r, teleport });
    if (teleport) {
      useSession.getState().pushToast({ kind: 'info', title: 'Teleported', text: `${token.label || 'Token'} moved without leaving a trail.` });
    }
    // Landing selects the destination, so the inspect tab shows the new hex.
    if (token.kind === 'pc') useUi.getState().selectHex(dropHex);
    return 'moved';
  }

  /** Center and zoom the view on the viewer's own PC token ("Go to me"). */
  centerOnMyToken(): void {
    if (!this.layout) return;
    const view = [...this.tokens.values()].find(
      (v) =>
        v.token.kind === 'pc' &&
        v.token.characterId !== null &&
        v.token.characterId === this.myCharacterId,
    );
    if (!view) {
      useSession.getState().pushToast({
        kind: 'info',
        title: 'No token',
        text: 'Your character has no token on this map.',
      });
      return;
    }
    const p = hexToPixel(this.layout, view.token);
    // Zoom so one hex reads comfortably regardless of the map's hex size.
    const scale = Math.min(Math.max(120 / (this.layout.size * 2), 0.3), 3);
    this.viewport.setZoom(scale, true);
    this.viewport.moveCenter(p.x, p.y);
    this.viewDirty = true;
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

// -- day/night tint ------------------------------------------------------------

/**
 * Tint color/alpha for the campaign clock: deep blue at night, a warm dusk/
 * dawn wash in the hour to either side of sunset/sunrise, nothing by day.
 */
function tintForClock(
  minutes: number,
  settings: Pick<CampaignSettings, 'sunriseHour' | 'sunsetHour'>,
): { color: number; alpha: number } | null {
  if (isNight(minutes, settings)) return { color: 0x1a2244, alpha: 0.28 };
  const sunrise = settings.sunriseHour ?? 6;
  const sunset = settings.sunsetHour ?? 20;
  const hour = (Math.max(0, Math.floor(minutes)) % MINUTES_PER_DAY) / 60;
  const inDusk = hour >= sunset - 1 && hour < sunset;
  const inDawn = hour >= sunrise && hour < sunrise + 1;
  if (inDusk || inDawn) return { color: 0xd9822b, alpha: 0.12 };
  return null;
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

/**
 * `shallowEqual` walks every key of the marker, so fields added to
 * `MarkerSchema` (playerPlaced / ownerSeatId, icon / scale) are diffed without
 * touching this comparator — unlike the explicit-field ones below.
 */
function markersEqual(a: Marker[], b: Marker[]): boolean {
  return a.length === b.length && a.every((m, i) => shallowEqual(m, b[i]!));
}

/** Party-note captions render on the map; keep them to a glance. */
function truncateLabel(label: string): string {
  return label.length > 24 ? label.slice(0, 23) + '…' : label;
}

/** Cheap identity for a content footprint, for the pin redraw diff. */
function areaKey(area: { q: number; r: number }[]): string {
  return area.map((c) => `${c.q},${c.r}`).join('|');
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
      c.showLabel === o.showLabel &&
      areaKey(c.area) === areaKey(o.area) &&
      ('enabled' in c ? c.enabled : true) === ('enabled' in o ? o.enabled : true) &&
      ('knownLocation' in c ? c.knownLocation : false) ===
        ('knownLocation' in o ? o.knownLocation : false)
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
    a.playerVisible !== b.playerVisible ||
    a.partyId !== b.partyId
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
