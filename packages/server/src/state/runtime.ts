import { nanoid } from 'nanoid';
import type {
  Campaign,
  PendingMove,
  CampaignSettings,
  CampaignState,
  Character,
  Content,
  Discovery,
  EncounterTable,
  FogState,
  HexCell,
  ImageLayer,
  LogEntry,
  MapInfo,
  MapState,
  Marker,
  SeatPublic,
  SeatRole,
  TerrainId,
  Token,
} from '@hexcrawl/shared';
import {
  CampaignSettingsSchema,
  EncounterCheckConfigSchema,
  GateSchema,
  GridStyleSchema,
  SkillsSchema,
  hexKey,
  parseHexKey,
} from '@hexcrawl/shared';
import type { DB } from '../db/index.js';

export interface SeatRecord {
  id: string;
  campaignId: string;
  role: SeatRole;
  name: string;
  token: string;
  characterId: string | null;
}

export interface MapRuntime {
  hexes: Map<string, TerrainId>;
  fog: Map<string, FogState>;
  tokens: Map<string, Token>;
  markers: Map<string, Marker>;
  contents: Map<string, Content>;
  /** In-memory only: player moves awaiting DM approval, by tokenId. */
  pendingMoves: Map<string, PendingMove>;
}

const LOG_MEMORY_LIMIT = 500;
const UNDO_STACK_LIMIT = 100;

/** One undoable change. Held in memory only (drops on server restart). */
export interface UndoEntry {
  at: number;
  kind: string;
  mapId?: string;
  description: string;
  /** For mergeable cell ops: cell key -> value to restore. */
  restore?: Map<string, unknown>;
  run: (runtime: CampaignRuntime) => void;
}

/**
 * All state for one campaign, held in memory and written through to SQLite
 * on every mutation. better-sqlite3 is synchronous, so memory and disk can
 * never drift.
 */
export class CampaignRuntime {
  readonly id: string;
  campaign: Campaign;
  dmSecret: string;
  playerSecret: string;
  seats = new Map<string, SeatRecord>();
  characters = new Map<string, Character>();
  maps = new Map<string, MapInfo>();
  mapStates = new Map<string, MapRuntime>();
  discoveries = new Map<string, Discovery>();
  discoveredByClueChar = new Set<string>();
  encounterTables = new Map<string, EncounterTable>();
  log: LogEntry[] = [];
  /** Seat ids currently connected (managed by the hub). */
  online = new Set<string>();
  /** DM undo history (in-memory; newest last). */
  undoStack: UndoEntry[] = [];

  constructor(
    private db: DB,
    row: { id: string; name: string; dm_secret: string; player_secret: string; active_map_id: string | null; settings: string },
  ) {
    this.id = row.id;
    this.dmSecret = row.dm_secret;
    this.playerSecret = row.player_secret;
    this.campaign = {
      id: row.id,
      name: row.name,
      activeMapId: row.active_map_id,
      settings: CampaignSettingsSchema.parse(safeJson(row.settings)),
    };
    this.load();
  }

  // -- loading ---------------------------------------------------------------

