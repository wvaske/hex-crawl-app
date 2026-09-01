import { nanoid } from 'nanoid';
import type {
  Campaign,
  PendingMove,
  CampaignSettings,
  CampaignState,
  CampaignTime,
  Character,
  Content,
  Discovery,
  Trail,
  TrailDiscovery,
  EncounterTable,
  FogState,
  HexCell,
  HexVisit,
  ImageLayer,
  InheritableMapField,
  LogEntry,
  MapDefaults,
  MapInfo,
  MapState,
  Marker,
  PendingReveal,
  SearchAttempt,
  SeatPublic,
  SeatRole,
  TerrainId,
  Token,
} from '@hexcrawl/shared';
import {
  CampaignSettingsSchema,
  CampaignTimeSchema,
  CharacterExtraSchema,
  EncounterCheckConfigSchema,
  GateSchema,
  GridStyleSchema,
  INHERITABLE_MAP_FIELDS,
  SkillsSchema,
  hexKey,
  parseHexKey,
} from '@hexcrawl/shared';
import type { DB } from '../db/driver.js';

export interface SeatRecord {
  id: string;
  campaignId: string;
  role: SeatRole;
  name: string;
  token: string;
  characterId: string | null;
}

/** Nested patch shape for campaign settings (mapDefaults merges field-wise). */
export type CampaignSettingsPatch = Partial<Omit<CampaignSettings, 'mapDefaults'>> & {
  mapDefaults?: Partial<Omit<MapDefaults, 'encounterCheck'>> & {
    encounterCheck?: Partial<MapDefaults['encounterCheck']>;
  };
};

export interface MapRuntime {
  /**
   * Image layers, keyed by id. Held in memory like every other map layer
   * (issue #73): `mapState()` runs on every snapshot, and a DB read there is
   * the one hot-path query an async backend could not serve synchronously.
   */
  imageLayers: Map<string, ImageLayer>;
  hexes: Map<string, TerrainId>;
  fog: Map<string, FogState>;
  tokens: Map<string, Token>;
  markers: Map<string, Marker>;
  contents: Map<string, Content>;
  /** In-memory only: player moves awaiting DM approval, by tokenId. */
  pendingMoves: Map<string, PendingMove>;
  trails: Map<string, Trail>;
  /** Party visit accounting per hex, keyed by hexKey. */
  visits: Map<string, HexVisit>;
  /** Search rolls made on this map (issue #107), keyed by attempt id. */
  searchAttempts: Map<string, SearchAttempt>;
}

const LOG_MEMORY_LIMIT = 500;
const UNDO_STACK_LIMIT = 100;

