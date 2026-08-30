import { nanoid } from 'nanoid';
import type {
  ClientCommand,
  Clue,
  Content,
  LogEntry,
  MapInfo,
  Rng,
  Token,
} from '@hexcrawl/shared';
import {
  compassDirection,
  EncounterCheckConfigSchema,
  GridStyleSchema,
  hexDistance,
  hexKey,
  hexLine,
  parseHexKey,
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
    ctx.runtime.updateCampaign({ name: cmd.name, settings: cmd.settings });
  }) as Handler,

  // -- maps ------------------------------------------------------------------
  'map.create': ((cmd: Extract<ClientCommand, { kind: 'map.create' }>, ctx: Ctx) => {
    requireDm(ctx);
    const map: MapInfo = {
      id: nanoid(10),
      name: cmd.name,
      orientation: cmd.orientation,
      hexSize: cmd.hexSize,
      originX: 0,
      originY: 0,
      gridStyle: GridStyleSchema.parse({}),
      sightRadius: 1,
      fogMode: 'auto',
      fogDecay: false,
      moveMode: 'free',
      moveApproval: false,
      milesPerHex: 6,
      encounterCheck: EncounterCheckConfigSchema.parse({}),
      sortOrder: ctx.runtime.maps.size,
    };
    ctx.runtime.createMap(map);
    if (!ctx.runtime.campaign.activeMapId) ctx.runtime.setActiveMap(map.id);
  }) as Handler,

  'map.update': ((cmd: Extract<ClientCommand, { kind: 'map.update' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.updateMap(cmd.mapId, cmd.patch as Partial<MapInfo>);
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
    const fogDelta = executePartyMove(ctx, token, cmd.q, cmd.r, cmd.teleport && ctx.seat.role === 'dm');
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
      const fogDelta = executePartyMove(ctx, token, pending.toQ, pending.toR, cmd.teleport);
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
  'marker.place': ((cmd: Extract<ClientCommand, { kind: 'marker.place' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.placeMarker({ ...cmd.marker, id: nanoid(10) });
  }) as Handler,

  'marker.update': ((cmd: Extract<ClientCommand, { kind: 'marker.update' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.updateMarker(cmd.markerId, cmd.patch);
  }) as Handler,

  'marker.delete': ((cmd: Extract<ClientCommand, { kind: 'marker.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
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
    ctx.runtime.upsertCharacter({ ...existing, ...cmd.patch, id: existing.id });
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
    const content: Content = {
      id,
      mapId: cmd.content.mapId,
      q: cmd.content.q,
      r: cmd.content.r,
      type: cmd.content.type,
      title: cmd.content.title,
      dmNotes: cmd.content.dmNotes,
      glyph: cmd.content.glyph,
      showLabel: cmd.content.showLabel ?? false,
      scaleVisibility: cmd.content.scaleVisibility ?? 1,
      wikiPage: cmd.content.wikiPage ?? '',
      clues: cmd.content.clues.map((c, i) => ({
        id: c.id ?? nanoid(10),
        contentId: id,
        text: c.text,
        gate: c.gate,
        sortOrder: i,
        indicatesDirection: c.indicatesDirection ?? false,
      })),
    };
    ctx.runtime.upsertContent(content);
    deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, content.mapId));
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
        // A deliberate DM reveal tells the player where it is.
        locates: true,
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
            if (content.q !== cmd.hex.q || content.r !== cmd.hex.r) continue;
            const distance = hexDistance({ q: token.q, r: token.r }, cmd.hex);
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
                locates: distance === 0,
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
    notifyLog(ctx, entry);
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
};

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
    if (!teleport) {
      // Traversed hexes join the explored trail; the destination itself is
      // where the party stands, so it becomes (or stays) visible.
      const path = hexLine(from, { q, r }).filter((c) => !(c.q === q && c.r === r));
      if (path.length) delta.push(...ctx.runtime.setFog(token.mapId, path, 'explored'));
    }
    delta.push(...ctx.runtime.setFog(token.mapId, [{ q, r }], 'visible'));
  }
  delta.push(...afterPartyMoved(ctx, token.mapId, moved));
  return delta;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dispatchCommand(cmd: ClientCommand, ctx: Ctx): void {
  const handler = handlers[cmd.kind] as (c: ClientCommand, ctx: Ctx) => void;
  handler(cmd, ctx);
  ctx.hub.scheduleSync(ctx.runtime);
}
