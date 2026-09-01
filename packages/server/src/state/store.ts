import { nanoid } from 'nanoid';
import {
  EncounterCheckConfigSchema,
  GridStyleSchema,
  INHERITABLE_MAP_FIELDS,
} from '@hexcrawl/shared';
import type { DB } from '../db/driver.js';
import { CampaignRuntime, type SeatRecord } from './runtime.js';

/** The columns `CampaignRuntime` needs from the campaign row. */
interface CampaignRow {
  id: string;
  name: string;
  dm_secret: string;
  player_secret: string;
  active_map_id: string | null;
  settings: string;
  time?: string | null;
}

/**
 * Registry of loaded campaigns.
 *
 * `getCampaign` is synchronous — every HTTP route and the WebSocket upgrade
 * call it — so it never issues a database read on a backend that cannot answer
 * one synchronously. On SQLite it loads lazily, exactly as before. On Postgres
 * every campaign is loaded during `Store.create` (boot) and `getCampaign` is a
 * pure cache lookup; the two paths that create a campaign after boot
 * (`createCampaign`, and import via `loadCampaign`) seed the cache themselves.
 */
export class Store {
  private runtimes = new Map<string, CampaignRuntime>();

  constructor(readonly db: DB) {}

  /**
   * Open a store over `db`, warming the cache when the driver cannot serve
   * synchronous reads at request time. `index.ts` is the only caller — tests
   * and the SQLite path can keep using `new Store(db)`.
   */
  static async create(db: DB): Promise<Store> {
    const store = new Store(db);
    if (db.withReadCache) await store.loadAll();
    return store;
  }

  /** Drop a cached runtime so the next load re-reads it from the database. */
  forget(campaignId: string): void {
    this.runtimes.delete(campaignId);
  }

  getCampaign(campaignId: string): CampaignRuntime | null {
    const cached = this.runtimes.get(campaignId);
    if (cached) return cached;
    // An async driver cannot be read from here; the campaign was either loaded
    // at boot or created through this Store, so a miss really is "not found".
    if (this.db.withReadCache) return null;
    return this.readCampaign(campaignId);
  }

  /**
   * Load one campaign from the database, awaiting the read on async drivers.
   * Used at boot and after an import, which writes rows behind the runtime's
   * back and then needs them in memory.
   */
  async loadCampaign(campaignId: string): Promise<CampaignRuntime | null> {
    const cached = this.runtimes.get(campaignId);
    if (cached) return cached;
    const withReadCache = this.db.withReadCache?.bind(this.db);
    if (!withReadCache) return this.readCampaign(campaignId);
    const runtime = await withReadCache((prime) => prime(() => this.buildRuntime(campaignId)));
    if (runtime) this.runtimes.set(campaignId, runtime);
    return runtime;
  }

  /** Warm every campaign into memory (async drivers only). */
  private async loadAll(): Promise<void> {
    const withReadCache = this.db.withReadCache?.bind(this.db);
    if (!withReadCache) return;
    const loaded = await withReadCache((prime) =>
      prime(() => {
        // Built into a fresh map every pass: earlier passes see partial rows.
        const out = new Map<string, CampaignRuntime>();
        const rows = this.db.prepare('SELECT id FROM campaign').all() as Array<{ id: string }>;
        for (const row of rows) {
          const runtime = this.buildRuntime(row.id);
          if (runtime) out.set(row.id, runtime);
        }
        return out;
      }),
    );
    for (const [id, runtime] of loaded) this.runtimes.set(id, runtime);
  }

  /** Synchronous load + cache. Only safe when the driver reads synchronously. */
  private readCampaign(campaignId: string): CampaignRuntime | null {
    const runtime = this.buildRuntime(campaignId);
    if (runtime) this.runtimes.set(campaignId, runtime);
    return runtime;
  }

  /** Pure: reads rows and builds a runtime, without touching the cache. */
  private buildRuntime(campaignId: string): CampaignRuntime | null {
    const row = this.db.prepare('SELECT * FROM campaign WHERE id = ?').get(campaignId) as
      CampaignRow | undefined;
    if (!row) return null;
    return new CampaignRuntime(this.db, row);
  }

  createCampaign(name: string, dmName: string): { runtime: CampaignRuntime; dmSeat: SeatRecord } {
    const id = nanoid(10);
    const dmSecret = nanoid(24);
    const playerSecret = nanoid(24);
    this.db
      .prepare(
        'INSERT INTO campaign (id, name, dm_secret, player_secret, active_map_id, settings, created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(id, name, dmSecret, playerSecret, null, '{}', Date.now());
    // Build the runtime from the row we just wrote rather than reading it back:
    // this keeps campaign creation synchronous on every backend.
    const runtime = new CampaignRuntime(
      this.db,
      {
        id,
        name,
        dm_secret: dmSecret,
        player_secret: playerSecret,
        active_map_id: null,
        settings: '{}',
        time: null,
      },
      { fresh: true },
    );
    this.runtimes.set(id, runtime);
    const dmSeat = runtime.createSeat('dm', dmName);
    // Start with one ready-to-use map so the DM lands on a working canvas.
    const mapId = nanoid(10);
    runtime.createMap({
      id: mapId,
      name: 'Overland',
      orientation: 'flat',
      hexSize: 48,
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
      sortOrder: 0,
      inheritedFields: [...INHERITABLE_MAP_FIELDS],
    });
    runtime.setActiveMap(mapId);
    return { runtime, dmSeat };
  }

  /** Resolve a seat by its bearer token. */
  findSeatByToken(runtime: CampaignRuntime, token: string | null): SeatRecord | null {
    if (!token) return null;
    for (const seat of runtime.seats.values()) {
      if (seat.token === token) return seat;
    }
    return null;
  }
}
