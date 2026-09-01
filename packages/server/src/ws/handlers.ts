import { nanoid } from 'nanoid';
import type {
  ClientCommand,
  Clue,
  Content,
  InheritableMapField,
  LogEntry,
  MapInfo,
  Marker,
  Rng,
  Token,
} from '@hexcrawl/shared';
import {
  compassDirection,
  contentCoversHex,
  distanceToContent,
  formatCalendarClock,
  formatDuration,
  GridStyleSchema,
  hexDistance,
  INHERITABLE_MAP_FIELDS,
  hexKey,
  hexLine,
  minutesPerHex,
  parseHexKey,
  resolveTravelMode,
  rollD20,
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
    requireDm(ctx);
    const token = ctx.runtime.findToken(cmd.tokenId);
    if (!token) throw new Error('Token not found');
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
      if (map.moveMode === 'step') {
        const dist = hexDistance({ q: token.q, r: token.r }, { q: cmd.q, r: cmd.r });
        if (dist > 1) throw new Error('You can only move one hex at a time');
      }
    }
    if (ctx.seat.role !== 'dm' && map.moveApproval) {
      throw new Error('This map uses DM-approved movement — your move was sent as a request');
    }
    const prior = partyMembers(ctx, token).map((m) => ({ id: m.id, q: m.q, r: m.r }));
    const label = token.label || 'token';
    const fromQ = token.q;
    const fromR = token.r;
    const teleport = cmd.teleport && ctx.seat.role === 'dm';
    const fogDelta = executePartyMove(ctx, token, cmd.q, cmd.r, teleport);
    autoEncounterChecks(ctx, map, token, { q: fromQ, r: fromR }, { q: cmd.q, r: cmd.r }, teleport);
    advanceTravelClock(ctx, map, token, { q: fromQ, r: fromR }, { q: cmd.q, r: cmd.r }, teleport);
    if (ctx.seat.role === 'dm') {
      ctx.runtime.pushUndo({
        at: Date.now(),
        kind: 'token.move',
        description: `move ${label} back to ${fromQ},${fromR}`,
        run: (runtime) => {
          for (const p of prior) {
            if (runtime.findToken(p.id)) runtime.updateToken(token.mapId, p.id, { q: p.q, r: p.r });
          }
          restoreFogDelta(runtime, token.mapId, fogDelta);
        },
      });
    }
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
      const prior = partyMembers(ctx, token).map((m) => ({ id: m.id, q: m.q, r: m.r }));
      const from = { q: token.q, r: token.r };
      const fogDelta = executePartyMove(ctx, token, pending.toQ, pending.toR, cmd.teleport);
      const map = ctx.runtime.maps.get(token.mapId);
      if (map) {
        autoEncounterChecks(ctx, map, token, from, { q: pending.toQ, r: pending.toR }, cmd.teleport);
        advanceTravelClock(ctx, map, token, from, { q: pending.toQ, r: pending.toR }, cmd.teleport);
      }
      ctx.runtime.pushUndo({
        at: Date.now(),
        kind: 'token.move',
        description: `undo ${pending.label}'s approved move`,
        run: (runtime) => {
          for (const p of prior) {
            if (runtime.findToken(p.id)) runtime.updateToken(token.mapId, p.id, { q: p.q, r: p.r });
          }
          restoreFogDelta(runtime, token.mapId, fogDelta);
        },
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
    const priorArea = ctx.runtime.mapStates.get(cmd.content.mapId)?.contents.get(id)?.area;
    const content: Content = {
      id,
      mapId: cmd.content.mapId,
      q: cmd.content.q,
      r: cmd.content.r,
      area: cmd.content.area ?? priorArea ?? [],
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
    let targets = cmd.characterIds;
    if (ctx.seat.role !== 'dm') {
      // Players roll for their own character only.
      if (!ctx.seat.characterId) throw new Error('Claim a character first');
      targets = [ctx.seat.characterId];
    }
    if (!targets.length) {
      const mapId = cmd.mapId ?? ctx.runtime.campaign.activeMapId;
      const rt = mapId ? ctx.runtime.mapStates.get(mapId) : null;
      targets = rt
        ? [...rt.tokens.values()]
            .filter((t) => t.kind === 'pc' && t.characterId)
            .map((t) => t.characterId!)
        : [];
    }
    const results = targets
      .map((characterId) => {
        const character = ctx.runtime.characters.get(characterId);
        if (!character) return null;
        const modifier = character.skills[cmd.skill] ?? 0;
        const { roll, total } = rollD20(modifier, ctx.rng);
        return {
          characterId,
          name: character.name,
          roll,
          modifier,
          total,
          success: cmd.dc !== null ? total >= cmd.dc : null,
        };
      })
      .filter((r) => r !== null);
    // Hex-targeted search: the roll is compared against the clue gates of
    // content on that hex. A matching-skill clue opens when the character is
    // within the gate's range and the roll beats the clue's own DC (active
    // and passive gates alike — a deliberate search can find what passive
    // senses missed).
    let found = 0;
    if (cmd.hex && cmd.mapId) {
      const rt = ctx.runtime.mapStates.get(cmd.mapId);
      const map = ctx.runtime.maps.get(cmd.mapId);
      if (rt && map) {
        const created: NewDiscovery[] = [];
        for (const r of results) {
          const token = [...rt.tokens.values()].find(
            (t) => t.kind === 'pc' && t.characterId === r.characterId,
          );
          if (!token) continue;
          const character = ctx.runtime.characters.get(r.characterId)!;
          for (const content of rt.contents.values()) {
            if (!content.enabled) continue;
            // A search on ANY hex of a region's footprint searches the region.
            if (!contentCoversHex(content, cmd.hex)) continue;
            const distance = distanceToContent(content, { q: token.q, r: token.r });
            for (const clue of content.clues) {
              if (clue.gate.kind !== 'skill' || clue.gate.skill !== cmd.skill) continue;
              if (distance > clue.gate.maxDistance) continue;
              if (r.total < clue.gate.dc) continue;
              if (ctx.runtime.hasDiscovery(clue.id, r.characterId)) continue;
              const direction =
                clue.indicatesDirection && distance > 0
                  ? compassDirection({ q: token.q, r: token.r }, cmd.hex, map.orientation)
                  : null;
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
                locates: distance === 0 && clue.revealsLocation,
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
      }
    }
    const summary = results
      .map(
        (r) =>
          `${r.name}: ${r.total} (d20 ${r.roll}${r.modifier >= 0 ? '+' : ''}${r.modifier})${
            r.success === null ? '' : r.success ? ' ✓' : ' ✗'
          }`,
      )
      .join(' · ');
    const where = cmd.hex ? ` on hex ${cmd.hex.q},${cmd.hex.r}` : '';
    const outcome = cmd.hex ? (found ? ` — ${found} clue(s) uncovered` : ' — nothing new found') : '';
    const entry = ctx.runtime.appendLog(
      'check',
      `${capitalize(cmd.skill)}${cmd.dc !== null ? ` DC ${cmd.dc}` : ''}${where}: ${summary || 'no targets'}${outcome}`,
      ctx.seat.role === 'dm' ? 'dm' : 'all',
      { skill: cmd.skill, dc: cmd.dc, results },
    );
    if (entry.visibility === 'all') {
      // A character's rolls are theirs alone: notify only the seats owning a
      // character that rolled (the snapshot filter applies the same rule).
      const rolled = new Set(results.map((r) => r.characterId));
      const ownerSeats = [...ctx.runtime.seats.values()]
        .filter((s) => s.characterId && rolled.has(s.characterId))
        .map((s) => s.id);
      ctx.hub.sendTo(
        ctx.runtime,
        { type: 'event', kind: 'log.appended', entry },
        { dm: true, seatIds: ownerSeats },
      );
    } else {
      notifyLog(ctx, entry);
    }
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
  undo: ((_cmd: Extract<ClientCommand, { kind: 'undo' }>, ctx: Ctx) => {
    requireDm(ctx);
    const entry = ctx.runtime.undoStack.pop();
    if (!entry) throw new Error('Nothing to undo');
    entry.run(ctx.runtime);
    const summary = `Undid: ${entry.description}`;
    const log = ctx.runtime.appendLog('undo', summary, 'dm');
    notifyLog(ctx, log);
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

/**
 * Move `token` to (q, r) and shift every other member of its party by the
 * same offset, so the group travels as a unit while keeping formation.
 */
function executePartyMove(ctx: Ctx, token: Token, q: number, r: number, teleport = false): FogDelta {
  const dq = q - token.q;
  const dr = r - token.r;
  const delta: FogDelta = [];
  for (const member of partyMembers(ctx, token)) {
    delta.push(...executeTokenMove(ctx, member, member.q + dq, member.r + dr, teleport));
  }
  return delta;
}

/** Execute a token move: traversed path becomes the explored trail, then sight + knowledge. */
function executeTokenMove(ctx: Ctx, token: Token, q: number, r: number, teleport = false): FogDelta {
  const from = { q: token.q, r: token.r };
  const moved = ctx.runtime.updateToken(token.mapId, token.id, { q, r });
  const delta: FogDelta = [];
  if (token.kind === 'pc') {
    // Every walked hex — the traversed path AND the hex they end on — joins
    // the explored trail. A teleport marks only the destination.
    const path = teleport ? [{ q, r }] : hexLine(from, { q, r });
    delta.push(...ctx.runtime.setFog(token.mapId, path, 'explored'));
  }
  delta.push(...afterPartyMoved(ctx, token.mapId, moved));
  return delta;
}

/**
 * Auto wandering-encounter checks: when the map's encounterCheck.autoEvery is
 * set, every N hexes of PC travel rolls the trigger die. The counter carries
 * across moves (persisted in the map's encounterCheck config) and a long drag
 * can roll more than once, at the hexes actually crossed. Teleports don't
 * count as travel.
 */
function autoEncounterChecks(
  ctx: Ctx,
  map: MapInfo,
  token: Token,
  from: { q: number; r: number },
  to: { q: number; r: number },
  teleport: boolean,
): void {
  if (teleport || token.kind !== 'pc') return;
  const every = map.encounterCheck.autoEvery;
  if (!every) return;
  const steps = hexLine(from, to).slice(1);
  if (!steps.length) return;
  let count = map.encounterCheck.hexesSinceCheck;
  for (const hex of steps) {
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
      `Auto check at hex ${hex.q},${hex.r} — ${result.summary}`,
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
  }
  ctx.runtime.updateMap(map.id, {
    encounterCheck: { hexesSinceCheck: count },
  } as unknown as Partial<MapInfo>);
}

/**
 * Campaign clock + per-hex visit accounting for a party move.
 *
 * Travel costs `hexes crossed × minutesPerHex(map scale, mode, pace)`. The hex
 * the party leaves is credited with the time they lingered there — the clock
 * delta since they arrived, which excludes this move's travel time because the
 * credit is taken before the clock advances. Teleports move the party without
 * spending time (but still re-stamp where they now stand). "The party" is the
 * moved PC token; NPC tokens don't move the clock.
 */
function advanceTravelClock(
  ctx: Ctx,
  map: MapInfo,
  token: Token,
  from: { q: number; r: number },
  to: { q: number; r: number },
  teleport: boolean,
): void {
  if (token.kind !== 'pc') return;
  const time = ctx.runtime.campaign.time;
  const mode = resolveTravelMode(time.travelMode, ctx.runtime.campaign.settings.customTravelModes);
  const hexes = teleport ? 0 : Math.max(0, hexLine(from, to).length - 1);
  const travelMinutes = hexes * minutesPerHex(map.milesPerHex, mode, time.pace);

  const parked = time.partyHex;
  if (parked) {
    ctx.runtime.addHexTime(parked.mapId, parked.q, parked.r, time.minutes - parked.arrivedMinutes);
  }
  const before = time.minutes;
  if (travelMinutes > 0) ctx.runtime.advanceTime(travelMinutes);
  const arrivedMinutes = ctx.runtime.campaign.time.minutes;
  ctx.runtime.recordHexArrival(map.id, to.q, to.r, arrivedMinutes);
  ctx.runtime.updateTime({ partyHex: { mapId: map.id, q: to.q, r: to.r, arrivedMinutes } });
  // Travel that crosses midnight brings a new day's weather with it (#79).
  logDailyWeather(ctx, before);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dispatchCommand(cmd: ClientCommand, ctx: Ctx): void {
  const handler = handlers[cmd.kind] as (c: ClientCommand, ctx: Ctx) => void;
  handler(cmd, ctx);
  ctx.hub.scheduleSync(ctx.runtime);
}
