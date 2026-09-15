import { nanoid } from 'nanoid';
import type {
  ClientCommand,
  Clue,
  Content,
  HexCoord,
  InheritableMapField,
  LogEntry,
  MapInfo,
  Marker,
  Rng,
  Token,
} from '@hexcrawl/shared';
import {
  clueInRange,
  clueObserveSet,
  compassDirection,
  contentCells,
  contentCoversHex,
  distanceToContent,
  exploredPassable,
  findRoute,
  formatCalendarClock,
  formatDuration,
  GridStyleSchema,
  hexDistance,
  INHERITABLE_MAP_FIELDS,
  hexKey,
  hexLine,
  isNight,
  minutesPerHex,
  parseHexKey,
  resolveTravelMode,
  rollCheck,
  formatCheck,
} from '@hexcrawl/shared';
import type { FogState, TerrainId } from '@hexcrawl/shared';
import type { CampaignRuntime, SeatRecord } from '../state/runtime.js';
import type { Hub } from './hub.js';
import { applyAutoReveal } from '../engine/fog.js';
import { evaluateKnowledge, type NewDiscovery } from '../engine/knowledge.js';
import { evaluateTrails, trailBearings, type TrailFind } from '../engine/trails.js';
import { generateSettlementClues } from '../engine/settlements.js';
import { rollEncounter } from '../engine/encounters.js';
import { rerollWeatherForNewDay, setWeather, weatherLogText } from '../engine/weather.js';

export interface Ctx {
  runtime: CampaignRuntime;
  seat: SeatRecord;
  hub: Hub;
  rng: Rng;
}

type Handler = (cmd: never, ctx: Ctx) => void;

/**
 * Record an undoable cell operation (fog/terrain). Consecutive strokes of the
 * same kind within a short window merge into one entry, keeping the EARLIEST
 * prior value per cell — so one undo reverts a whole brush stroke or an
 * apply-to-entire-map, not just its last chunk.
 */
function recordCellUndo(
  ctx: Ctx,
  kind: 'fog' | 'terrain',
  mapId: string,
  changed: { q: number; r: number; prev: unknown }[],
): void {
  if (!changed.length) return;
  const top = ctx.runtime.undoStack[ctx.runtime.undoStack.length - 1];
  const now = Date.now();
  if (top && top.kind === kind && top.mapId === mapId && now - top.at < 3000 && top.restore) {
    for (const c of changed) {
      const key = hexKey(c.q, c.r);
      if (!top.restore.has(key)) top.restore.set(key, c.prev);
    }
    top.at = now;
    top.description = `${kind} change (${top.restore.size} hexes)`;
    return;
  }
  const restore = new Map<string, unknown>(changed.map((c) => [hexKey(c.q, c.r), c.prev]));
  ctx.runtime.pushUndo({
    at: now,
    kind,
    mapId,
    description: `${kind} change (${restore.size} hexes)`,
    restore,
    run: (runtime) => {
      if (kind === 'fog') {
        const byState = new Map<FogState, { q: number; r: number }[]>();
        for (const [key, prev] of restore) {
          const cell = parseHexKey(key);
          const list = byState.get(prev as FogState) ?? [];
          list.push(cell);
          byState.set(prev as FogState, list);
        }
        for (const [state, cells] of byState) runtime.setFog(mapId, cells, state);
      } else {
        const byTerrain = new Map<TerrainId | null, { q: number; r: number }[]>();
        for (const [key, prev] of restore) {
          const cell = parseHexKey(key);
          const list = byTerrain.get(prev as TerrainId | null) ?? [];
          list.push(cell);
          byTerrain.set(prev as TerrainId | null, list);
        }
        for (const [terrain, cells] of byTerrain) runtime.paintTerrain(mapId, cells, terrain);
      }
    },
  });
}

function requireDm(ctx: Ctx): void {
  if (ctx.seat.role !== 'dm') throw new Error('Only the DM can do that');
}

/**
 * Marker edit/delete authority (issue #74): the DM moderates anything; a
 * player may only touch a party note their own seat placed. Returns the
 * marker, or null when it is already gone (the DM's edits stay idempotent).
 */
function requireMarkerAccess(ctx: Ctx, markerId: string): Marker | null {
  const marker = ctx.runtime.findMarker(markerId);
  if (ctx.seat.role === 'dm') return marker;
  if (!marker) throw new Error('Marker not found');
  if (!marker.playerPlaced || marker.ownerSeatId !== ctx.seat.id) {
    throw new Error('You can only edit your own notes');
  }
  return marker;
}

/** Deliver freshly-created discoveries: toast to the owning player, entry in the DM feed. */
function deliverDiscoveries(ctx: Ctx, discoveries: NewDiscovery[]): void {
  for (const d of discoveries) {
    const character = ctx.runtime.characters.get(d.discovery.characterId);
    const ownerSeats = [...ctx.runtime.seats.values()]
      .filter((s) => s.characterId === d.discovery.characterId)
      .map((s) => s.id);
    const how = d.discovery.how;
    const howText =
      how.kind === 'passive'
        ? `passive ${how.skill} ${how.passive} vs DC ${how.dc} at ${how.distance} hex${how.distance === 1 ? '' : 'es'}`
        : how.kind === 'roll'
          ? `rolled ${how.skill} ${how.total} (d20 ${how.roll}${how.modifier >= 0 ? '+' : ''}${how.modifier}) vs DC ${how.dc}`
          : how.kind;
    ctx.runtime.appendLog(
      'discovery',
      `${d.characterName} discovered "${d.contentTitle}": ${d.clueText} (${howText})`,
      'dm',
      { contentId: d.contentId, clueId: d.discovery.clueId, characterId: d.discovery.characterId },
    );
    for (const seatId of ownerSeats) {
      ctx.runtime.appendLog(
        'discovery',
        `${character?.name ?? 'You'} noticed: ${d.clueText}`,
        seatId,
        { contentId: d.contentId },
      );
    }
    ctx.hub.sendTo(
      ctx.runtime,
      {
        type: 'event',
        kind: 'discovery.new',
        discovery: d.discovery,
        contentId: d.contentId,
        contentTitle: d.contentTitle,
        clueText: d.clueText,
        characterName: d.characterName,
      },
      { dm: true, seatIds: ownerSeats },
    );
  }
}

function notifyLog(ctx: Ctx, entry: LogEntry): void {
  const opts =
    entry.visibility === 'all'
      ? { all: true }
      : entry.visibility === 'dm'
        ? { dm: true }
        : { dm: true, seatIds: [entry.visibility] };
  ctx.hub.sendTo(ctx.runtime, { type: 'event', kind: 'log.appended', entry }, opts);
}