  private load(): void {
    const d = this.db;
    for (const s of d
      .prepare('SELECT * FROM seat WHERE campaign_id = ?')
      .all(this.id) as Array<Record<string, unknown>>) {
      this.seats.set(s.id as string, {
        id: s.id as string,
        campaignId: this.id,
        role: s.role as SeatRole,
        name: s.name as string,
        token: s.token as string,
        characterId: (s.character_id as string | null) ?? null,
      });
    }
    for (const c of d
      .prepare('SELECT * FROM character WHERE campaign_id = ?')
      .all(this.id) as Array<Record<string, unknown>>) {
      this.characters.set(c.id as string, {
        id: c.id as string,
        name: c.name as string,
        color: c.color as string,
        glyph: c.glyph as string,
        speed: c.speed as number,
        skills: SkillsSchema.parse(safeJson(c.skills as string)),
      });
    }
    for (const m of d
      .prepare('SELECT * FROM map WHERE campaign_id = ? ORDER BY sort_order')
      .all(this.id) as Array<Record<string, unknown>>) {
      const info: MapInfo = {
        id: m.id as string,
        name: m.name as string,
        orientation: m.orientation as MapInfo['orientation'],
        hexSize: m.hex_size as number,
        originX: m.origin_x as number,
        originY: m.origin_y as number,
        gridStyle: GridStyleSchema.parse(safeJson(m.grid_style as string)),
        sightRadius: m.sight_radius as number,
        fogMode: m.fog_mode as MapInfo['fogMode'],
        fogDecay: Boolean(m.fog_decay),
        moveMode: m.move_mode as MapInfo['moveMode'],
        moveApproval: Boolean(m.move_approval),
        milesPerHex: m.miles_per_hex as number,
        encounterCheck: EncounterCheckConfigSchema.parse(safeJson(m.encounter_check as string)),
        sortOrder: m.sort_order as number,
      };
      this.maps.set(info.id, info);
      this.mapStates.set(info.id, this.loadMapRuntime(info.id));
    }
    for (const t of d
      .prepare('SELECT * FROM enc_table WHERE campaign_id = ?')
      .all(this.id) as Array<Record<string, unknown>>) {
      this.encounterTables.set(t.id as string, {
        id: t.id as string,
        name: t.name as string,
        terrains: safeJson(t.terrains as string, []) as TerrainId[],
        die: t.die as string,
        entries: safeJson(t.entries as string, []) as EncounterTable['entries'],
      });
    }
    for (const dd of d
      .prepare('SELECT * FROM discovery WHERE campaign_id = ?')
      .all(this.id) as Array<Record<string, unknown>>) {
      const disc: Discovery = {
        id: dd.id as string,
        clueId: dd.clue_id as string,
        characterId: dd.character_id as string,
        at: dd.at as number,
        how: safeJson(dd.how as string, { kind: 'manual' }) as Discovery['how'],
        direction: (dd.direction as string | null) ?? null,
      };
      this.discoveries.set(disc.id, disc);
      this.discoveredByClueChar.add(`${disc.clueId}|${disc.characterId}`);
    }
    this.log = (
      d
        .prepare('SELECT * FROM log WHERE campaign_id = ? ORDER BY at DESC, id DESC LIMIT ?')
        .all(this.id, LOG_MEMORY_LIMIT) as Array<Record<string, unknown>>
    )
      .map(
        (l): LogEntry => ({
          id: l.id as string,
          at: l.at as number,
          kind: l.kind as string,
          text: l.text as string,
          visibility: l.visibility as string,
          data: safeJson(l.data as string, {}) as Record<string, unknown>,
        }),
      )
      .reverse();
  }

