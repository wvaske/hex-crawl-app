import { nanoid } from 'nanoid';
import {
  EncounterCheckConfigSchema,
  GridStyleSchema,
  INHERITABLE_MAP_FIELDS,
} from '@hexcrawl/shared';
import type { DB } from '../db/index.js';
import { CampaignRuntime, type SeatRecord } from './runtime.js';

/** Registry of loaded campaigns. */
export class Store {
  private runtimes = new Map<string, CampaignRuntime>();

  constructor(private db: DB) {}

  getCampaign(campaignId: string): CampaignRuntime | null {
    const cached = this.runtimes.get(campaignId);
    if (cached) return cached;
    const row = this.db.prepare('SELECT * FROM campaign WHERE id = ?').get(campaignId) as
      | {
          id: string;
          name: string;
          dm_secret: string;
          player_secret: string;
          active_map_id: string | null;
          settings: string;
        }
      | undefined;
    if (!row) return null;
    const runtime = new CampaignRuntime(this.db, row);
    this.runtimes.set(campaignId, runtime);
    return runtime;
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
    const runtime = this.getCampaign(id)!;
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