export const handlers: Record<ClientCommand['kind'], Handler> = {
  // -- campaign --------------------------------------------------------------
  'campaign.update': ((cmd: Extract<ClientCommand, { kind: 'campaign.update' }>, ctx: Ctx) => {
    requireDm(ctx);
    const wasPaused = ctx.runtime.campaign.settings.pausePlayerMapSync;
    ctx.runtime.updateCampaign({ name: cmd.name, settings: cmd.settings });
    // Changed map defaults flow straight into every map inheriting them.
    if (cmd.settings?.mapDefaults) {
      const changed = Object.keys(cmd.settings.mapDefaults).filter((f): f is InheritableMapField =>
        (INHERITABLE_MAP_FIELDS as readonly string[]).includes(f),
      );
      if (changed.length > 0) ctx.runtime.propagateMapDefaults(changed);
    }
    const nowPaused = ctx.runtime.campaign.settings.pausePlayerMapSync;
    // Entering prep mode freezes what players currently see; leaving it
    // releases the snapshot so the next sync shows everything at once.
    if (nowPaused && !wasPaused) ctx.runtime.capturePlayerFreeze();
    if (!nowPaused && wasPaused) ctx.runtime.clearPlayerFreeze();
  }) as Handler,

  /**
   * DM only: rotate an invite secret. Nothing player-visible changes, so the
   * Settings tab re-reads /api/campaigns/:id/keys after sending this.
   */
  'campaign.rotateKey': ((cmd: Extract<ClientCommand, { kind: 'campaign.rotateKey' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.rotateSecret(cmd.which);
  }) as Handler,

  // -- maps ------------------------------------------------------------------
  'map.create': ((cmd: Extract<ClientCommand, { kind: 'map.create' }>, ctx: Ctx) => {
    requireDm(ctx);
    // New maps start out following every campaign default; the DM unlinks
    // whichever settings should be map-specific (or just edits them).
    const map: MapInfo = {
      id: nanoid(10),
      name: cmd.name,
      orientation: cmd.orientation,
      hexSize: cmd.hexSize,
      originX: 0,
      originY: 0,
      gridStyle: GridStyleSchema.parse({}),
      ...ctx.runtime.mapDefaultsForNewMap(),
      sortOrder: ctx.runtime.maps.size,
      inheritedFields: [...INHERITABLE_MAP_FIELDS],
    };
    ctx.runtime.createMap(map);
    if (!ctx.runtime.campaign.activeMapId) ctx.runtime.setActiveMap(map.id);
  }) as Handler,

  'map.update': ((cmd: Extract<ClientCommand, { kind: 'map.update' }>, ctx: Ctx) => {
    requireDm(ctx);
    const map = ctx.runtime.maps.get(cmd.mapId);
    if (!map) throw new Error('Map not found');
    // Editing a field explicitly means this map now owns it: drop it from the
    // fields following the campaign defaults.
    const overridden = Object.keys(cmd.patch).filter((f) => map.inheritedFields.includes(f));
    const patch = cmd.patch as Partial<MapInfo>;
    ctx.runtime.updateMap(
      cmd.mapId,
      overridden.length > 0
        ? { ...patch, inheritedFields: map.inheritedFields.filter((f) => !overridden.includes(f)) }
        : patch,
    );
  }) as Handler,

  'map.setInherit': ((cmd: Extract<ClientCommand, { kind: 'map.setInherit' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.setMapInherit(cmd.mapId, cmd.field, cmd.inherit);
  }) as Handler,

  'map.delete': ((cmd: Extract<ClientCommand, { kind: 'map.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.deleteMap(cmd.mapId);
  }) as Handler,

  'map.setActive': ((cmd: Extract<ClientCommand, { kind: 'map.setActive' }>, ctx: Ctx) => {
    requireDm(ctx);
    if (!ctx.runtime.maps.has(cmd.mapId)) throw new Error('Map not found');
    ctx.runtime.setActiveMap(cmd.mapId);
  }) as Handler,

  // -- image layers ----------------------------------------------------------
  'imageLayer.update': ((cmd: Extract<ClientCommand, { kind: 'imageLayer.update' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.updateImageLayer(cmd.layerId, cmd.patch);
  }) as Handler,

  'imageLayer.delete': ((cmd: Extract<ClientCommand, { kind: 'imageLayer.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.deleteImageLayer(cmd.layerId);
  }) as Handler,

  // -- terrain & fog ---------------------------------------------------------
  'terrain.paint': ((cmd: Extract<ClientCommand, { kind: 'terrain.paint' }>, ctx: Ctx) => {
    requireDm(ctx);
    const changed = ctx.runtime.paintTerrain(cmd.mapId, cmd.cells, cmd.terrain);
    recordCellUndo(ctx, 'terrain', cmd.mapId, changed);
  }) as Handler,

  'fog.set': ((cmd: Extract<ClientCommand, { kind: 'fog.set' }>, ctx: Ctx) => {
    requireDm(ctx);
    const changed = ctx.runtime.setFog(cmd.mapId, cmd.cells, cmd.state);
    recordCellUndo(ctx, 'fog', cmd.mapId, changed);
  }) as Handler,

  // -- tokens ----------------------------------------------------------------
  'token.create': ((cmd: Extract<ClientCommand, { kind: 'token.create' }>, ctx: Ctx) => {
    requireDm(ctx);
    const token: Token = {
      id: nanoid(10),
      mapId: cmd.mapId,
      q: cmd.q,
      r: cmd.r,
      kind: cmd.tokenKind,
      characterId: cmd.characterId,
      label: cmd.label,
      color: cmd.color,
      glyph: cmd.glyph,
      playerVisible: cmd.playerVisible,
      partyId: null,
    };
    if (token.characterId) {
      const character = ctx.runtime.characters.get(token.characterId);
      if (!character) throw new Error('Character not found');
      if (!token.label) token.label = character.name;
      token.color = character.color;
      token.glyph = token.glyph || character.glyph;
    }
    ctx.runtime.createToken(token);
    // The first PC on the board establishes where "the party" stands, so
    // lingering time is credited from the moment they exist.
    if (token.kind === 'pc' && !ctx.runtime.campaign.time.partyHex) {
      const now = ctx.runtime.campaign.time.minutes;
      ctx.runtime.recordHexArrival(token.mapId, token.q, token.r, now);
      ctx.runtime.updateTime({
        partyHex: { mapId: token.mapId, q: token.q, r: token.r, arrivedMinutes: now },
      });
    }
    afterPartyMoved(ctx, cmd.mapId, token);
  }) as Handler,

  'token.update': ((cmd: Extract<ClientCommand, { kind: 'token.update' }>, ctx: Ctx) => {
    const token = ctx.runtime.findToken(cmd.tokenId);
    if (!token) throw new Error('Token not found');
    if (ctx.seat.role !== 'dm') {
      // Splitting the party (issue #124): a player may take their own
      // character out of the travel group, or rejoin it. Nothing else about a
      // token is theirs to edit.
      const keys = Object.keys(cmd.patch);
      const ownToken =
        token.kind === 'pc' && !!token.characterId && token.characterId === ctx.seat.characterId;
      if (!ownToken || keys.some((k) => k !== 'partyId')) {
        throw new Error('You can only change whether your own character travels with the party');
      }
    }
    ctx.runtime.updateToken(token.mapId, cmd.tokenId, cmd.patch);
  }) as Handler,

  'token.move': ((cmd: Extract<ClientCommand, { kind: 'token.move' }>, ctx: Ctx) => {
    const token = ctx.runtime.findToken(cmd.tokenId);
    if (!token) throw new Error('Token not found');
    const map = ctx.runtime.maps.get(token.mapId);
    if (!map) throw new Error('Map not found');
    if (ctx.seat.role !== 'dm') {
      if (token.kind !== 'pc' || !token.characterId || token.characterId !== ctx.seat.characterId) {
        throw new Error('You can only move your own character');
      }
    }
    if (ctx.seat.role !== 'dm' && map.moveApproval) {
      throw new Error('This map uses DM-approved movement — your move was sent as a request');
    }
    const teleport = cmd.teleport && ctx.seat.role === 'dm';
    const travel = travelPath(ctx, map, { q: token.q, r: token.r }, { q: cmd.q, r: cmd.r }, teleport);
    if (ctx.seat.role !== 'dm' && map.moveMode === 'step' && !travel.routed) {
      // One hex into the unknown; any distance across known ground (#130).
      const dist = hexDistance({ q: token.q, r: token.r }, { q: cmd.q, r: cmd.r });
      if (dist > 1) {
        throw new Error(
          map.routeExplored
            ? 'No explored route there — you can step one hex at a time into unexplored land'
            : 'You can only move one hex at a time',
        );
      }
    }
    performTravel(ctx, map, token, travel.path, { teleport, routed: travel.routed });
  }) as Handler,

  'move.request': ((cmd: Extract<ClientCommand, { kind: 'move.request' }>, ctx: Ctx) => {
    const token = ctx.runtime.findToken(cmd.tokenId);
    if (!token) throw new Error('Token not found');
    if (
      ctx.seat.role !== 'dm' &&
      (token.kind !== 'pc' || !token.characterId || token.characterId !== ctx.seat.characterId)
    ) {
      throw new Error('You can only move your own character');
    }
    const rt = ctx.runtime.requireMap(token.mapId);
    const map = ctx.runtime.maps.get(token.mapId);
    const travel = map
      ? travelPath(ctx, map, { q: token.q, r: token.r }, { q: cmd.q, r: cmd.r }, false)
      : null;
    rt.pendingMoves.set(token.id, {
      tokenId: token.id,
      fromQ: token.q,
      fromR: token.r,
      toQ: cmd.q,
      toR: cmd.r,
      seatId: ctx.seat.id,
      label: token.label || 'token',
      color: token.color,
      at: Date.now(),
      routeHexes: travel?.routed ? travel.path.length - 1 : null,
    });
    ctx.hub.sendTo(
      ctx.runtime,
      { type: 'event', kind: 'move.requested', tokenId: token.id, label: token.label || 'token', q: cmd.q, r: cmd.r },
      { dm: true },
    );
  }) as Handler,

  'move.resolve': ((cmd: Extract<ClientCommand, { kind: 'move.resolve' }>, ctx: Ctx) => {
    requireDm(ctx);
    const token = ctx.runtime.findToken(cmd.tokenId);
    if (!token) throw new Error('Token not found');
    const rt = ctx.runtime.requireMap(token.mapId);
    const pending = rt.pendingMoves.get(cmd.tokenId);
    if (!pending) throw new Error('No pending move for that token');
    rt.pendingMoves.delete(cmd.tokenId);
    if (cmd.approve) {
      const map = ctx.runtime.maps.get(token.mapId);
      if (!map) throw new Error('Map not found');
      const to = { q: pending.toQ, r: pending.toR };
      const travel = travelPath(ctx, map, { q: token.q, r: token.r }, to, cmd.teleport);
      performTravel(ctx, map, token, travel.path, {
        teleport: cmd.teleport,
        approved: true,
        routed: travel.routed,
      });
    }
    ctx.hub.sendTo(
      ctx.runtime,
      { type: 'event', kind: 'move.resolved', tokenId: token.id, label: pending.label, approved: cmd.approve },
      { all: true },
    );
  }) as Handler,

  'token.delete': ((cmd: Extract<ClientCommand, { kind: 'token.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    const token = ctx.runtime.findToken(cmd.tokenId);
    if (!token) return;
    ctx.runtime.requireMap(token.mapId).pendingMoves.delete(cmd.tokenId);
    ctx.runtime.deleteToken(token.mapId, cmd.tokenId);
    const map = ctx.runtime.maps.get(token.mapId);
    if (map) applyAutoReveal(ctx.runtime, map);
  }) as Handler,

  // -- markers ---------------------------------------------------------------
  // Players may drop party notes (issue #74): always party-visible, owned by
  // the placing seat. Only the DM can place DM-only / unowned markers.
  'marker.place': ((cmd: Extract<ClientCommand, { kind: 'marker.place' }>, ctx: Ctx) => {
    const isDm = ctx.seat.role === 'dm';
    const marker = {
      ...cmd.marker,
      id: nanoid(10),
      playerPlaced: isDm ? (cmd.marker.playerPlaced ?? false) : true,
      ownerSeatId: isDm ? (cmd.marker.ownerSeatId ?? null) : ctx.seat.id,
      dmOnly: isDm ? cmd.marker.dmOnly : false,
      // Sticker fields are optional on the wire (CommandInput gotcha).
      icon: cmd.marker.icon ?? '',
      scale: cmd.marker.scale ?? 1,
    };
    ctx.runtime.placeMarker(marker);
  }) as Handler,

  'marker.update': ((cmd: Extract<ClientCommand, { kind: 'marker.update' }>, ctx: Ctx) => {
    if (!requireMarkerAccess(ctx, cmd.markerId)) return;
    // A player editing their own note cannot hide it from the party.
    const patch = ctx.seat.role === 'dm' ? cmd.patch : { ...cmd.patch, dmOnly: false };
    ctx.runtime.updateMarker(cmd.markerId, patch);
  }) as Handler,

  'marker.delete': ((cmd: Extract<ClientCommand, { kind: 'marker.delete' }>, ctx: Ctx) => {
    if (!requireMarkerAccess(ctx, cmd.markerId)) return;
    const removed = ctx.runtime.deleteMarker(cmd.markerId);
    if (removed) {
      ctx.runtime.pushUndo({
        at: Date.now(),
        kind: 'marker.delete',
        description: `restore ${removed.glyph} marker`,
        run: (runtime) => runtime.placeMarker(removed),
      });
    }
  }) as Handler,

  // -- characters & seats ----------------------------------------------------
  'character.create': ((cmd: Extract<ClientCommand, { kind: 'character.create' }>, ctx: Ctx) => {
    ctx.runtime.upsertCharacter({ ...cmd.character, id: nanoid(10) });
  }) as Handler,

  'character.update': ((cmd: Extract<ClientCommand, { kind: 'character.update' }>, ctx: Ctx) => {
    const existing = ctx.runtime.characters.get(cmd.characterId);
    if (!existing) throw new Error('Character not found');
    if (ctx.seat.role !== 'dm' && ctx.seat.characterId !== cmd.characterId) {
      throw new Error('You can only edit your own character');
    }
    // `extra` is a sub-object: merge over the existing value so a one-field
    // patch (e.g. just `notes`) doesn't blank out its siblings.
    const extra = cmd.patch.extra ? { ...existing.extra, ...cmd.patch.extra } : existing.extra;
    ctx.runtime.upsertCharacter({ ...existing, ...cmd.patch, id: existing.id, extra });
    // Skill changes can open passive gates anywhere the character stands.
    const discoveries = ctx.runtime.campaign.activeMapId
      ? evaluateKnowledge(ctx.runtime, ctx.runtime.campaign.activeMapId, [cmd.characterId])
      : [];
    deliverDiscoveries(ctx, discoveries);
  }) as Handler,

  'character.delete': ((cmd: Extract<ClientCommand, { kind: 'character.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.deleteCharacter(cmd.characterId);
  }) as Handler,

  'seat.claimCharacter': ((cmd: Extract<ClientCommand, { kind: 'seat.claimCharacter' }>, ctx: Ctx) => {
    ctx.runtime.claimCharacter(ctx.seat.id, cmd.characterId);
  }) as Handler,

  'seat.rename': ((cmd: Extract<ClientCommand, { kind: 'seat.rename' }>, ctx: Ctx) => {
    ctx.runtime.renameSeat(ctx.seat.id, cmd.name);
  }) as Handler,

  'seat.releaseCharacter': ((cmd: Extract<ClientCommand, { kind: 'seat.releaseCharacter' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.claimCharacter(cmd.seatId, null);
  }) as Handler,

  'seat.delete': ((cmd: Extract<ClientCommand, { kind: 'seat.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    if (cmd.seatId === ctx.seat.id) throw new Error('You cannot remove your own seat');
    ctx.runtime.deleteSeat(cmd.seatId);
    ctx.hub.dropSeat(ctx.runtime, cmd.seatId);
  }) as Handler,

  // -- content & clues -------------------------------------------------------
  'content.upsert': ((cmd: Extract<ClientCommand, { kind: 'content.upsert' }>, ctx: Ctx) => {
    requireDm(ctx);
    const id = cmd.content.id ?? nanoid(10);
    // An omitted area MERGES with what's stored: senders that predate
    // footprints (the pin popup's quick toggles) must not wipe a painted
    // region. Clearing an area sends an explicit empty list.
    const prior = ctx.runtime.mapStates.get(cmd.content.mapId)?.contents.get(id);
    const content: Content = {
      id,
      mapId: cmd.content.mapId,
      q: cmd.content.q,
      r: cmd.content.r,
      area: cmd.content.area ?? prior?.area ?? [],
      observeFrom: cmd.content.observeFrom ?? prior?.observeFrom ?? [],
      type: cmd.content.type,
      title: cmd.content.title,
      dmNotes: cmd.content.dmNotes,
      glyph: cmd.content.glyph,
      showLabel: cmd.content.showLabel ?? false,
      scaleVisibility: cmd.content.scaleVisibility ?? 1,
      wikiPage: cmd.content.wikiPage ?? '',
      enabled: cmd.content.enabled ?? true,
      knownLocation: cmd.content.knownLocation ?? false,
      quest: cmd.content.quest ?? '',
      clues: cmd.content.clues.map((c, i) => ({
        id: c.id ?? nanoid(10),
        contentId: id,
        text: c.text,
        gate: c.gate,
        sortOrder: i,
        indicatesDirection: c.indicatesDirection ?? false,
        revealsLocation: c.revealsLocation ?? true,
        observeFrom: c.observeFrom ?? [],
      })),
    };
    ctx.runtime.upsertContent(content);
    deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, content.mapId));
  }) as Handler,

  'content.setEnabled': ((cmd: Extract<ClientCommand, { kind: 'content.setEnabled' }>, ctx: Ctx) => {
    requireDm(ctx);
    const prior: { content: Content; enabled: boolean }[] = [];
    const touchedMaps = new Set<string>();
    for (const id of cmd.contentIds) {
      let found: Content | null = null;
      for (const rt of ctx.runtime.mapStates.values()) {
        const c = rt.contents.get(id);
        if (c) { found = c; break; }
      }
      if (!found || found.enabled === cmd.enabled) continue;
      prior.push({ content: found, enabled: found.enabled });
      ctx.runtime.upsertContent({ ...found, enabled: cmd.enabled });
      touchedMaps.add(found.mapId);
    }
    if (prior.length) {
      ctx.runtime.pushUndo({
        at: Date.now(),
        kind: 'content.setEnabled',
        description: `${cmd.enabled ? 'disable' : 'enable'} ${prior.length} item(s) again`,
        run: (runtime) => {
          for (const p of prior) {
            const current = runtime.mapStates.get(p.content.mapId)?.contents.get(p.content.id);
            if (current) runtime.upsertContent({ ...current, enabled: p.enabled });
          }
        },
      });
      // Newly-enabled content may open clues immediately.
      if (cmd.enabled) {
        for (const mapId of touchedMaps) {
          deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, mapId));
        }
      }
    }
  }) as Handler,

  'content.setQuest': ((cmd: Extract<ClientCommand, { kind: 'content.setQuest' }>, ctx: Ctx) => {
    requireDm(ctx);
    for (const id of cmd.contentIds) {
      for (const rt of ctx.runtime.mapStates.values()) {
        const c = rt.contents.get(id);
        if (c) { ctx.runtime.upsertContent({ ...c, quest: cmd.quest }); break; }
      }
    }
  }) as Handler,

  'content.move': ((cmd: Extract<ClientCommand, { kind: 'content.move' }>, ctx: Ctx) => {
    requireDm(ctx);
    let found: Content | null = null;
    for (const rt of ctx.runtime.mapStates.values()) {
      const c = rt.contents.get(cmd.contentId);
      if (c) { found = c; break; }
    }
    if (!found) throw new Error('Content not found');
    const prev = { ...found };
    ctx.runtime.upsertContent({ ...found, q: cmd.q, r: cmd.r });
    ctx.runtime.pushUndo({
      at: Date.now(),
      kind: 'content.move',
      description: `move "${found.title}" back`,
      run: (runtime) => runtime.upsertContent(prev),
    });
    deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, found.mapId));
  }) as Handler,

  /**
   * Region brush strokes (issue #108): a delta on one content item's
   * footprint. Add/remove merge into the stored area by hex key, the anchor
   * is never stored (it's an implicit member, and removing it is a no-op),
   * and growing a footprint re-runs the knowledge engine — a party standing
   * where the region just spread has now "entered" it.
   */
  'content.area': ((cmd: Extract<ClientCommand, { kind: 'content.area' }>, ctx: Ctx) => {
    requireDm(ctx);
    let found: Content | null = null;
    for (const rt of ctx.runtime.mapStates.values()) {
      const c = rt.contents.get(cmd.contentId);
      if (c) { found = c; break; }
    }
    if (!found) throw new Error('Content not found');
    const anchorKey = hexKey(found.q, found.r);
    const cells = new Map<string, { q: number; r: number }>();
    for (const cell of found.area) cells.set(hexKey(cell.q, cell.r), { q: cell.q, r: cell.r });
    for (const cell of cmd.add ?? []) {
      const key = hexKey(cell.q, cell.r);
      if (key === anchorKey) continue; // the anchor is always a member
      cells.set(key, { q: cell.q, r: cell.r });
    }
    for (const cell of cmd.remove ?? []) cells.delete(hexKey(cell.q, cell.r));
    const area = [...cells.values()];
    const priorArea = found.area;
    if (area.length === priorArea.length && area.every((c, i) => {
      const p = priorArea[i];
      return p && p.q === c.q && p.r === c.r;
    })) {
      return; // stroke changed nothing (repainting hexes already in the area)
    }
    const mapId = found.mapId;
    const title = found.title;
    ctx.runtime.upsertContent({ ...found, area });
    // One drag is one undo. A stroke flushes several times on its way across
    // the map, so consecutive deltas on the same region within a short window
    // merge — keeping the EARLIEST area, the one the drag started from.
    const now = Date.now();
    const top = ctx.runtime.undoStack[ctx.runtime.undoStack.length - 1];
    if (
      top &&
      top.kind === 'content.area' &&
      top.mapId === mapId &&
      now - top.at < 3000 &&
      top.restore?.has(cmd.contentId)
    ) {
      top.at = now;
    } else {
      const restore = new Map<string, unknown>([[cmd.contentId, priorArea]]);
      ctx.runtime.pushUndo({
        at: now,
        kind: 'content.area',
        mapId,
        description: `restore the area of "${title}"`,
        restore,
        run: (runtime) => {
          for (const [contentId, priorCells] of restore) {
            const current = runtime.mapStates.get(mapId)?.contents.get(contentId);
            if (current) {
              runtime.upsertContent({ ...current, area: priorCells as { q: number; r: number }[] });
            }
          }
        },
      });
    }
    // A grown footprint can open entering-the-region gates for whoever is
    // already standing there; a shrunk one costs nothing to re-evaluate.
    deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, found.mapId));
  }) as Handler,

  /**
   * Terrain fill across a region's footprint (issue #113). The overlap policy
   * is the interesting part: with `skipOtherRegions` (the default) a hex that
   * also belongs to another region's footprint keeps its terrain, so filling
   * "The Greenwood" never repaints the villages inside it. Only real regions
   * block — a plain single-hex pin has no area, and a landmark sitting in the
   * woods should be painted with the woods.
   *
   * Undo rides the shared terrain mechanism, so a fill merges with adjacent
   * brush strokes exactly like another stroke would.
   */
  'content.applyTerrain': ((
    cmd: Extract<ClientCommand, { kind: 'content.applyTerrain' }>,
    ctx: Ctx,
  ) => {
    requireDm(ctx);
    let found: Content | null = null;
    for (const rt of ctx.runtime.mapStates.values()) {
      const c = rt.contents.get(cmd.contentId);
      if (c) { found = c; break; }
    }
    if (!found) throw new Error('Content not found');
    const skip = cmd.skipOtherRegions ?? true;
    const footprint = contentCells(found);
    const blocked = new Set<string>();
    if (skip) {
      for (const other of ctx.runtime.requireMap(found.mapId).contents.values()) {
        if (other.id === found.id || other.area.length === 0) continue;
        for (const cell of contentCells(other)) blocked.add(hexKey(cell.q, cell.r));
      }
    }
    const target = footprint.filter((c) => !blocked.has(hexKey(c.q, c.r)));
    const skipped = footprint.length - target.length;
    const changed = ctx.runtime.paintTerrain(found.mapId, target, cmd.terrain);
    recordCellUndo(ctx, 'terrain', found.mapId, changed);
    const what = cmd.terrain === null ? 'Erased terrain' : `Painted ${cmd.terrain}`;
    const entry = ctx.runtime.appendLog(
      'note',
      `${what} across ${found.title} — ${target.length} hex${target.length === 1 ? '' : 'es'}` +
        (skipped > 0 ? ` (${skipped} skipped in other regions)` : ''),
      'dm',
      { contentId: found.id },
    );
    notifyLog(ctx, entry);
  }) as Handler,

  'view.map': ((_cmd: Extract<ClientCommand, { kind: 'view.map' }>, _ctx: Ctx) => {
    // Handled at the connection layer (per-connection state); never dispatched.
    throw new Error('view.map is connection-scoped');
  }) as Handler,

  'trail.upsert': ((cmd: Extract<ClientCommand, { kind: 'trail.upsert' }>, ctx: Ctx) => {
    requireDm(ctx);
    const trail = { ...cmd.trail, id: cmd.trail.id ?? nanoid(10) };
    if (!ctx.runtime.maps.has(trail.mapId)) throw new Error('Map not found');
    ctx.runtime.upsertTrail(trail);
    deliverTrailFinds(ctx, evaluateTrails(ctx.runtime, trail.mapId));
  }) as Handler,

  'trail.delete': ((cmd: Extract<ClientCommand, { kind: 'trail.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    const trail = ctx.runtime.findTrail(cmd.trailId);
    if (trail) ctx.runtime.deleteTrail(trail.mapId, cmd.trailId);
  }) as Handler,

  'clues.generateSettlements': ((
    cmd: Extract<ClientCommand, { kind: 'clues.generateSettlements' }>,
    ctx: Ctx,
  ) => {
    requireDm(ctx);
    const touched = generateSettlementClues(ctx.runtime, cmd.mapId);
    if (touched.length) {
      ctx.runtime.pushUndo({
        at: Date.now(),
        kind: 'clues.generate',
        description: `remove generated clues from ${touched.length} settlement(s)`,
        run: (runtime) => {
          for (const t of touched) {
            const current = runtime.mapStates.get(cmd.mapId)?.contents.get(t.content.id);
            if (current) runtime.upsertContent({ ...current, clues: t.priorClues });
          }
        },
      });
      deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, cmd.mapId));
    }
    const entry = ctx.runtime.appendLog(
      'note',
      `Generated sensory clues for ${touched.length} settlement(s).`,
      'dm',
    );
    notifyLog(ctx, entry);
  }) as Handler,

  'content.delete': ((cmd: Extract<ClientCommand, { kind: 'content.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    const removed = ctx.runtime.deleteContent(cmd.contentId);
    if (removed) {
      ctx.runtime.pushUndo({
        at: Date.now(),
        kind: 'content.delete',
        description: `restore "${removed.title}"`,
        run: (runtime) => runtime.upsertContent(removed),
      });
    }
  }) as Handler,

  'clue.reveal': ((cmd: Extract<ClientCommand, { kind: 'clue.reveal' }>, ctx: Ctx) => {
    requireDm(ctx);
    const content = ctx.runtime.findContentByClue(cmd.clueId);
    if (!content) throw new Error('Clue not found');
    const clue = content.clues.find((c) => c.id === cmd.clueId)!;
    const targets = cmd.characterIds.length
      ? cmd.characterIds
      : [...ctx.runtime.characters.keys()];
    const created: NewDiscovery[] = [];
    for (const characterId of targets) {
      const character = ctx.runtime.characters.get(characterId);
      if (!character || ctx.runtime.hasDiscovery(cmd.clueId, characterId)) continue;
      const discovery = {
        id: nanoid(12),
        clueId: cmd.clueId,
        characterId,
        at: Date.now(),
        how: { kind: 'manual' as const },
        direction: clueDirectionFor(ctx, clue, content, characterId),
        // A deliberate DM reveal locates unless the clue is info-only.
        locates: clue.revealsLocation,
      };
      if (ctx.runtime.addDiscovery(discovery)) {
        created.push({
          discovery,
          contentId: content.id,
          contentTitle: content.title,
          clueText: clue.text,
          characterName: character.name,
        });
      }
    }
    deliverDiscoveries(ctx, created);
  }) as Handler,

  'discovery.revoke': ((cmd: Extract<ClientCommand, { kind: 'discovery.revoke' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.revokeDiscovery(cmd.discoveryId);
  }) as Handler,

  'clue.share': ((cmd: Extract<ClientCommand, { kind: 'clue.share' }>, ctx: Ctx) => {
    const characterId = ctx.seat.characterId;
    if (!characterId) throw new Error('Claim a character first');
    const content = ctx.runtime.findContentByClue(cmd.clueId);
    if (!content) throw new Error('Clue not found');
    const clue = content.clues.find((c) => c.id === cmd.clueId)!;
    const mine = [...ctx.runtime.discoveries.values()].find(
      (d) => d.clueId === cmd.clueId && d.characterId === characterId,
    );
    if (!mine) throw new Error('You can only share clues your character has discovered');
    const sharer = ctx.runtime.characters.get(characterId);
    let shared = 0;
    for (const other of ctx.runtime.characters.values()) {
      if (other.id === characterId) continue;
      const added = ctx.runtime.addDiscovery({
        id: nanoid(12),
        clueId: cmd.clueId,
        characterId: other.id,
        at: Date.now(),
        how: { kind: 'shared', fromCharacterId: characterId },
        // Passing on the knowledge passes on what the sharer knew of it.
        direction: mine.direction,
        locates: mine.locates,
      });
      if (added) shared++;
    }
    const entry = ctx.runtime.appendLog(
      'share',
      `${sharer?.name ?? 'Someone'} shared with the party: ${clue.text}`,
      'all',
      { clueId: cmd.clueId, contentId: content.id, fromCharacterId: characterId, newlyShared: shared },
    );
    notifyLog(ctx, entry);
  }) as Handler,

  // -- checks ----------------------------------------------------------------
  'check.roll': ((cmd: Extract<ClientCommand, { kind: 'check.roll' }>, ctx: Ctx) => {
    const settings = ctx.runtime.campaign.settings;
    const dmRoll = ctx.seat.role === 'dm';
    let targets = cmd.characterIds;
    if (!dmRoll) {
      // Players roll for their own character only.
      if (!ctx.seat.characterId) throw new Error('Claim a character first');
      targets = [ctx.seat.characterId];
    }
    const mapId = cmd.mapId ?? ctx.runtime.campaign.activeMapId;
    const rt = mapId ? ctx.runtime.mapStates.get(mapId) : null;
    const map = mapId ? ctx.runtime.maps.get(mapId) : null;
    if (!targets.length) {
      targets = rt
        ? [...rt.tokens.values()]
            .filter((t) => t.kind === 'pc' && t.characterId)
            .map((t) => t.characterId!)
        : [];
    }
    // "Proficient only" (issue #129): a DM group roll can skip the
    // characters who never trained the skill.
    if (cmd.proficientOnly) {
      targets = targets.filter((id) =>
        ctx.runtime.characters.get(id)?.proficiencies.includes(cmd.skill),
      );
      if (!targets.length) throw new Error(`Nobody here is proficient in ${cmd.skill}`);
    }
    const extras = cmd.extras ?? [];
    const advantage = cmd.advantage ?? 'none';
    // Where each character stands, so a sheet roll is still "a roll made
    // here" in the hex's history (issue #129).
    const positions = new Map<string, { q: number; r: number }>();
    if (rt) {
      for (const t of rt.tokens.values()) {
        if (t.kind === 'pc' && t.characterId) positions.set(t.characterId, { q: t.q, r: t.r });
      }
    }
    // A character's FIRST roll of a skill on a hex is the one that counts for
    // clues (issue #107). Rolling again is allowed (issue #129) — the table
    // often just needs dice — but a re-roll is dice only: no attempt row, no
    // gate evaluation, and the log says so. The DM's rolls always count.
    const counting = new Set<string>();
    if (cmd.hex && cmd.mapId) {
      for (const characterId of targets) {
        const prior = ctx.runtime.findSearchAttempt(
          cmd.mapId,
          cmd.hex.q,
          cmd.hex.r,
          characterId,
          cmd.skill,
        );
        if (!prior || dmRoll) counting.add(characterId);
      }
    }
    const results = targets
      .map((characterId) => {
        const character = ctx.runtime.characters.get(characterId);
        if (!character) return null;
        const modifier = character.skills[cmd.skill] ?? 0;
        const r = rollCheck({ modifier, extras, advantage }, ctx.rng);
        return {
          characterId,
          name: character.name,
          roll: r.roll,
          modifier,
          total: r.total,
          detail: r.detail,
          success: cmd.dc !== null ? r.total >= cmd.dc : null,
          hex: positions.get(characterId) ?? null,
          counts: cmd.hex ? counting.has(characterId) : true,
        };
      })
      .filter((r) => r !== null);
    // Hex-targeted search: the roll is compared against the clue gates of
    // content on that hex. A matching-skill clue opens when the character is
    // within the gate's range and the roll beats the clue's own DC (active
    // and passive gates alike — a deliberate search can find what passive
    // senses missed).
    let found = 0;
    let pending = 0;
    if (cmd.hex && cmd.mapId && rt && map) {
      const created: NewDiscovery[] = [];
      // Every counting roll is written down, DM- or player-initiated: the
      // DM's investigation view is a history of who tried what, not just of
      // what is still outstanding.
      const attempts = new Map<string, string>();
      for (const r of results) {
        if (!r.counts) continue;
        attempts.set(
          r.characterId,
          ctx.runtime.recordSearchAttempt({
            id: nanoid(12),
            mapId: cmd.mapId,
            q: cmd.hex.q,
            r: cmd.hex.r,
            characterId: r.characterId,
            skill: cmd.skill,
            roll: r.roll,
            modifier: r.modifier,
            total: r.total,
            at: Date.now(),
            detail: r.detail,
          }).id,
        );
      }
      for (const r of results) {
        if (!r.counts) continue;
        const token = [...rt.tokens.values()].find(
          (t) => t.kind === 'pc' && t.characterId === r.characterId,
        );
        if (!token) continue;
        const character = ctx.runtime.characters.get(r.characterId)!;
        for (const content of rt.contents.values()) {
          if (!content.enabled) continue;
          // A search on ANY hex of a region's footprint searches the region;
          // a search on one of a clue's vantage hexes (#123) searches for
          // what can be seen from there.
          const covers = contentCoversHex(content, cmd.hex);
          const distance = distanceToContent(content, { q: token.q, r: token.r });
          for (const clue of content.clues) {
            if (clue.gate.kind !== 'skill' || clue.gate.skill !== cmd.skill) continue;
            const vantage = clueObserveSet(clue, content);
            if (!covers && !vantage?.some((v) => v.q === cmd.hex!.q && v.r === cmd.hex!.r)) continue;
            if (!clueInRange(clue, content, { q: token.q, r: token.r })) continue;
            if (r.total < clue.gate.dc) continue;
            if (ctx.runtime.hasDiscovery(clue.id, r.characterId)) continue;
            const direction =
              clue.indicatesDirection && distance > 0
                ? compassDirection({ q: token.q, r: token.r }, cmd.hex, map.orientation)
                : null;
            const locates = distance === 0 && clue.revealsLocation;
            // A player's success is a proposal, not a reveal (issue #107):
            // the DM decides whether the character actually finds it. The
            // bearing and locates flag are frozen here, at roll time, so the
            // approval describes what they saw from where they stood.
            if (!dmRoll) {
              if (
                ctx.runtime.addPendingReveal({
                  id: nanoid(12),
                  clueId: clue.id,
                  characterId: r.characterId,
                  attemptId: attempts.get(r.characterId) ?? '',
                  direction,
                  locates,
                  roll: r.roll,
                  modifier: r.modifier,
                  total: r.total,
                  at: Date.now(),
                })
              ) {
                pending++;
              }
              continue;
            }
            const discovery = {
              id: nanoid(12),
              clueId: clue.id,
              characterId: r.characterId,
              at: Date.now(),
              how: {
                kind: 'roll' as const,
                skill: cmd.skill,
                roll: r.roll,
                modifier: r.modifier,
                total: r.total,
                dc: clue.gate.dc,
              },
              direction,
              locates,
            };
            if (ctx.runtime.addDiscovery(discovery)) {
              created.push({
                discovery,
                contentId: content.id,
                contentTitle: content.title,
                clueText: clue.text,
                characterName: character.name,
              });
            }
          }
        }
      }
      // Trails: a search can also spot trail cells on the hex (any skill
      // gate, active included) when the roll beats the gate's DC.
      const trailFinds: TrailFind[] = [];
      for (const r of results) {
        if (!r.counts) continue;
        const token = [...rt.tokens.values()].find(
          (t) => t.kind === 'pc' && t.characterId === r.characterId,
        );
        if (!token) continue;
        const character = ctx.runtime.characters.get(r.characterId)!;
        for (const trail of rt.trails.values()) {
          if (trail.gate.kind !== 'skill' || trail.gate.skill !== cmd.skill) continue;
          for (let i = 0; i < trail.cells.length; i++) {
            const cell = trail.cells[i]!;
            if (cell.q !== cmd.hex.q || cell.r !== cmd.hex.r) continue;
            const distance = hexDistance({ q: token.q, r: token.r }, cell);
            if (distance > trail.gate.maxDistance) continue;
            if (r.total < trail.gate.dc) continue;
            if (
              ctx.runtime.addTrailDiscovery({
                id: nanoid(12),
                trailId: trail.id,
                cellIndex: i,
                characterId: r.characterId,
                at: Date.now(),
              })
            ) {
              trailFinds.push({
                trailId: trail.id,
                characterId: r.characterId,
                characterName: character.name,
                q: cell.q,
                r: cell.r,
                ...trailBearings(trail, i, map.orientation),
              });
            }
          }
        }
      }
      deliverTrailFinds(ctx, trailFinds);
      found = created.length + trailFinds.length;
      deliverDiscoveries(ctx, created);
      if (pending > 0) {
        // Nudge the DM: results are sitting in Inspect waiting on them.
        ctx.hub.sendTo(
          ctx.runtime,
          {
            type: 'event',
            kind: 'search.pending',
            characterName: results.map((r) => r.name).join(', '),
            skill: cmd.skill,
            total: Math.max(...results.map((r) => r.total)),
            q: cmd.hex.q,
            r: cmd.hex.r,
            count: pending,
          },
          { dm: true },
        );
      }
    }
    const summary = results
      .map(
        (r) =>
          `${r.name}: ${r.total} (${formatCheck(r)})${
            r.success === null ? '' : r.success ? ' ✓' : ' ✗'
          }${cmd.hex && !r.counts ? ' · re-roll' : ''}`,
      )
      .join(' · ');
    const where = cmd.hex ? ` on hex ${cmd.hex.q},${cmd.hex.r}` : '';
    const trimmings = [
      advantage !== 'none' ? advantage : null,
      ...extras.map((x) => `${x.sign < 0 ? '−' : '+'}${x.sides ? `${x.amount}d${x.sides}` : x.amount}${x.label ? ` ${x.label}` : ''}`),
    ].filter(Boolean);
    const headline = `${capitalize(cmd.skill)}${cmd.dc !== null ? ` DC ${cmd.dc}` : ''}${where}${
      trimmings.length ? ` [${trimmings.join(', ')}]` : ''
    }: ${summary || 'no targets'}`;
    const rolled = new Set(results.map((r) => r.characterId));
    const ownerSeats = [...ctx.runtime.seats.values()]
      .filter((s) => s.characterId && rolled.has(s.characterId))
      .map((s) => s.id);
    // Sheet rolls carry the hex the character stood on, so a hex's history
    // (issue #129) lists them alongside searches.
    const sameHex =
      results.length > 0 && results.every((r) => r.hex && results[0]!.hex && r.hex.q === results[0]!.hex.q && r.hex.r === results[0]!.hex.r)
        ? results[0]!.hex
        : null;
    const data = {
      skill: cmd.skill,
      dc: cmd.dc,
      results,
      hex: cmd.hex ?? sameHex,
      mapId: mapId ?? null,
      search: cmd.hex !== null,
      advantage,
      extras,
    };
    // A player's own visibility: 'all' means "the table, per the campaign's
    // roll-visibility setting"; a secret roll goes to their seat and the DM.
    const playerVisibility = cmd.secret ? ctx.seat.id : 'all';
    const notifyPlayers = (entry: LogEntry) => {
      if (entry.visibility === 'all' && settings.rollVisibility === 'all') {
        notifyLog(ctx, entry);
      } else if (entry.visibility === 'all') {
        // A character's rolls are theirs alone: notify only the seats owning
        // a character that rolled (the snapshot filter applies the same rule).
        ctx.hub.sendTo(ctx.runtime, { type: 'event', kind: 'log.appended', entry }, { dm: true, seatIds: ownerSeats });
      } else {
        notifyLog(ctx, entry);
      }
    };

    // A player's hex search gets TWO entries (issue #107). The outcome string
    // is baked into `text`, and one row cannot say different things to
    // different readers — so the DM's row carries the full accounting (what
    // opened, what is waiting on them) and the player's row says only that
    // the DM will narrate. Counts of found/not-found never reach a player:
    // "nothing new found" is itself information about the hex.
    if (!dmRoll && cmd.hex) {
      const counted = results.some((r) => r.counts);
      const dmOutcome = [
        found ? `${found} clue(s) uncovered` : null,
        pending ? `${pending} awaiting your approval` : null,
        !counted ? 'a re-roll — the first roll here is the one that counts' : null,
      ]
        .filter(Boolean)
        .join(', ');
      const dmEntry = ctx.runtime.appendLog('check', `${headline} — ${dmOutcome || 'nothing found'}`, 'dm', {
        ...data,
        pending,
      });
      ctx.hub.sendTo(ctx.runtime, { type: 'event', kind: 'log.appended', entry: dmEntry }, { dm: true });
      const playerEntry = ctx.runtime.appendLog(
        'check',
        `${headline} — ${counted ? 'the DM will describe what you find' : 're-rolled for the table; your first roll here is the one that counts'}`,
        playerVisibility,
        data,
      );
      notifyPlayers(playerEntry);
      return;
    }

    const outcome = cmd.hex ? (found ? ` — ${found} clue(s) uncovered` : ' — nothing new found') : '';
    const entry = ctx.runtime.appendLog(
      'check',
      `${headline}${outcome}`,
      dmRoll ? 'dm' : playerVisibility,
      data,
    );
    notifyPlayers(entry);
  }) as Handler,

  /**
   * The DM's call on pending search results (issue #107). Approving runs them
   * through the normal discovery path — same toast, same log lines, same
   * senses — so an approved find is indistinguishable from an instant one.
   */
  'search.resolve': ((cmd: Extract<ClientCommand, { kind: 'search.resolve' }>, ctx: Ctx) => {
    requireDm(ctx);
    const created: NewDiscovery[] = [];
    let withheld = 0;
    let hex: { q: number; r: number } | null = null;
    for (const pendingId of cmd.pendingIds) {
      const pending = ctx.runtime.pendingReveals.get(pendingId);
      if (!pending) continue;
      const attempt = ctx.runtime.getSearchAttempt(pending.attemptId);
      if (attempt) hex = { q: attempt.q, r: attempt.r };
      if (!cmd.approve) {
        ctx.runtime.deletePendingReveal(pendingId);
        withheld++;
        continue;
      }
      const content = ctx.runtime.findContentByClue(pending.clueId);
      const clue = content?.clues.find((c) => c.id === pending.clueId);
      // The clue went away under the DM's feet: drop the stale row.
      if (!content || !clue) {
        ctx.runtime.deletePendingReveal(pendingId);
        continue;
      }
      const character = ctx.runtime.characters.get(pending.characterId);
      const discovery = {
        id: nanoid(12),
        clueId: pending.clueId,
        characterId: pending.characterId,
        at: Date.now(),
        how: {
          kind: 'roll' as const,
          skill: attempt?.skill ?? 'search',
          roll: pending.roll,
          modifier: pending.modifier,
          total: pending.total,
          dc: clue.gate.kind === 'skill' ? clue.gate.dc : 0,
        },
        direction: pending.direction,
        locates: pending.locates,
      };
      // addDiscovery consumes the pending row itself; the explicit delete
      // covers the already-known case, where it returns false.
      if (ctx.runtime.addDiscovery(discovery)) {
        created.push({
          discovery,
          contentId: content.id,
          contentTitle: content.title,
          clueText: clue.text,
          characterName: character?.name ?? 'Someone',
        });
      }
      ctx.runtime.deletePendingReveal(pendingId);
    }
    deliverDiscoveries(ctx, created);
    if (withheld > 0) {
      const where = hex ? ` at hex ${hex.q},${hex.r}` : '';
      notifyLog(ctx, ctx.runtime.appendLog('check', `Withheld ${withheld} result(s)${where}`, 'dm', {}));
    }
  }) as Handler,

  /** Let a character search this hex with this skill again (issue #107). */
  'search.clearAttempt': ((
    cmd: Extract<ClientCommand, { kind: 'search.clearAttempt' }>,
    ctx: Ctx,
  ) => {
    requireDm(ctx);
    const attempt = ctx.runtime.deleteSearchAttempt(cmd.attemptId);
    if (!attempt) throw new Error('That search attempt is already gone');
    const name = ctx.runtime.characters.get(attempt.characterId)?.name ?? 'Someone';
    notifyLog(
      ctx,
      ctx.runtime.appendLog(
        'check',
        `${name} may search hex ${attempt.q},${attempt.r} with ${attempt.skill} again`,
        'dm',
        {},
      ),
    );
  }) as Handler,

  // -- encounters ------------------------------------------------------------
  'encounter.roll': ((cmd: Extract<ClientCommand, { kind: 'encounter.roll' }>, ctx: Ctx) => {
    requireDm(ctx);
    const result = rollEncounter(
      ctx.runtime,
      { mapId: cmd.mapId, q: cmd.q, r: cmd.r, tableId: cmd.tableId, skipCheck: cmd.skipCheck },
      ctx.rng,
    );
    const entry = ctx.runtime.appendLog('encounter', result.summary, 'dm', {
      triggered: result.triggered,
      terrain: result.terrain,
      tableId: result.table?.id ?? null,
      entryText: result.entryText,
      checkRoll: result.checkRoll as unknown as Record<string, unknown> | null,
      tableRoll: result.tableRoll as unknown as Record<string, unknown> | null,
      quantityRoll: result.quantityRoll as unknown as Record<string, unknown> | null,
    });
    notifyLog(ctx, entry);
  }) as Handler,

  'encounterTable.upsert': ((cmd: Extract<ClientCommand, { kind: 'encounterTable.upsert' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.upsertEncounterTable({
      ...cmd.table,
      id: cmd.table.id ?? nanoid(10),
      enabled: cmd.table.enabled ?? true,
    });
  }) as Handler,

  'encounterTable.delete': ((cmd: Extract<ClientCommand, { kind: 'encounterTable.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.deleteEncounterTable(cmd.tableId);
  }) as Handler,

  // -- campaign clock --------------------------------------------------------
  'time.advance': ((cmd: Extract<ClientCommand, { kind: 'time.advance' }>, ctx: Ctx) => {
    requireDm(ctx);
    const before = ctx.runtime.campaign.time.minutes;
    const time = ctx.runtime.advanceTime(cmd.minutes);
    let text = `Time advances ${formatDuration(cmd.minutes)}`;
    if (cmd.note) text += ` (${cmd.note})`;
    text += ` — ${campaignClock(ctx, time.minutes)}`;
    if (time.partyHex) {
      text += ` at ${hexLocationLabel(ctx.runtime, time.partyHex)}`;
    }
    const entry = ctx.runtime.appendLog('time', text, 'all', {
      minutes: time.minutes,
      advancedBy: cmd.minutes,
      note: cmd.note ?? null,
    });
    notifyLog(ctx, entry);
    logDailyWeather(ctx, before);
  }) as Handler,

  'time.set': ((cmd: Extract<ClientCommand, { kind: 'time.set' }>, ctx: Ctx) => {
    requireDm(ctx);
    const time = ctx.runtime.setTime(cmd.minutes);
    // Deliberately no weather reroll: `time.set` is bookkeeping (fixing a
    // mistyped advance), and it can move the clock backwards. The DM can force
    // a fresh sky with `weather.roll`.
    const entry = ctx.runtime.appendLog(
      'time',
      `Clock set to ${campaignClock(ctx, time.minutes)}`,
      'dm',
      { minutes: time.minutes },
    );
    notifyLog(ctx, entry);
  }) as Handler,

  'weather.roll': ((_cmd: Extract<ClientCommand, { kind: 'weather.roll' }>, ctx: Ctx) => {
    requireDm(ctx);
    const weather = setWeather(ctx.runtime, ctx.rng);
    const entry = ctx.runtime.appendLog('weather', weatherLogText(weather), 'all', {
      text: weather.text,
      icon: weather.icon,
      minutes: weather.rolledAtMinutes,
      forced: true,
    });
    notifyLog(ctx, entry);
  }) as Handler,

  'time.config': ((cmd: Extract<ClientCommand, { kind: 'time.config' }>, ctx: Ctx) => {
    requireDm(ctx);
    const patch: Parameters<CampaignRuntime['updateTime']>[0] = {};
    if (cmd.travelMode !== undefined) patch.travelMode = cmd.travelMode;
    if (cmd.pace !== undefined) patch.pace = cmd.pace;
    ctx.runtime.updateTime(patch);
  }) as Handler,

  // -- undo ------------------------------------------------------------------
  undo: ((cmd: Extract<ClientCommand, { kind: 'undo' }>, ctx: Ctx) => {
    requireDm(ctx);
    if (!ctx.runtime.undoStack.length) throw new Error('Nothing to undo');
    // "Rewind to before that change": pop entries newest-first until the
    // chosen one has been reverted too (issue #127).
    const count = Math.min(cmd.count ?? 1, ctx.runtime.undoStack.length);
    for (let i = 0; i < count; i++) {
      const entry = ctx.runtime.undoStack.pop()!;
      entry.run(ctx.runtime);
      // A reverted move snaps tokens and the clock back for everyone, so the
      // players get told why; edits to DM-only layers stay DM-only.
      const log = ctx.runtime.appendLog(
        'undo',
        `Undid: ${entry.description}`,
        entry.kind === 'token.move' ? 'all' : 'dm',
      );
      notifyLog(ctx, log);
    }
  }) as Handler,

  // -- narration -------------------------------------------------------------
  narrate: ((cmd: Extract<ClientCommand, { kind: 'narrate' }>, ctx: Ctx) => {
    requireDm(ctx);
    if (cmd.seatIds.length === 0) {
      const entry = ctx.runtime.appendLog('narration', cmd.text, 'all');
      notifyLog(ctx, entry);
    } else {
      for (const seatId of cmd.seatIds) {
        const entry = ctx.runtime.appendLog('narration', cmd.text, seatId);
        notifyLog(ctx, entry);
      }
    }
  }) as Handler,

  // -- sessions (issue #78) ---------------------------------------------------
  'session.mark': ((cmd: Extract<ClientCommand, { kind: 'session.mark' }>, ctx: Ctx) => {
    requireDm(ctx);
    const atMinutes = ctx.runtime.campaign.time.minutes;
    const label = cmd.action === 'start' ? 'Session started' : 'Session ended';
    const entry = ctx.runtime.appendLog('session', `${label} — ${campaignClock(ctx, atMinutes)}`, 'all', {
      action: cmd.action,
      atMinutes,
    });
    notifyLog(ctx, entry);
  }) as Handler,
};

/**
 * Clock readout for a log line, named by the campaign's calendar when it has
 * one ("Marpenoth 12, 1492 DR, 6:40 PM") and by day number otherwise.
 */
function campaignClock(ctx: Ctx, minutes: number): string {
  return formatCalendarClock(minutes, ctx.runtime.campaign.settings.calendar);
}

/**
 * Weather hook for every clock advance: reroll when the advance crossed into a
 * new day (or seeded the very first sky) and log it for everyone. Call after
 * the clock has moved, with the reading from before it did.
 */
function logDailyWeather(ctx: Ctx, beforeMinutes: number): void {
  const weather = rerollWeatherForNewDay(ctx.runtime, beforeMinutes, ctx.rng);
  if (!weather) return;
  const entry = ctx.runtime.appendLog('weather', weatherLogText(weather), 'all', {
    text: weather.text,
    icon: weather.icon,
    minutes: weather.rolledAtMinutes,
    forced: false,
  });
  notifyLog(ctx, entry);
}

/**
 * A human-readable label for a party-hex reference: the title of enabled
 * content sitting on that hex (a town, a dungeon), or a bare hex coordinate.
 */
function hexLocationLabel(
  runtime: CampaignRuntime,
  hex: { mapId: string; q: number; r: number },
): string {
  const rt = runtime.mapStates.get(hex.mapId);
  if (rt) {
    for (const content of rt.contents.values()) {
      if (content.q === hex.q && content.r === hex.r && content.enabled) return content.title;
    }
  }
  return `hex ${hex.q},${hex.r}`;
}

/** Fog auto-reveal + knowledge evaluation after a PC token appears or moves. */
function afterPartyMoved(ctx: Ctx, mapId: string, token: Token): FogDelta {
  const map = ctx.runtime.maps.get(mapId);
  if (!map) return [];
  let revealed: FogDelta = [];
  if (token.kind === 'pc') {
    revealed = applyAutoReveal(ctx.runtime, map);
  }
  if (token.characterId) {
    deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, mapId, [token.characterId]));
    deliverTrailFinds(ctx, evaluateTrails(ctx.runtime, mapId, [token.characterId]));
  }
  return revealed;
}

function deliverTrailFinds(ctx: Ctx, finds: TrailFind[]): void {
  for (const f of finds) {
    ctx.hub.sendTo(
      ctx.runtime,
      { type: 'event', kind: 'trail.found', ...f },
      { all: true },
    );
  }
}

/** Fog cells changed by an operation, with their prior state for undo. */
type FogDelta = { q: number; r: number; state: FogState; prev: FogState }[];

/**
 * Undo helper: restore every touched cell to its earliest recorded prior
 * state (the first change per cell holds the true pre-move value).
 */
function restoreFogDelta(runtime: CampaignRuntime, mapId: string, delta: FogDelta): void {
  const prior = new Map<string, FogState>();
  for (const c of delta) {
    const key = `${c.q},${c.r}`;
    if (!prior.has(key)) prior.set(key, c.prev);
  }
  const byState = new Map<FogState, { q: number; r: number }[]>();
  for (const [key, state] of prior) {
    const [q, r] = key.split(',').map(Number);
    const list = byState.get(state) ?? [];
    list.push({ q: q!, r: r! });
    byState.set(state, list);
  }
  for (const [state, cells] of byState) runtime.setFog(mapId, cells, state);
}

/**
 * Bearing from a character's PC token toward a content hex, for clues that
 * indicate direction. Null when the clue doesn't, or the character has no
 * token on that map, or they stand on the hex itself.
 */
function clueDirectionFor(
  ctx: Ctx,
  clue: Clue,
  content: Content,
  characterId: string,
): string | null {
  if (!clue.indicatesDirection) return null;
  const rt = ctx.runtime.mapStates.get(content.mapId);
  if (!rt) return null;
  const token = [...rt.tokens.values()].find(
    (t) => t.kind === 'pc' && t.characterId === characterId,
  );
  if (!token) return null;
  const orientation = ctx.runtime.maps.get(content.mapId)?.orientation ?? 'flat';
  return compassDirection({ q: token.q, r: token.r }, { q: content.q, r: content.r }, orientation);
}

/** All tokens moving together with `token` — just the token itself unless it's in a party. */
function partyMembers(ctx: Ctx, token: Token): Token[] {
  if (!token.partyId) return [token];
  const rt = ctx.runtime.requireMap(token.mapId);
  return [...rt.tokens.values()].filter((t) => t.partyId === token.partyId);
}

/** Every hex of a move, start and destination included. */
export type TravelPath = HexCoord[];

/**
 * The hexes a move crosses (issue #130). When the map routes through known
 * ground and the destination is more than a step away, the shortest route
 * whose every hex is explored (or visible) wins — the road the party already
 * walked, not a straight line across the fog. Without such a route the move
 * is the straight line it always was. A teleport has no path: it lands on the
 * destination and nothing in between is walked.
 */
export function travelPath(
  ctx: Ctx,
  map: MapInfo,
  from: HexCoord,
  to: HexCoord,
  teleport: boolean,
): { path: TravelPath; routed: boolean } {
  if (teleport) return { path: [from, to], routed: false };
  if (map.routeExplored && hexDistance(from, to) > 1) {
    const route = exploredRoute(ctx.runtime, map.id, from, to);
    if (route) return { path: route, routed: true };
  }
  return { path: hexLine(from, to), routed: false };
}

/** Shortest route from `from` to `to` through explored/visible fog, or null. */
export function exploredRoute(
  runtime: CampaignRuntime,
  mapId: string,
  from: HexCoord,
  to: HexCoord,
): HexCoord[] | null {
  const rt = runtime.mapStates.get(mapId);
  if (!rt) return null;
  return findRoute(from, to, exploredPassable((h) => rt.fog.get(hexKey(h.q, h.r))));
}

export interface TravelOutcome {
  /** Where the party actually stopped (an encounter or nightfall can halt it short). */
  to: HexCoord;
  hexes: number;
  minutes: number;
  stoppedBy: 'encounter' | 'night' | null;
}

/**
 * The whole of a party move (issue #127), in one place so one undo entry can
 * reverse every part of it:
 *
 * 1. Auto encounter checks along the path. A TRIGGERED encounter halts the
 *    party at that hex — the rest of the path is not walked.
 * 2. Every party member shifts by the same offset; each walked hex joins the
 *    explored trail; fog auto-reveals; the knowledge engine and trails run.
 * 3. The clock advances by hexes × minutesPerHex, the departed hex is credited
 *    with the time lingered there, and the arrival is stamped.
 * 4. A `travel` log line records the move for everyone.
 *
 * The undo entry restores token positions, the fog delta, the whole clock
 * blob (partyHex and weather included), the two hex-visit records touched,
 * the encounter-check counter, and revokes the discoveries, trail finds and
 * log lines the move produced. Player moves push undo entries too — undoing
 * stays a DM action, but a player's mis-drag must be recoverable.
 */
function performTravel(
  ctx: Ctx,
  map: MapInfo,
  token: Token,
  path: TravelPath,
  opts: { teleport: boolean; approved?: boolean; routed?: boolean },
): TravelOutcome {
  const runtime = ctx.runtime;
  const from = path[0] ?? { q: token.q, r: token.r };
  const label = token.label || 'token';
  const isParty = token.kind === 'pc';

  // -- before: everything the undo will need -------------------------------
  const prior = partyMembers(ctx, token).map((m) => ({ id: m.id, q: m.q, r: m.r }));
  const timeBefore = structuredClone(runtime.campaign.time);
  const counterBefore = map.encounterCheck.hexesSinceCheck;
  const discoveriesBefore = new Set(runtime.discoveries.keys());
  const locatesBefore = new Map([...runtime.discoveries.values()].map((d) => [d.id, d.locates]));
  const trailFindsBefore = new Set(runtime.trailDiscoveries.keys());
  const logBefore = new Set(runtime.log.map((e) => e.id));
  const parked = timeBefore.partyHex;
  const parkedVisit =
    parked ? structuredClone(runtime.hexVisit(parked.mapId, parked.q, parked.r)) : null;

  // -- 0. nightfall (issue #130) ---------------------------------------------
  // Routed travel is "auto" travel: with the campaign set to halt at night,
  // the party walks until the hex where dusk catches them and camps there,
  // to be sent on again next day. A party that set out after dark chose
  // night travel and is not stopped. Decided before the dice come out so an
  // encounter never rolls for a hex that would not have been walked.
  let steps = opts.teleport ? [] : path.slice(1);
  let stoppedBy: TravelOutcome['stoppedBy'] = null;
  const settings = runtime.campaign.settings;
  if (isParty && opts.routed && settings.stopTravelAtNight && steps.length > 1) {
    const time = runtime.campaign.time;
    if (!isNight(time.minutes, settings)) {
      const mode = resolveTravelMode(time.travelMode, settings.customTravelModes);
      const perHex = minutesPerHex(map.milesPerHex, mode, time.pace);
      let clock = time.minutes;
      for (let i = 0; i < steps.length; i++) {
        clock += perHex;
        if (isNight(clock, settings) && i < steps.length - 1) {
          steps = steps.slice(0, i + 1);
          stoppedBy = 'night';
          break;
        }
      }
    }
  }

  // -- 1. encounter checks along the way ------------------------------------
  if (isParty && steps.length) {
    const halt = autoEncounterChecks(ctx, map, steps);
    if (halt !== null) {
      steps = steps.slice(0, halt + 1);
      stoppedBy = 'encounter';
    }
  }
  const to = opts.teleport ? (path[path.length - 1] ?? from) : (steps[steps.length - 1] ?? from);
  const toVisit = structuredClone(runtime.hexVisit(map.id, to.q, to.r));
  const walked: TravelPath = opts.teleport ? [to] : [from, ...steps];

  // -- 2. the move itself ----------------------------------------------------
  const dq = to.q - token.q;
  const dr = to.r - token.r;
  const fogDelta: FogDelta = [];
  for (const member of partyMembers(ctx, token)) {
    const dest = { q: member.q + dq, r: member.r + dr };
    const moved = runtime.updateToken(member.mapId, member.id, dest);
    if (member.kind === 'pc') {
      // Every walked hex — the path AND the hex they end on — joins the
      // explored trail, shifted to where this member actually walked.
      const own = walked.map((h) => ({ q: h.q + (member.q - token.q), r: h.r + (member.r - token.r) }));
      fogDelta.push(...runtime.setFog(member.mapId, own, 'explored'));
    }
    fogDelta.push(...afterPartyMoved(ctx, member.mapId, moved));
  }

  // -- 3. the clock ----------------------------------------------------------
  let minutes = 0;
  if (isParty) {
    const time = runtime.campaign.time;
    const mode = resolveTravelMode(time.travelMode, runtime.campaign.settings.customTravelModes);
    const hexes = opts.teleport ? 0 : steps.length;
    minutes = hexes * minutesPerHex(map.milesPerHex, mode, time.pace);
    if (parked) {
      runtime.addHexTime(parked.mapId, parked.q, parked.r, time.minutes - parked.arrivedMinutes);
    }
    const before = time.minutes;
    if (minutes > 0) runtime.advanceTime(minutes);
    const arrivedMinutes = runtime.campaign.time.minutes;
    runtime.recordHexArrival(map.id, to.q, to.r, arrivedMinutes);
    runtime.updateTime({ partyHex: { mapId: map.id, q: to.q, r: to.r, arrivedMinutes } });
    // Travel that crosses midnight brings a new day's weather with it (#79).
    logDailyWeather(ctx, before);
  }

  // -- 4. the travel line ----------------------------------------------------
  const hexes = opts.teleport ? 0 : steps.length;
  const where = hexLocationLabel(runtime, { mapId: map.id, q: to.q, r: to.r });
  const shortfall = stoppedBy ? hexDistance(to, path[path.length - 1]!) : 0;
  let text: string;
  if (opts.teleport) {
    text = `${label} teleported to ${where}`;
  } else {
    text = `${label} travelled ${hexes} hex${hexes === 1 ? '' : 'es'} to ${where}`;
    if (minutes > 0) text += ` — ${formatDuration(minutes)}`;
    if (isParty) text += ` — ${campaignClock(ctx, runtime.campaign.time.minutes)}`;
    const goal = path[path.length - 1]!;
    if (stoppedBy === 'encounter') {
      text += ` — halted by an encounter, ${shortfall} hex${shortfall === 1 ? '' : 'es'} short of ${goal.q},${goal.r}`;
    } else if (stoppedBy === 'night') {
      text += ` — halts for the night, ${shortfall} hex${shortfall === 1 ? '' : 'es'} short of ${goal.q},${goal.r}`;
    }
  }
  const entry = runtime.appendLog('travel', text, opts.teleport || !isParty ? 'dm' : 'all', {
    tokenId: token.id,
    characterId: token.characterId,
    mapId: map.id,
    from: { q: from.q, r: from.r },
    to: { q: to.q, r: to.r },
    intended: { q: path[path.length - 1]!.q, r: path[path.length - 1]!.r },
    hexes,
    minutes,
    teleport: opts.teleport,
    approved: opts.approved ?? false,
    routed: opts.routed ?? false,
    stoppedBy,
    party: prior.length,
  });
  notifyLog(ctx, entry);

  // -- after: what the move produced -----------------------------------------
  const newDiscoveries = [...runtime.discoveries.keys()].filter((id) => !discoveriesBefore.has(id));
  const upgraded = [...runtime.discoveries.values()]
    .filter((d) => locatesBefore.get(d.id) === false && d.locates)
    .map((d) => d.id);
  const newTrailFinds = [...runtime.trailDiscoveries.keys()].filter((id) => !trailFindsBefore.has(id));
  const newLog = runtime.log.filter((e) => !logBefore.has(e.id)).map((e) => e.id);
  const mapId = map.id;
  const clockDelta = runtime.campaign.time.minutes - timeBefore.minutes;

  const details: string[] = [];
  if (clockDelta > 0) details.push(`clock rewound ${formatDuration(clockDelta)}`);
  if (newDiscoveries.length) {
    details.push(`${newDiscoveries.length} discover${newDiscoveries.length === 1 ? 'y' : 'ies'} revoked`);
  }
  runtime.pushUndo({
    at: Date.now(),
    kind: 'token.move',
    mapId,
    description:
      `move ${label} back to ${from.q},${from.r}` + (details.length ? ` (${details.join(', ')})` : ''),
    run: (rt) => {
      for (const p of prior) {
        if (rt.findToken(p.id)) rt.updateToken(mapId, p.id, { q: p.q, r: p.r });
      }
      restoreFogDelta(rt, mapId, fogDelta);
      if (isParty) {
        rt.updateTime(timeBefore);
        rt.restoreHexVisit(mapId, to.q, to.r, toVisit);
        if (parked) rt.restoreHexVisit(parked.mapId, parked.q, parked.r, parkedVisit);
        if (rt.maps.has(mapId)) {
          rt.updateMap(mapId, {
            encounterCheck: { hexesSinceCheck: counterBefore },
          } as unknown as Partial<MapInfo>);
        }
      }
      for (const id of newDiscoveries) rt.revokeDiscovery(id);
      for (const id of upgraded) rt.setDiscoveryLocates(id, false);
      for (const id of newTrailFinds) rt.deleteTrailDiscovery(id);
      rt.deleteLogEntries(newLog);
    },
  });

  return { to, hexes, minutes, stoppedBy };
}

/**
 * Auto wandering-encounter checks: when the map's encounterCheck.autoEvery is
 * set, every N hexes of PC travel rolls the trigger die. The counter carries
 * across moves (persisted in the map's encounterCheck config) and a long trip
 * can roll more than once, at the hexes actually crossed.
 *
 * Returns the index (into `steps`) of the hex where an encounter TRIGGERED, or
 * null when the party gets through unbothered. Checking stops at the first
 * trigger: the party halts there (issue #130), so the hexes beyond are never
 * crossed and never rolled for.
 */
function autoEncounterChecks(ctx: Ctx, map: MapInfo, steps: HexCoord[]): number | null {
  const every = map.encounterCheck.autoEvery;
  if (!every || !steps.length) return null;
  let count = map.encounterCheck.hexesSinceCheck;
  let halt: number | null = null;
  for (let i = 0; i < steps.length; i++) {
    const hex = steps[i]!;
    count += 1;
    if (count < every) continue;
    count = 0;
    const result = rollEncounter(
      ctx.runtime,
      { mapId: map.id, q: hex.q, r: hex.r, tableId: null, skipCheck: false },
      ctx.rng,
    );
    const entry = ctx.runtime.appendLog(
      'encounter',
      `Auto check at hex ${hex.q},${hex.r} — ${result.summary}` +
        (result.triggered ? ' — the party stops here' : ''),
      'dm',
      {
        triggered: result.triggered,
        terrain: result.terrain,
        tableId: result.table?.id ?? null,
        entryText: result.entryText,
        checkRoll: result.checkRoll as unknown as Record<string, unknown> | null,
        tableRoll: result.tableRoll as unknown as Record<string, unknown> | null,
        quantityRoll: result.quantityRoll as unknown as Record<string, unknown> | null,
        auto: true,
        q: hex.q,
        r: hex.r,
      },
    );
    notifyLog(ctx, entry);
    if (result.triggered) {
      halt = i;
      break;
    }
  }
  ctx.runtime.updateMap(map.id, {
    encounterCheck: { hexesSinceCheck: count },
  } as unknown as Partial<MapInfo>);
  return halt;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dispatchCommand(cmd: ClientCommand, ctx: Ctx): void {
  const handler = handlers[cmd.kind] as (c: ClientCommand, ctx: Ctx) => void;
  handler(cmd, ctx);
  ctx.hub.scheduleSync(ctx.runtime);
}