  private loadMapRuntime(mapId: string): MapRuntime {
    const d = this.db;
    const rt: MapRuntime = {
      hexes: new Map(),
      fog: new Map(),
      tokens: new Map(),
      markers: new Map(),
      contents: new Map(),
      pendingMoves: new Map(),
    };
    for (const h of d.prepare('SELECT * FROM hex WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      rt.hexes.set(hexKey(h.q as number, h.r as number), h.terrain as TerrainId);
    }
    for (const f of d.prepare('SELECT * FROM fog WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      rt.fog.set(hexKey(f.q as number, f.r as number), f.state as FogState);
    }
    for (const t of d.prepare('SELECT * FROM token WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      rt.tokens.set(t.id as string, {
        id: t.id as string,
        mapId,
        q: t.q as number,
        r: t.r as number,
        kind: t.kind as Token['kind'],
        characterId: (t.character_id as string | null) ?? null,
        label: t.label as string,
        color: t.color as string,
        glyph: t.glyph as string,
        playerVisible: Boolean(t.player_visible),
        partyId: (t.party_id as string | null) ?? null,
      });
    }
    for (const m of d.prepare('SELECT * FROM marker WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      rt.markers.set(m.id as string, {
        id: m.id as string,
        mapId,
        q: m.q as number,
        r: m.r as number,
        glyph: m.glyph as string,
        label: m.label as string,
        dmOnly: Boolean(m.dm_only),
      });
    }
    for (const c of d.prepare('SELECT * FROM content WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      const clues = (
        d.prepare('SELECT * FROM clue WHERE content_id = ? ORDER BY sort_order').all(c.id) as Array<
          Record<string, unknown>
        >
      ).map((cl) => ({
        id: cl.id as string,
        contentId: c.id as string,
        text: cl.text as string,
        gate: GateSchema.parse(safeJson(cl.gate as string)),
        sortOrder: cl.sort_order as number,
        indicatesDirection: Boolean(cl.indicates_direction),
      }));
      rt.contents.set(c.id as string, {
        id: c.id as string,
        mapId,
        q: c.q as number,
        r: c.r as number,
        type: c.type as Content['type'],
        title: c.title as string,
        dmNotes: c.dm_notes as string,
        glyph: c.glyph as string,
        showLabel: Boolean(c.show_label),
        scaleVisibility: (c.scale_visibility as number) ?? 1,
        wikiPage: (c.wiki_page as string) ?? '',
        clues,
      });
    }
    return rt;
  }

  // -- snapshot --------------------------------------------------------------

  seatsPublic(): SeatPublic[] {
    return [...this.seats.values()].map((s) => ({
      id: s.id,
      role: s.role,
      name: s.name,
      characterId: s.characterId,
      online: this.online.has(s.id),
    }));
  }

  mapState(mapId: string | null): MapState | null {
    if (!mapId) return null;
    const rt = this.mapStates.get(mapId);
    if (!rt) return null;
    return {
      imageLayers: this.imageLayersFor(mapId),
      hexes: [...rt.hexes.entries()].map(([k, terrain]): HexCell => ({ ...parseHexKey(k), terrain })),
      fog: [...rt.fog.entries()].map(([k, state]) => ({ ...parseHexKey(k), state })),
      tokens: [...rt.tokens.values()],
      markers: [...rt.markers.values()],
      contents: [...rt.contents.values()],
      pendingMoves: [...rt.pendingMoves.values()],
    };
  }

  imageLayersFor(mapId: string): ImageLayer[] {
    return (
      this.db.prepare('SELECT * FROM image_layer WHERE map_id = ? ORDER BY z').all(mapId) as Array<
        Record<string, unknown>
      >
    ).map((l) => ({
      id: l.id as string,
      mapId,
      path: l.path as string,
      name: l.name as string,
      x: l.x as number,
      y: l.y as number,
      scale: l.scale as number,
      opacity: l.opacity as number,
      z: l.z as number,
      dmOnly: Boolean(l.dm_only),
      visible: Boolean(l.visible),
    }));
  }

  /**
   * Full (DM-level) state. `viewMapId` selects which map's state to embed
   * (per-connection map browsing); campaign.activeMapId in the result is
   * rewritten to match so clients render the map they asked for.
   */
  buildFullState(viewMapId?: string | null): CampaignState {
    const mapId = viewMapId && this.maps.has(viewMapId) ? viewMapId : this.campaign.activeMapId;
    return {
      campaign: { ...this.campaign, activeMapId: mapId },
      seats: this.seatsPublic(),
      characters: [...this.characters.values()],
      maps: [...this.maps.values()].sort((a, b) => a.sortOrder - b.sortOrder),
      mapState: this.mapState(mapId),
      discoveries: [...this.discoveries.values()],
      encounterTables: [...this.encounterTables.values()],
      log: this.log,
    };
  }

  // -- campaign / seats / characters ----------------------------------------

  updateCampaign(patch: { name?: string; settings?: Partial<CampaignSettings> }): void {
    if (patch.name !== undefined) this.campaign.name = patch.name;
    if (patch.settings) this.campaign.settings = { ...this.campaign.settings, ...patch.settings };
    this.db
      .prepare('UPDATE campaign SET name = ?, settings = ? WHERE id = ?')
      .run(this.campaign.name, JSON.stringify(this.campaign.settings), this.id);
  }