/** The DM-editable map layers held stable for players during prep mode. */
interface FrozenMapLayers {
  imageLayers: ImageLayer[];
  hexes: HexCell[];
  markers: Marker[];
  contents: Content[];
  trails: Trail[];
}

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
 * All state for one campaign, held in memory and written through to the
 * database on every mutation. The write-through is synchronous from this
 * class's point of view whichever backend is configured (`db/driver.ts`):
 * SQLite writes are durable when `run` returns, Postgres queues them in order.
 * Every read after boot comes from memory — the runtime IS the cache.
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
  trailDiscoveries = new Map<string, TrailDiscovery>();
  private trailDiscoveryKeys = new Set<string>();
  /** Search results awaiting the DM's share/withhold call (issue #107). */
  pendingReveals = new Map<string, PendingReveal>();
  encounterTables = new Map<string, EncounterTable>();
  log: LogEntry[] = [];
  /** Seat ids currently connected (managed by the hub). */
  online = new Set<string>();
  /** DM undo history (in-memory; newest last). */
  undoStack: UndoEntry[] = [];
  /**
   * Prep mode (settings.pausePlayerMapSync): per-map snapshot of the editable
   * layers as players last saw them. In-memory; recaptured at boot when the
   * pause survived a restart.
   */
  private frozenPlayerMaps = new Map<string, FrozenMapLayers>();

  constructor(
    private db: DB,
    row: {
      id: string;
      name: string;
      dm_secret: string;
      player_secret: string;
      active_map_id: string | null;
      settings: string;
      /** Added after first release; absent on rows selected before the column. */
      time?: string | null;
    },
    /**
     * Set for a campaign this process just INSERTed: there is nothing on disk
     * to load yet, and skipping `load()` keeps `Store.createCampaign`
     * synchronous on backends whose reads are async (`db/driver.ts`).
     */
    opts: { fresh?: boolean } = {},
  ) {
    this.id = row.id;
    this.dmSecret = row.dm_secret;
    this.playerSecret = row.player_secret;
    this.campaign = {
      id: row.id,
      name: row.name,
      activeMapId: row.active_map_id,
      settings: CampaignSettingsSchema.parse(safeJson(row.settings)),
      time: CampaignTimeSchema.parse(safeJson(row.time)),
    };
    if (!opts.fresh) this.load();
    if (this.campaign.settings.pausePlayerMapSync) this.capturePlayerFreeze();
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
        ddbId: (c.ddb_id as string | null) ?? null,
        extra: CharacterExtraSchema.parse(safeJson(c.extra as string)),
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
        inheritedFields: (safeJson(m.inherited_fields as string, []) as unknown[]).filter(
          (f): f is string => typeof f === 'string',
        ),
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
        enabled: Boolean(t.enabled ?? 1),
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
        locates: Boolean(dd.locates),
      };
      this.discoveries.set(disc.id, disc);
      this.discoveredByClueChar.add(`${disc.clueId}|${disc.characterId}`);
    }
    for (const td of d
      .prepare('SELECT * FROM trail_discovery WHERE campaign_id = ?')
      .all(this.id) as Array<Record<string, unknown>>) {
      const disc: TrailDiscovery = {
        id: td.id as string,
        trailId: td.trail_id as string,
        cellIndex: td.cell_index as number,
        characterId: td.character_id as string,
        at: td.at as number,
      };
      this.trailDiscoveries.set(disc.id, disc);
      this.trailDiscoveryKeys.add(`${disc.trailId}|${disc.cellIndex}|${disc.characterId}`);
    }
    for (const pr of d
      .prepare('SELECT * FROM pending_reveal WHERE campaign_id = ?')
      .all(this.id) as Array<Record<string, unknown>>) {
      this.pendingReveals.set(pr.id as string, {
        id: pr.id as string,
        clueId: pr.clue_id as string,
        characterId: pr.character_id as string,
        attemptId: pr.attempt_id as string,
        direction: (pr.direction as string | null) ?? null,
        locates: Boolean(pr.locates),
        roll: pr.roll as number,
        modifier: pr.modifier as number,
        total: pr.total as number,
        at: pr.at as number,
      });
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
      imageLayers: new Map(),
      hexes: new Map(),
      fog: new Map(),
      tokens: new Map(),
      markers: new Map(),
      contents: new Map(),
      pendingMoves: new Map(),
      trails: new Map(),
      visits: new Map(),
      searchAttempts: new Map(),
    };
    for (const a of d.prepare('SELECT * FROM search_attempt WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      rt.searchAttempts.set(a.id as string, searchAttemptFromRow(mapId, a));
    }
    for (const l of d
      .prepare('SELECT * FROM image_layer WHERE map_id = ? ORDER BY z')
      .all(mapId) as Array<Record<string, unknown>>) {
      rt.imageLayers.set(l.id as string, imageLayerFromRow(mapId, l));
    }
    for (const v of d.prepare('SELECT * FROM hex_visit WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      rt.visits.set(hexKey(v.q as number, v.r as number), {
        q: v.q as number,
        r: v.r as number,
        firstArrived: v.first_arrived as number,
        lastArrived: v.last_arrived as number,
        totalMinutes: v.total_minutes as number,
      });
    }
    for (const t of d.prepare('SELECT * FROM trail WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      rt.trails.set(t.id as string, {
        id: t.id as string,
        mapId,
        name: t.name as string,
        glyph: t.glyph as string,
        dmNotes: t.dm_notes as string,
        gate: GateSchema.parse(safeJson(t.gate as string, { kind: 'auto' })),
        cells: safeJson(t.cells as string, []) as Trail['cells'],
      });
    }
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
        icon: (m.icon as string | null) ?? '',
        scale: (m.scale as number | null) ?? 1,
        label: m.label as string,
        dmOnly: Boolean(m.dm_only),
        playerPlaced: Boolean(m.player_placed),
        ownerSeatId: (m.owner_seat_id as string | null) ?? null,
      });
    }
    for (const c of d.prepare('SELECT * FROM content WHERE map_id = ?').all(mapId) as Array<
      Record<string, unknown>
    >) {
      const clues = (
        d.prepare('SELECT * FROM clue WHERE content_id = ? ORDER BY sort_order').all(
          c.id as string,
        ) as Array<
          Record<string, unknown>
        >
      ).map((cl) => ({
        id: cl.id as string,
        contentId: c.id as string,
        text: cl.text as string,
        gate: GateSchema.parse(safeJson(cl.gate as string)),
        sortOrder: cl.sort_order as number,
        indicatesDirection: Boolean(cl.indicates_direction),
        revealsLocation: Boolean(cl.reveals_location ?? 1),
      }));
      rt.contents.set(c.id as string, {
        id: c.id as string,
        mapId,
        q: c.q as number,
        r: c.r as number,
        area: safeJson(c.area as string, []) as Content['area'],
        type: c.type as Content['type'],
        title: c.title as string,
        dmNotes: c.dm_notes as string,
        glyph: c.glyph as string,
        showLabel: Boolean(c.show_label),
        scaleVisibility: (c.scale_visibility as number) ?? 1,
        wikiPage: (c.wiki_page as string) ?? '',
        enabled: Boolean(c.enabled ?? 1),
        knownLocation: Boolean(c.known_location),
        quest: (c.quest as string) ?? '',
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
      trails: [...rt.trails.values()],
      trailSigns: [],
      visits: [...rt.visits.values()],
      searchAttempts: [...rt.searchAttempts.values()],
    };
  }

  /** A map's image layers, bottom to top (was `ORDER BY z` in SQL). */
  imageLayersFor(mapId: string): ImageLayer[] {
    const rt = this.mapStates.get(mapId);
    if (!rt) return [];
    return [...rt.imageLayers.values()].sort((a, b) => a.z - b.z);
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
      trailDiscoveries: [...this.trailDiscoveries.values()],
      senses: [],
      pendingReveals: [...this.pendingReveals.values()],
      encounterTables: [...this.encounterTables.values()],
      log: this.log,
    };
  }

  // -- prep-mode freeze ------------------------------------------------------

  /** Snapshot every map's editable layers as the player-visible baseline. */
  capturePlayerFreeze(): void {
    this.frozenPlayerMaps.clear();
    for (const mapId of this.maps.keys()) {
      const ms = this.mapState(mapId);
      if (!ms) continue;
      this.frozenPlayerMaps.set(mapId, {
        imageLayers: ms.imageLayers,
        hexes: ms.hexes,
        markers: ms.markers,
        contents: ms.contents as Content[],
        trails: ms.trails,
      });
    }
  }

  clearPlayerFreeze(): void {
    this.frozenPlayerMaps.clear();
  }

  /**
   * While prep mode is on, substitute the frozen editable layers into a
   * player's full state. Tokens, fog, pending moves, discoveries and the log
   * stay live; terrain, markers, content, images and trails hold at the
   * pause-time snapshot.
   *
   * Exception: player-placed party notes (issue #74) stay live through the
   * pause. They are player output, not DM prep — freezing them would make a
   * note a player drops mid-pause vanish for the whole party until resume.
   */
  applyPlayerFreeze(full: CampaignState): CampaignState {
    if (!this.campaign.settings.pausePlayerMapSync) return full;
    const mapId = full.campaign.activeMapId;
    if (!mapId || !full.mapState) return full;
    const frozen = this.frozenPlayerMaps.get(mapId);
    if (!frozen) return full;
    // Frozen DM markers, then every live player note (live wins by id, so an
    // edit lands and a delete removes the frozen copy).
    const markers = new Map(frozen.markers.filter((m) => !m.playerPlaced).map((m) => [m.id, m]));
    for (const m of full.mapState.markers) if (m.playerPlaced) markers.set(m.id, m);
    return {
      ...full,
      mapState: {
        ...full.mapState,
        imageLayers: frozen.imageLayers,
        hexes: frozen.hexes,
        markers: [...markers.values()],
        contents: frozen.contents,
        trails: frozen.trails,
      },
    };
  }

  // -- campaign / seats / characters ----------------------------------------

  updateCampaign(patch: { name?: string; settings?: CampaignSettingsPatch }): void {
    if (patch.name !== undefined) this.campaign.name = patch.name;
    if (patch.settings) {
      const { mapDefaults, ...rest } = patch.settings;
      const next: CampaignSettings = { ...this.campaign.settings, ...rest };
      if (mapDefaults) {
        // mapDefaults is a nested patch: merge field-wise (and its own
        // encounterCheck sub-object) so a one-field patch isn't a reset.
        next.mapDefaults = {
          ...this.campaign.settings.mapDefaults,
          ...mapDefaults,
          encounterCheck: {
            ...this.campaign.settings.mapDefaults.encounterCheck,
            ...(mapDefaults.encounterCheck ?? {}),
          },
        };
      }
      this.campaign.settings = next;
    }
    this.db
      .prepare('UPDATE campaign SET name = ?, settings = ? WHERE id = ?')
      .run(this.campaign.name, JSON.stringify(this.campaign.settings), this.id);
  }

  /**
   * Replace one invite secret with a fresh one and write it through. Old links
   * carrying the previous secret stop working immediately; seats that already
   * joined keep their cookies (the secret is only used to obtain a seat, and
   * — for the DM key — to authorize the integration API and `?key=` export).
   */
  rotateSecret(which: 'player' | 'dm'): string {
    const next = nanoid(24);
    if (which === 'dm') {
      this.dmSecret = next;
      this.db.prepare('UPDATE campaign SET dm_secret = ? WHERE id = ?').run(next, this.id);
    } else {
      this.playerSecret = next;
      this.db.prepare('UPDATE campaign SET player_secret = ? WHERE id = ?').run(next, this.id);
    }
    return next;
  }

  // -- campaign clock --------------------------------------------------------

  /** Patch the clock blob and write it through. */
  updateTime(patch: Partial<CampaignTime>): CampaignTime {
    this.campaign.time = { ...this.campaign.time, ...patch };
    this.db
      .prepare('UPDATE campaign SET time = ? WHERE id = ?')
      .run(JSON.stringify(this.campaign.time), this.id);
    return this.campaign.time;
  }

  /** Push the clock forward by whole minutes (never backwards). */
  advanceTime(minutes: number): CampaignTime {
    const delta = Math.max(0, Math.round(minutes));
    if (delta === 0) return this.campaign.time;
    return this.updateTime({ minutes: this.campaign.time.minutes + delta });
  }

  setTime(minutes: number): CampaignTime {
    return this.updateTime({ minutes: Math.max(0, Math.round(minutes)) });
  }

  // -- hex visits ------------------------------------------------------------

  hexVisit(mapId: string, q: number, r: number): HexVisit | null {
    return this.mapStates.get(mapId)?.visits.get(hexKey(q, r)) ?? null;
  }

  /**
   * Stamp the party's arrival on a hex at clock minute `at`, creating the
   * record on first visit.
   */
  recordHexArrival(mapId: string, q: number, r: number, at: number): HexVisit {
    const rt = this.requireMap(mapId);
    const key = hexKey(q, r);
    const existing = rt.visits.get(key);
    const visit: HexVisit = existing
      ? { ...existing, lastArrived: at }
      : { q, r, firstArrived: at, lastArrived: at, totalMinutes: 0 };
    rt.visits.set(key, visit);
    this.writeHexVisit(mapId, visit);
    return visit;
  }

  /** Credit minutes spent standing on a hex (no-op if never arrived there). */
  addHexTime(mapId: string, q: number, r: number, minutes: number): void {
    const delta = Math.max(0, Math.round(minutes));
    if (delta === 0) return;
    const rt = this.mapStates.get(mapId);
    if (!rt) return;
    const key = hexKey(q, r);
    const existing = rt.visits.get(key);
    if (!existing) return;
    const visit: HexVisit = { ...existing, totalMinutes: existing.totalMinutes + delta };
    rt.visits.set(key, visit);
    this.writeHexVisit(mapId, visit);
  }

  private writeHexVisit(mapId: string, visit: HexVisit): void {
    this.db
      .prepare(
        `INSERT INTO hex_visit (map_id, q, r, first_arrived, last_arrived, total_minutes) VALUES (?,?,?,?,?,?)
         ON CONFLICT(map_id,q,r) DO UPDATE SET first_arrived=excluded.first_arrived, last_arrived=excluded.last_arrived, total_minutes=excluded.total_minutes`,
      )
      .run(mapId, visit.q, visit.r, visit.firstArrived, visit.lastArrived, visit.totalMinutes);
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
        `INSERT INTO character (id, campaign_id, name, color, glyph, speed, skills, ddb_id, extra) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, glyph=excluded.glyph, speed=excluded.speed, skills=excluded.skills, ddb_id=excluded.ddb_id, extra=excluded.extra`,
      )
      .run(
        character.id,
        this.id,
        character.name,
        character.color,
        character.glyph,
        character.speed,
        JSON.stringify(character.skills),
        character.ddbId,
        JSON.stringify(character.extra),
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
      imageLayers: new Map(),
      hexes: new Map(),
      fog: new Map(),
      tokens: new Map(),
      markers: new Map(),
      contents: new Map(),
      pendingMoves: new Map(),
      trails: new Map(),
      visits: new Map(),
      searchAttempts: new Map(),
    });
    this.db
      .prepare(
        `INSERT INTO map (id, campaign_id, name, orientation, hex_size, origin_x, origin_y, grid_style,
          sight_radius, fog_mode, fog_decay, move_mode, miles_per_hex, encounter_check, sort_order, move_approval,
          inherited_fields)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        JSON.stringify(info.inheritedFields),
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
          sight_radius=?, fog_mode=?, fog_decay=?, move_mode=?, miles_per_hex=?, encounter_check=?, sort_order=?, move_approval=?,
          inherited_fields=?
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
        JSON.stringify(updated.inheritedFields),
        mapId,
      );
    return updated;
  }

  // -- campaign map defaults (inheritance, issue #60) -------------------------

  /**
   * Push the campaign defaults for `fields` into every map that inherits
   * them. Propagation-on-write: maps always hold concrete values, so nothing
   * downstream has to resolve inheritance. Returns the ids of maps changed.
   */
  propagateMapDefaults(fields: readonly InheritableMapField[] = INHERITABLE_MAP_FIELDS): string[] {
    const defaults = this.campaign.settings.mapDefaults;
    const touched: string[] = [];
    for (const map of [...this.maps.values()]) {
      const patch: Partial<MapInfo> = {};
      for (const field of fields) {
        if (!map.inheritedFields.includes(field)) continue;
        if (field === 'encounterCheck') {
          patch.encounterCheck = { ...map.encounterCheck, ...defaults.encounterCheck };
        } else {
          Object.assign(patch, { [field]: defaults[field] });
        }
      }
      if (Object.keys(patch).length > 0) {
        this.updateMap(map.id, patch);
        touched.push(map.id);
      }
    }
    return touched;
  }

  /**
   * Link one map setting to the campaign default (copying the default in
   * right away) or cut it loose as map-specific.
   */
  setMapInherit(mapId: string, field: InheritableMapField, inherit: boolean): MapInfo {
    const map = this.maps.get(mapId);
    if (!map) throw new Error('Map not found');
    const inheritedFields = map.inheritedFields.filter((f) => f !== field);
    if (!inherit) return this.updateMap(mapId, { inheritedFields });
    const defaults = this.campaign.settings.mapDefaults;
    const patch: Partial<MapInfo> = { inheritedFields: [...inheritedFields, field] };
    if (field === 'encounterCheck') {
      patch.encounterCheck = { ...map.encounterCheck, ...defaults.encounterCheck };
    } else {
      Object.assign(patch, { [field]: defaults[field] });
    }
    return this.updateMap(mapId, patch);
  }

  /** A map's settings as the campaign defaults would have them. */
  mapDefaultsForNewMap(): Pick<MapInfo, InheritableMapField> {
    const d = this.campaign.settings.mapDefaults;
    return {
      sightRadius: d.sightRadius,
      fogMode: d.fogMode,
      fogDecay: d.fogDecay,
      moveMode: d.moveMode,
      moveApproval: d.moveApproval,
      milesPerHex: d.milesPerHex,
      encounterCheck: EncounterCheckConfigSchema.parse({ ...d.encounterCheck }),
    };
  }

  deleteMap(mapId: string): void {
    // Pendings hang off attempts, which hang off the map: mirror the SQL
    // cascade in memory before the map runtime (and its attempts) goes.
    const attempts = this.mapStates.get(mapId)?.searchAttempts;
    if (attempts) {
      for (const [id, p] of this.pendingReveals) {
        if (attempts.has(p.attemptId)) this.pendingReveals.delete(id);
      }
    }
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
    this.requireMap(layer.mapId).imageLayers.set(layer.id, layer);
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
    const current = this.findImageLayer(layerId);
    if (!current) throw new Error('Image layer not found');
    const updated = { ...current, ...patch, id: current.id, mapId: current.mapId, path: current.path };
    this.requireMap(current.mapId).imageLayers.set(layerId, updated);
    this.db
      .prepare('UPDATE image_layer SET name=?, x=?, y=?, scale=?, opacity=?, z=?, dm_only=?, visible=? WHERE id=?')
      .run(updated.name, updated.x, updated.y, updated.scale, updated.opacity, updated.z, updated.dmOnly ? 1 : 0, updated.visible ? 1 : 0, layerId)
    return updated;
  }

  /**
   * Returns the removed layer's upload path, so the caller can unlink it.
   *
   * Scoped to this campaign's maps: the lookup used to be a bare
   * `SELECT ... WHERE id = ?` and the DELETE ran unconditionally, so a DM
   * could name another campaign's layer id and drop its row.
   */
  deleteImageLayer(layerId: string): string | null {
    const current = this.findImageLayer(layerId);
    if (!current) return null;
    this.mapStates.get(current.mapId)?.imageLayers.delete(layerId);
    this.db.prepare('DELETE FROM image_layer WHERE id = ?').run(layerId);
    return current.path;
  }

  findImageLayer(layerId: string): ImageLayer | null {
    for (const rt of this.mapStates.values()) {
      const layer = rt.imageLayers.get(layerId);
      if (layer) return layer;
    }
    return null;
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
      .prepare(
        'INSERT INTO marker (id, map_id, q, r, glyph, icon, scale, label, dm_only, player_placed, owner_seat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        marker.id,
        marker.mapId,
        marker.q,
        marker.r,
        marker.glyph,
        marker.icon,
        marker.scale,
        marker.label,
        marker.dmOnly ? 1 : 0,
        marker.playerPlaced ? 1 : 0,
        marker.ownerSeatId,
      );
  }

  updateMarker(markerId: string, patch: Partial<Marker>): Marker {
    const found = this.findMarker(markerId);
    if (!found) throw new Error('Marker not found');
    const rt = this.requireMap(found.mapId);
    const updated: Marker = { ...found, ...patch, id: found.id, mapId: found.mapId };
    rt.markers.set(markerId, updated);
    this.db
      .prepare(
        'UPDATE marker SET q=?, r=?, glyph=?, icon=?, scale=?, label=?, dm_only=?, player_placed=?, owner_seat_id=? WHERE id=?',
      )
      .run(
        updated.q,
        updated.r,
        updated.glyph,
        updated.icon,
        updated.scale,
        updated.label,
        updated.dmOnly ? 1 : 0,
        updated.playerPlaced ? 1 : 0,
        updated.ownerSeatId,
        markerId,
      );
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
          `INSERT INTO content (id, map_id, q, r, type, title, dm_notes, glyph, show_label, scale_visibility, wiki_page, enabled, quest, known_location, area) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET q=excluded.q, r=excluded.r, type=excluded.type, title=excluded.title, dm_notes=excluded.dm_notes, glyph=excluded.glyph, show_label=excluded.show_label, scale_visibility=excluded.scale_visibility, wiki_page=excluded.wiki_page, enabled=excluded.enabled, quest=excluded.quest, known_location=excluded.known_location, area=excluded.area`,
        )
        .run(content.id, content.mapId, content.q, content.r, content.type, content.title, content.dmNotes, content.glyph, content.showLabel ? 1 : 0, content.scaleVisibility, content.wikiPage, content.enabled ? 1 : 0, content.quest, content.knownLocation ? 1 : 0, JSON.stringify(content.area ?? []));
      const keep = new Set(content.clues.map((c) => c.id));
      if (existing) {
        for (const old of existing.clues) {
          if (!keep.has(old.id)) this.db.prepare('DELETE FROM clue WHERE id = ?').run(old.id);
        }
      }
      const put = this.db.prepare(
        `INSERT INTO clue (id, content_id, text, gate, sort_order, indicates_direction, reveals_location) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET text=excluded.text, gate=excluded.gate, sort_order=excluded.sort_order, indicates_direction=excluded.indicates_direction, reveals_location=excluded.reveals_location`,
      );
      for (const clue of content.clues) {
        put.run(
          clue.id,
          content.id,
          clue.text,
          JSON.stringify(clue.gate),
          clue.sortOrder,
          clue.indicatesDirection ? 1 : 0,
          clue.revealsLocation ? 1 : 0,
        );
      }
    });
    tx();
    rt.contents.set(content.id, content);
    // Deleted clues cascade their discoveries in SQL; mirror in memory.
    if (existing) {
      const keep = new Set(content.clues.map((c) => c.id));
      const dropped = new Set<string>();
      for (const old of existing.clues) {
        if (!keep.has(old.id)) {
          dropped.add(old.id);
          for (const [id, disc] of this.discoveries) {
            if (disc.clueId === old.id) {
              this.discoveries.delete(id);
              this.discoveredByClueChar.delete(`${disc.clueId}|${disc.characterId}`);
            }
          }
        }
      }
      this.dropPendingRevealsForClues(dropped);
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
        this.dropPendingRevealsForClues(new Set(c.clues.map((cl) => cl.id)));
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
    // Knowing it settles the question: an instant reveal (DM roll, reveal
    // pill, share) consumes anything queued for the DM's call on that clue.
    const queued = this.findPendingReveal(discovery.clueId, discovery.characterId);
    if (queued) this.deletePendingReveal(queued.id);
    this.discoveries.set(discovery.id, discovery);
    this.discoveredByClueChar.add(`${discovery.clueId}|${discovery.characterId}`);
    this.db
      .prepare(
        'INSERT INTO discovery (id, campaign_id, clue_id, character_id, at, how, direction, locates) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        discovery.id,
        this.id,
        discovery.clueId,
        discovery.characterId,
        discovery.at,
        JSON.stringify(discovery.how),
        discovery.direction,
        discovery.locates ? 1 : 0,
      );
    return true;
  }

  // -- hex searches (issue #107) ---------------------------------------------

  /** The attempt this character has already spent on (hex, skill), if any. */
  findSearchAttempt(
    mapId: string,
    q: number,
    r: number,
    characterId: string,
    skill: string,
  ): SearchAttempt | null {
    const rt = this.mapStates.get(mapId);
    if (!rt) return null;
    for (const a of rt.searchAttempts.values()) {
      if (a.q === q && a.r === r && a.characterId === characterId && a.skill === skill) return a;
    }
    return null;
  }

  getSearchAttempt(attemptId: string): SearchAttempt | null {
    for (const rt of this.mapStates.values()) {
      const a = rt.searchAttempts.get(attemptId);
      if (a) return a;
    }
    return null;
  }

  /**
   * Write down a search roll. The (map, hex, character, skill) tuple is
   * unique, so a DM group re-roll updates the existing attempt in place
   * rather than inserting a second one — keeping the id stable is what lets
   * pending reveals keep pointing at it.
   */
  recordSearchAttempt(attempt: SearchAttempt): SearchAttempt {
    const rt = this.requireMap(attempt.mapId);
    const existing = this.findSearchAttempt(
      attempt.mapId,
      attempt.q,
      attempt.r,
      attempt.characterId,
      attempt.skill,
    );
    if (existing) {
      const next: SearchAttempt = {
        ...existing,
        roll: attempt.roll,
        modifier: attempt.modifier,
        total: attempt.total,
        at: attempt.at,
      };
      rt.searchAttempts.set(next.id, next);
      this.db
        .prepare('UPDATE search_attempt SET roll = ?, modifier = ?, total = ?, at = ? WHERE id = ?')
        .run(next.roll, next.modifier, next.total, next.at, next.id);
      return next;
    }
    rt.searchAttempts.set(attempt.id, attempt);
    this.db
      .prepare(
        'INSERT INTO search_attempt (id, campaign_id, map_id, q, r, character_id, skill, roll, modifier, total, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        attempt.id,
        this.id,
        attempt.mapId,
        attempt.q,
        attempt.r,
        attempt.characterId,
        attempt.skill,
        attempt.roll,
        attempt.modifier,
        attempt.total,
        attempt.at,
      );
    return attempt;
  }

  /**
   * Clear one attempt (the DM letting a character try again). Anything still
   * pending from that roll goes with it — SQL cascades on `attempt_id`;
   * memory is mirrored here.
   */
  deleteSearchAttempt(attemptId: string): SearchAttempt | null {
    const attempt = this.getSearchAttempt(attemptId);
    if (!attempt) return null;
    this.mapStates.get(attempt.mapId)?.searchAttempts.delete(attemptId);
    for (const [id, p] of this.pendingReveals) {
      if (p.attemptId === attemptId) this.pendingReveals.delete(id);
    }
    this.db.prepare('DELETE FROM pending_reveal WHERE attempt_id = ?').run(attemptId);
    this.db.prepare('DELETE FROM search_attempt WHERE id = ?').run(attemptId);
    return attempt;
  }

  findPendingReveal(clueId: string, characterId: string): PendingReveal | null {
    for (const p of this.pendingReveals.values()) {
      if (p.clueId === clueId && p.characterId === characterId) return p;
    }
    return null;
  }

  /** Queue a clue for the DM's call. False when it is already known or queued. */
  addPendingReveal(pending: PendingReveal): boolean {
    if (this.hasDiscovery(pending.clueId, pending.characterId)) return false;
    if (this.findPendingReveal(pending.clueId, pending.characterId)) return false;
    this.pendingReveals.set(pending.id, pending);
    this.db
      .prepare(
        'INSERT INTO pending_reveal (id, campaign_id, clue_id, character_id, attempt_id, direction, locates, roll, modifier, total, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        pending.id,
        this.id,
        pending.clueId,
        pending.characterId,
        pending.attemptId,
        pending.direction,
        pending.locates ? 1 : 0,
        pending.roll,
        pending.modifier,
        pending.total,
        pending.at,
      );
    return true;
  }

  deletePendingReveal(pendingId: string): PendingReveal | null {
    const pending = this.pendingReveals.get(pendingId);
    if (!pending) return null;
    this.pendingReveals.delete(pendingId);
    this.db.prepare('DELETE FROM pending_reveal WHERE id = ?').run(pendingId);
    return pending;
  }

  /** Drop every pending row for these clues (clue/content deletion). */
  private dropPendingRevealsForClues(clueIds: Set<string>): void {
    for (const [id, p] of this.pendingReveals) {
      if (clueIds.has(p.clueId)) this.deletePendingReveal(id);
    }
  }

  /** Upgrade an at-a-distance discovery: the character reached the source. */
  markDiscoveryLocated(clueId: string, characterId: string): void {
    for (const disc of this.discoveries.values()) {
      if (disc.clueId === clueId && disc.characterId === characterId && !disc.locates) {
        disc.locates = true;
        this.db.prepare('UPDATE discovery SET locates = 1 WHERE id = ?').run(disc.id);
      }
    }
  }

  // -- trails ----------------------------------------------------------------

  upsertTrail(trail: Trail): void {
    const rt = this.requireMap(trail.mapId);
    rt.trails.set(trail.id, trail);
    this.db
      .prepare(
        `INSERT INTO trail (id, map_id, name, glyph, dm_notes, gate, cells) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, glyph=excluded.glyph, dm_notes=excluded.dm_notes, gate=excluded.gate, cells=excluded.cells`,
      )
      .run(
        trail.id,
        trail.mapId,
        trail.name,
        trail.glyph,
        trail.dmNotes,
        JSON.stringify(trail.gate),
        JSON.stringify(trail.cells),
      );
  }

  deleteTrail(mapId: string, trailId: string): void {
    this.requireMap(mapId).trails.delete(trailId);
    this.db.prepare('DELETE FROM trail WHERE id = ?').run(trailId);
    for (const [id, td] of this.trailDiscoveries) {
      if (td.trailId === trailId) {
        this.trailDiscoveries.delete(id);
        this.trailDiscoveryKeys.delete(`${td.trailId}|${td.cellIndex}|${td.characterId}`);
      }
    }
  }

  findTrail(trailId: string): Trail | null {
    for (const rt of this.mapStates.values()) {
      const t = rt.trails.get(trailId);
      if (t) return t;
    }
    return null;
  }

  hasTrailDiscovery(trailId: string, cellIndex: number, characterId: string): boolean {
    return this.trailDiscoveryKeys.has(`${trailId}|${cellIndex}|${characterId}`);
  }

  addTrailDiscovery(disc: TrailDiscovery): boolean {
    const key = `${disc.trailId}|${disc.cellIndex}|${disc.characterId}`;
    if (this.trailDiscoveryKeys.has(key)) return false;
    this.trailDiscoveries.set(disc.id, disc);
    this.trailDiscoveryKeys.add(key);
    this.db
      .prepare(
        'INSERT INTO trail_discovery (id, campaign_id, trail_id, cell_index, character_id, at) VALUES (?,?,?,?,?,?)',
      )
      .run(disc.id, this.id, disc.trailId, disc.cellIndex, disc.characterId, disc.at);
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
        `INSERT INTO enc_table (id, campaign_id, name, terrains, die, entries, enabled) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, terrains=excluded.terrains, die=excluded.die, entries=excluded.entries, enabled=excluded.enabled`,
      )
      .run(
        table.id,
        this.id,
        table.name,
        JSON.stringify(table.terrains),
        table.die,
        JSON.stringify(table.entries),
        table.enabled ? 1 : 0,
      );
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

function imageLayerFromRow(mapId: string, row: Record<string, unknown>): ImageLayer {
  return {
    id: row.id as string,
    mapId,
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

function searchAttemptFromRow(mapId: string, row: Record<string, unknown>): SearchAttempt {
  return {
    id: row.id as string,
    mapId,
    q: row.q as number,
    r: row.r as number,
    characterId: row.character_id as string,
    skill: row.skill as string,
    roll: row.roll as number,
    modifier: row.modifier as number,
    total: row.total as number,
    at: row.at as number,
  };
}

function safeJson(text: string | null | undefined, fallback: unknown = {}): unknown {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
