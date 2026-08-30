import { nanoid } from 'nanoid';
import type {
  ClientCommand,
  Content,
  LogEntry,
  MapInfo,
  Rng,
  Token,
} from '@hexcrawl/shared';
import {
  EncounterCheckConfigSchema,
  GridStyleSchema,
  hexDistance,
  rollD20,
} from '@hexcrawl/shared';
import type { CampaignRuntime, SeatRecord } from '../state/runtime.js';
import type { Hub } from './hub.js';
import { applyAutoReveal } from '../engine/fog.js';
import { evaluateKnowledge, type NewDiscovery } from '../engine/knowledge.js';
import { rollEncounter } from '../engine/encounters.js';

export interface Ctx {
  runtime: CampaignRuntime;
  seat: SeatRecord;
  hub: Hub;
  rng: Rng;
}

type Handler = (cmd: never, ctx: Ctx) => void;

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
    ctx.runtime.paintTerrain(cmd.mapId, cmd.cells, cmd.terrain);
  }) as Handler,

  'fog.set': ((cmd: Extract<ClientCommand, { kind: 'fog.set' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.setFog(cmd.mapId, cmd.cells, cmd.state);
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
    const moved = ctx.runtime.updateToken(token.mapId, cmd.tokenId, { q: cmd.q, r: cmd.r });
    afterPartyMoved(ctx, token.mapId, moved);
  }) as Handler,

  'token.delete': ((cmd: Extract<ClientCommand, { kind: 'token.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    const token = ctx.runtime.findToken(cmd.tokenId);
    if (!token) return;
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
    ctx.runtime.deleteMarker(cmd.markerId);
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
      showLabel: cmd.content.showLabel,
      clues: cmd.content.clues.map((c, i) => ({
        id: c.id ?? nanoid(10),
        contentId: id,
        text: c.text,
        gate: c.gate,
        sortOrder: i,
      })),
    };
    ctx.runtime.upsertContent(content);
    deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, content.mapId));
  }) as Handler,

  'content.delete': ((cmd: Extract<ClientCommand, { kind: 'content.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.deleteContent(cmd.contentId);
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
    requireDm(ctx);
    let targets = cmd.characterIds;
    if (!targets.length) {
      const mapId = ctx.runtime.campaign.activeMapId;
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
    const summary = results
      .map(
        (r) =>
          `${r.name}: ${r.total} (d20 ${r.roll}${r.modifier >= 0 ? '+' : ''}${r.modifier})${
            r.success === null ? '' : r.success ? ' ✓' : ' ✗'
          }`,
      )
      .join(' · ');
    const entry = ctx.runtime.appendLog(
      'check',
      `${capitalize(cmd.skill)}${cmd.dc !== null ? ` DC ${cmd.dc}` : ''}: ${summary || 'no targets'}`,
      'dm',
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
    ctx.runtime.upsertEncounterTable({ ...cmd.table, id: cmd.table.id ?? nanoid(10) });
  }) as Handler,

  'encounterTable.delete': ((cmd: Extract<ClientCommand, { kind: 'encounterTable.delete' }>, ctx: Ctx) => {
    requireDm(ctx);
    ctx.runtime.deleteEncounterTable(cmd.tableId);
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
function afterPartyMoved(ctx: Ctx, mapId: string, token: Token): void {
  const map = ctx.runtime.maps.get(mapId);
  if (!map) return;
  if (token.kind === 'pc') {
    applyAutoReveal(ctx.runtime, map);
  }
  if (token.characterId) {
    deliverDiscoveries(ctx, evaluateKnowledge(ctx.runtime, mapId, [token.characterId]));
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dispatchCommand(cmd: ClientCommand, ctx: Ctx): void {
  const handler = handlers[cmd.kind] as (c: ClientCommand, ctx: Ctx) => void;
  handler(cmd, ctx);
  ctx.hub.scheduleSync(ctx.runtime);
}