  setActiveMap(mapId: string | null): void {
    this.campaign.activeMapId = mapId;
    this.db.prepare('UPDATE campaign SET active_map_id = ? WHERE id = ?').run(mapId, this.id);
  }

  createSeat(role: SeatRole, name: string): SeatRecord {
    const seat: SeatRecord = {
      id: nanoid(12),
      campaignId: this.id,
      role,
      name,
      token: nanoid(32),
      characterId: null,
    };
    this.db
      .prepare('INSERT INTO seat (id, campaign_id, role, name, token, character_id, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(seat.id, this.id, seat.role, seat.name, seat.token, null, Date.now());
    this.seats.set(seat.id, seat);
    return seat;
  }

  renameSeat(seatId: string, name: string): void {
    const seat = this.seats.get(seatId);
    if (!seat) throw new Error('Seat not found');
    seat.name = name;
    this.db.prepare('UPDATE seat SET name = ? WHERE id = ?').run(name, seatId);
  }

  deleteSeat(seatId: string): void {
    this.seats.delete(seatId);
    this.online.delete(seatId);
    this.db.prepare('DELETE FROM seat WHERE id = ?').run(seatId);
  }

  claimCharacter(seatId: string, characterId: string | null): void {
    const seat = this.seats.get(seatId);
    if (!seat) throw new Error('Seat not found');
    if (characterId && !this.characters.has(characterId)) throw new Error('Character not found');
    if (characterId) {
      for (const other of this.seats.values()) {
        if (other.id !== seatId && other.characterId === characterId) {
          throw new Error(`${other.name} has already claimed that character`);
        }
      }
    }
    seat.characterId = characterId;
    this.db.prepare('UPDATE seat SET character_id = ? WHERE id = ?').run(characterId, seatId);
  }

  upsertCharacter(character: Character): void {
    this.characters.set(character.id, character);
    this.db
      .prepare(
        `INSERT INTO character (id, campaign_id, name, color, glyph, speed, skills) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, glyph=excluded.glyph, speed=excluded.speed, skills=excluded.skills`,
      )
      .run(
        character.id,
        this.id,
        character.name,
        character.color,
        character.glyph,
        character.speed,
        JSON.stringify(character.skills),
      );
  }

  deleteCharacter(characterId: string): void {
    this.characters.delete(characterId);
    this.db.prepare('DELETE FROM character WHERE id = ?').run(characterId);
    for (const seat of this.seats.values()) {
      if (seat.characterId === characterId) this.claimCharacter(seat.id, null);
    }
    for (const [mapId, rt] of this.mapStates) {
      for (const token of [...rt.tokens.values()]) {
        if (token.characterId === characterId) this.updateToken(mapId, token.id, { characterId: null });
      }
    }
  }

  // -- maps ------------------------------------------------------------------

  createMap(info: MapInfo): void {
    this.maps.set(info.id, info);
    this.mapStates.set(info.id, {
      hexes: new Map(),
      fog: new Map(),
      tokens: new Map(),
      markers: new Map(),
      contents: new Map(),
      pendingMoves: new Map(),
    });
    this.db
      .prepare(
        `INSERT INTO map (id, campaign_id, name, orientation, hex_size, origin_x, origin_y, grid_style,
          sight_radius, fog_mode, fog_decay, move_mode, miles_per_hex, encounter_check, sort_order, move_approval)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        info.id,
        this.id,
        info.name,
        info.orientation,
        info.hexSize,
        info.originX,
        info.originY,
        JSON.stringify(info.gridStyle),
        info.sightRadius,
        info.fogMode,
        info.fogDecay ? 1 : 0,
        info.moveMode,
        info.milesPerHex,
        JSON.stringify(info.encounterCheck),
        info.sortOrder,
        info.moveApproval ? 1 : 0,
      );
  }

  updateMap(mapId: string, patch: Partial<MapInfo>): MapInfo {
    const map = this.maps.get(mapId);
    if (!map) throw new Error('Map not found');
    const updated: MapInfo = {
      ...map,
      ...patch,
      id: map.id,
      gridStyle: { ...map.gridStyle, ...(patch.gridStyle ?? {}) },
      encounterCheck: { ...map.encounterCheck, ...(patch.encounterCheck ?? {}) },
    };
    this.maps.set(mapId, updated);
    this.db
      .prepare(
        `UPDATE map SET name=?, orientation=?, hex_size=?, origin_x=?, origin_y=?, grid_style=?,
          sight_radius=?, fog_mode=?, fog_decay=?, move_mode=?, miles_per_hex=?, encounter_check=?, sort_order=?, move_approval=?
         WHERE id=?`,
      )
      .run(
        updated.name,
        updated.orientation,
        updated.hexSize,
        updated.originX,
        updated.originY,
        JSON.stringify(updated.gridStyle),
        updated.sightRadius,
        updated.fogMode,
        updated.fogDecay ? 1 : 0,
        updated.moveMode,
        updated.milesPerHex,
        JSON.stringify(updated.encounterCheck),
        updated.sortOrder,
        updated.moveApproval ? 1 : 0,
        mapId,
      );
    return updated;
  }

  deleteMap(mapId: string): void {
    this.maps.delete(mapId);
    this.mapStates.delete(mapId);
    this.db.prepare('DELETE FROM map WHERE id = ?').run(mapId);
    if (this.campaign.activeMapId === mapId) {
      const next = [...this.maps.keys()][0] ?? null;
      this.setActiveMap(next);
    }
  }

  // -- image layers ----------------------------------------------------------

  addImageLayer(layer: ImageLayer): void {
    this.db
      .prepare(
        'INSERT INTO image_layer (id, map_id, path, name, x, y, scale, opacity, z, dm_only, visible) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        layer.id,
        layer.mapId,
        layer.path,
        layer.name,
        layer.x,
        layer.y,
        layer.scale,
        layer.opacity,
        layer.z,
        layer.dmOnly ? 1 : 0,
        layer.visible ? 1 : 0,
      );
  }

  updateImageLayer(layerId: string, patch: Partial<ImageLayer>): ImageLayer {
    const row = this.db.prepare('SELECT * FROM image_layer WHERE id = ?').get(layerId) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error('Image layer not found');
    const current: ImageLayer = {
      id: row.id as string,
      mapId: row.map_id as string,
      path: row.path as string,
      name: row.name as string,
      x: row.x as number,
      y: row.y as number,
      scale: row.scale as number,
      opacity: row.opacity as number,
      z: row.z as number,
      dmOnly: Boolean(row.dm_only),
      visible: Boolean(row.visible),
    };
    const updated = { ...current, ...patch, id: current.id, mapId: current.mapId, path: current.path };
    this.db
      .prepare('UPDATE image_layer SET name=?, x=?, y=?, scale=?, opacity=?, z=?, dm_only=?, visible=? WHERE id=?')
      .run(updated.name, updated.x, updated.y, updated.scale, updated.opacity, updated.z, updated.dmOnly ? 1 : 0, updated.visible ? 1 : 0, layerId)
    return updated;
  }

  deleteImageLayer(layerId: string): string | null {
    const row = this.db.prepare('SELECT path FROM image_layer WHERE id = ?').get(layerId) as
      | { path: string }
      | undefined;
    this.db.prepare('DELETE FROM image_layer WHERE id = ?').run(layerId);
    return row?.path ?? null;
  }

  findImageLayer(layerId: string): ImageLayer | null {
    const row = this.db.prepare('SELECT * FROM image_layer WHERE id = ?').get(layerId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    if (!this.maps.has(row.map_id as string)) return null;
    return {
      id: row.id as string,
      mapId: row.map_id as string,
      path: row.path as string,
      name: row.name as string,
      x: row.x as number,
      y: row.y as number,
      scale: row.scale as number,
      opacity: row.opacity as number,
      z: row.z as number,
      dmOnly: Boolean(row.dm_only),
      visible: Boolean(row.visible),
    };
  }

  // -- terrain & fog ---------------------------------------------------------

  paintTerrain(
    mapId: string,
    cells: { q: number; r: number }[],
    terrain: TerrainId | null,
  ): { q: number; r: number; prev: TerrainId | null }[] {
    const rt = this.requireMap(mapId);
    const del = this.db.prepare('DELETE FROM hex WHERE map_id = ? AND q = ? AND r = ?');
    const put = this.db.prepare(
      'INSERT INTO hex (map_id, q, r, terrain) VALUES (?,?,?,?) ON CONFLICT(map_id,q,r) DO UPDATE SET terrain=excluded.terrain',
    );
    const changed: { q: number; r: number; prev: TerrainId | null }[] = [];
    const tx = this.db.transaction(() => {
      for (const c of cells) {
        const key = hexKey(c.q, c.r);
        const prev = rt.hexes.get(key) ?? null;
        if (prev === terrain) continue;
        changed.push({ q: c.q, r: c.r, prev });
        if (terrain === null) {
          rt.hexes.delete(key);
          del.run(mapId, c.q, c.r);
        } else {
          rt.hexes.set(key, terrain);
          put.run(mapId, c.q, c.r, terrain);
        }
      }
    });
    tx();
    return changed;
  }

  /** Set fog state; returns only the cells that actually changed. */
  setFog(
    mapId: string,
    cells: { q: number; r: number }[],
    state: FogState,
  ): { q: number; r: number; state: FogState; prev: FogState }[] {
    const rt = this.requireMap(mapId);
    const changed: { q: number; r: number; state: FogState; prev: FogState }[] = [];
    const del = this.db.prepare('DELETE FROM fog WHERE map_id = ? AND q = ? AND r = ?');
    const put = this.db.prepare(
      'INSERT INTO fog (map_id, q, r, state) VALUES (?,?,?,?) ON CONFLICT(map_id,q,r) DO UPDATE SET state=excluded.state',
    );
    const tx = this.db.transaction(() => {
      for (const c of cells) {
        const key = hexKey(c.q, c.r);
        const prev = rt.fog.get(key) ?? 'hidden';
        if (prev === state) continue;
        if (state === 'hidden') {
          rt.fog.delete(key);
          del.run(mapId, c.q, c.r);
        } else {
          rt.fog.set(key, state);
          put.run(mapId, c.q, c.r, state);
        }
        changed.push({ q: c.q, r: c.r, state, prev });
      }
    });
    tx();
    return changed;
  }

  // -- tokens ----------------------------------------------------------------

  createToken(token: Token): void {
    const rt = this.requireMap(token.mapId);
    rt.tokens.set(token.id, token);
    this.db
      .prepare(
        'INSERT INTO token (id, map_id, q, r, kind, character_id, label, color, glyph, player_visible, party_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        token.id,
        token.mapId,
        token.q,
        token.r,
        token.kind,
        token.characterId,
        token.label,
        token.color,
        token.glyph,
        token.playerVisible ? 1 : 0,
        token.partyId,
      );
  }

  updateToken(mapId: string, tokenId: string, patch: Partial<Token>): Token {
    const rt = this.requireMap(mapId);
    const token = rt.tokens.get(tokenId);
    if (!token) throw new Error('Token not found');
    const updated: Token = { ...token, ...patch, id: token.id, mapId: token.mapId };
    rt.tokens.set(tokenId, updated);
    this.db
      .prepare(
        'UPDATE token SET q=?, r=?, character_id=?, label=?, color=?, glyph=?, player_visible=?, party_id=? WHERE id=?',
      )
      .run(
        updated.q,
        updated.r,
        updated.characterId,
        updated.label,
        updated.color,
        updated.glyph,
        updated.playerVisible ? 1 : 0,
        updated.partyId,
        tokenId,
      );
    return updated;
  }

  deleteToken(mapId: string, tokenId: string): void {
    const rt = this.requireMap(mapId);
    rt.tokens.delete(tokenId);
    this.db.prepare('DELETE FROM token WHERE id = ?').run(tokenId);
  }

  findToken(tokenId: string): Token | null {
    for (const rt of this.mapStates.values()) {
      const t = rt.tokens.get(tokenId);
      if (t) return t;
    }
    return null;
  }

  // -- markers ---------------------------------------------------------------

  placeMarker(marker: Marker): void {
    const rt = this.requireMap(marker.mapId);
    rt.markers.set(marker.id, marker);
    this.db
      .prepare('INSERT INTO marker (id, map_id, q, r, glyph, label, dm_only) VALUES (?,?,?,?,?,?,?)')
      .run(marker.id, marker.mapId, marker.q, marker.r, marker.glyph, marker.label, marker.dmOnly ? 1 : 0);
  }

  updateMarker(markerId: string, patch: Partial<Marker>): Marker {
    const found = this.findMarker(markerId);
    if (!found) throw new Error('Marker not found');
    const rt = this.requireMap(found.mapId);
    const updated: Marker = { ...found, ...patch, id: found.id, mapId: found.mapId };
    rt.markers.set(markerId, updated);
    this.db
      .prepare('UPDATE marker SET q=?, r=?, glyph=?, label=?, dm_only=? WHERE id=?')
      .run(updated.q, updated.r, updated.glyph, updated.label, updated.dmOnly ? 1 : 0, markerId);
    return updated;
  }

  deleteMarker(markerId: string): Marker | null {
    const found = this.findMarker(markerId);
    if (!found) return null;
    this.requireMap(found.mapId).markers.delete(markerId);
    this.db.prepare('DELETE FROM marker WHERE id = ?').run(markerId);
    return found;
  }

  findMarker(markerId: string): Marker | null {
    for (const rt of this.mapStates.values()) {
      const m = rt.markers.get(markerId);
      if (m) return m;
    }
    return null;
  }

  // -- content & clues -------------------------------------------------------

  upsertContent(content: Content): void {
    const rt = this.requireMap(content.mapId);
    const existing = rt.contents.get(content.id);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO content (id, map_id, q, r, type, title, dm_notes, glyph, show_label, scale_visibility, wiki_page) VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET q=excluded.q, r=excluded.r, type=excluded.type, title=excluded.title, dm_notes=excluded.dm_notes, glyph=excluded.glyph, show_label=excluded.show_label, scale_visibility=excluded.scale_visibility, wiki_page=excluded.wiki_page`,
        )
        .run(content.id, content.mapId, content.q, content.r, content.type, content.title, content.dmNotes, content.glyph, content.showLabel ? 1 : 0, content.scaleVisibility, content.wikiPage);
      const keep = new Set(content.clues.map((c) => c.id));
      if (existing) {
        for (const old of existing.clues) {
          if (!keep.has(old.id)) this.db.prepare('DELETE FROM clue WHERE id = ?').run(old.id);
        }
      }
      const put = this.db.prepare(
        `INSERT INTO clue (id, content_id, text, gate, sort_order, indicates_direction) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET text=excluded.text, gate=excluded.gate, sort_order=excluded.sort_order, indicates_direction=excluded.indicates_direction`,
      );
      for (const clue of content.clues) {
        put.run(
          clue.id,
          content.id,
          clue.text,
          JSON.stringify(clue.gate),
          clue.sortOrder,
          clue.indicatesDirection ? 1 : 0,
        );
      }
    });
    tx();
    rt.contents.set(content.id, content);
    // Deleted clues cascade their discoveries in SQL; mirror in memory.
    if (existing) {
      const keep = new Set(content.clues.map((c) => c.id));
      for (const old of existing.clues) {
        if (!keep.has(old.id)) {
          for (const [id, disc] of this.discoveries) {
            if (disc.clueId === old.id) {
              this.discoveries.delete(id);
              this.discoveredByClueChar.delete(`${disc.clueId}|${disc.characterId}`);
            }
          }
        }
      }
    }
  }

  deleteContent(contentId: string): Content | null {
    for (const rt of this.mapStates.values()) {
      const c = rt.contents.get(contentId);
      if (c) {
        rt.contents.delete(contentId);
        this.db.prepare('DELETE FROM content WHERE id = ?').run(contentId);
        for (const [id, disc] of this.discoveries) {
          if (c.clues.some((cl) => cl.id === disc.clueId)) {
            this.discoveries.delete(id);
            this.discoveredByClueChar.delete(`${disc.clueId}|${disc.characterId}`);
          }
        }
        return c;
      }
    }
    return null;
  }

  findContentByClue(clueId: string): Content | null {
    for (const rt of this.mapStates.values()) {
      for (const c of rt.contents.values()) {
        if (c.clues.some((cl) => cl.id === clueId)) return c;
      }
    }
    return null;
  }

  hasDiscovery(clueId: string, characterId: string): boolean {
    return this.discoveredByClueChar.has(`${clueId}|${characterId}`);
  }

  addDiscovery(discovery: Discovery): boolean {
    if (this.hasDiscovery(discovery.clueId, discovery.characterId)) return false;
    this.discoveries.set(discovery.id, discovery);
    this.discoveredByClueChar.add(`${discovery.clueId}|${discovery.characterId}`);
    this.db
      .prepare(
        'INSERT INTO discovery (id, campaign_id, clue_id, character_id, at, how, direction) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        discovery.id,
        this.id,
        discovery.clueId,
        discovery.characterId,
        discovery.at,
        JSON.stringify(discovery.how),
        discovery.direction,
      );
    return true;
  }

  revokeDiscovery(discoveryId: string): Discovery | null {
    const disc = this.discoveries.get(discoveryId);
    if (!disc) return null;
    this.discoveries.delete(discoveryId);
    this.discoveredByClueChar.delete(`${disc.clueId}|${disc.characterId}`);
    this.db.prepare('DELETE FROM discovery WHERE id = ?').run(discoveryId);
    return disc;
  }

  // -- encounter tables ------------------------------------------------------

  upsertEncounterTable(table: EncounterTable): void {
    this.encounterTables.set(table.id, table);
    this.db
      .prepare(
        `INSERT INTO enc_table (id, campaign_id, name, terrains, die, entries) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, terrains=excluded.terrains, die=excluded.die, entries=excluded.entries`,
      )
      .run(table.id, this.id, table.name, JSON.stringify(table.terrains), table.die, JSON.stringify(table.entries));
  }

  deleteEncounterTable(tableId: string): void {
    this.encounterTables.delete(tableId);
    this.db.prepare('DELETE FROM enc_table WHERE id = ?').run(tableId);
  }

  // -- log -------------------------------------------------------------------

  pushUndo(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > UNDO_STACK_LIMIT) this.undoStack.shift();
  }

  appendLog(kind: string, text: string, visibility: string, data: Record<string, unknown> = {}): LogEntry {
    const entry: LogEntry = { id: nanoid(12), at: Date.now(), kind, text, visibility, data };
    this.log.push(entry);
    if (this.log.length > LOG_MEMORY_LIMIT) this.log.shift();
    this.db
      .prepare('INSERT INTO log (id, campaign_id, at, kind, text, visibility, data) VALUES (?,?,?,?,?,?,?)')
      .run(entry.id, this.id, entry.at, entry.kind, entry.text, entry.visibility, JSON.stringify(entry.data));
    return entry;
  }

  // -- helpers ---------------------------------------------------------------

  requireMap(mapId: string): MapRuntime {
    const rt = this.mapStates.get(mapId);
    if (!rt) throw new Error('Map not found');
    return rt;
  }
}

function safeJson(text: string | null | undefined, fallback: unknown = {}): unknown {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
