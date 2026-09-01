/**
 * Optional round trip against a REAL PostgreSQL server. Skipped unless
 * `HEXCRAWL_TEST_DATABASE_URL` is set, so CI (which has no database) stays
 * green — the driver's own logic is covered by the mock-client tests in
 * `driver.test.ts`.
 *
 *   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=dev \
 *     -e POSTGRES_DB=hexcrawl_test --name hexcrawl-pg postgres:16
 *   HEXCRAWL_TEST_DATABASE_URL=postgres://postgres:dev@localhost:5433/hexcrawl_test \
 *     pnpm --filter @hexcrawl/server test
 *
 * It creates campaigns and deletes them again (rows cascade), so point it at a
 * scratch database, never a real one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from './index.js';
import { PostgresDb, pgConnector } from './postgres.js';
import { Store } from '../state/store.js';
import { exportCampaign, exportReadPlan, importCampaign } from '../http/portability.js';

const url = process.env.HEXCRAWL_TEST_DATABASE_URL ?? '';
const created: string[] = [];
let db: PostgresDb | null = null;

async function open(): Promise<PostgresDb> {
  if (db) return db;
  const pg = new PostgresDb(pgConnector(url));
  await pg.refreshColumns();
  migrate(pg);
  await pg.flush();
  await pg.refreshColumns();
  db = pg;
  return pg;
}

afterAll(async () => {
  if (!db) return;
  for (const id of created) db.prepare('DELETE FROM campaign WHERE id = ?').run(id);
  await db.close();
});

describe.skipIf(!url)('postgres backend (live)', () => {
  it('persists a campaign and reloads it into a fresh Store', async () => {
    const pg = await open();
    const store = await Store.create(pg);
    const { runtime } = store.createCampaign('Live round trip', 'DM');
    created.push(runtime.id);
    const mapId = runtime.campaign.activeMapId!;

    runtime.paintTerrain(
      mapId,
      [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      'swamp',
    );
    runtime.setFog(mapId, [{ q: 0, r: 0 }], 'explored');
    runtime.updateMap(mapId, { moveApproval: true, sightRadius: 3 });
    runtime.appendLog('note', 'hello postgres', 'dm', { n: 1 });
    runtime.addImageLayer({
      id: 'live-layer',
      mapId,
      path: `/uploads/${runtime.id}/x.png`,
      name: 'Backdrop',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      z: 0,
      dmOnly: false,
      visible: true,
    });
    runtime.recordHexArrival(mapId, 0, 0, 600);
    await pg.flush();
    expect(pg.health().failedWrites).toBe(0);

    const reloaded = (await Store.create(pg)).getCampaign(runtime.id)!;
    expect(reloaded).not.toBeNull();
    expect(reloaded.campaign.name).toBe('Live round trip');
    expect(reloaded.requireMap(mapId).hexes.size).toBe(2);
    expect(reloaded.requireMap(mapId).fog.get('0,0')).toBe('explored');
    // Booleans survive as 0/1 integers, exactly as on SQLite.
    expect(reloaded.maps.get(mapId)!.moveApproval).toBe(true);
    expect(reloaded.maps.get(mapId)!.sightRadius).toBe(3);
    expect(reloaded.imageLayersFor(mapId)).toHaveLength(1);
    expect(reloaded.imageLayersFor(mapId)[0]!.visible).toBe(true);
    expect(reloaded.hexVisit(mapId, 0, 0)!.firstArrived).toBe(600);
    expect(reloaded.log.at(-1)!.text).toBe('hello postgres');
  });

  it('exports and re-imports an archive', async () => {
    const pg = await open();
    const store = await Store.create(pg);
    const { runtime } = store.createCampaign('Live export', 'DM');
    created.push(runtime.id);
    runtime.paintTerrain(runtime.campaign.activeMapId!, [{ q: 2, r: 2 }], 'forest');
    await pg.flush();

    const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcrawl-pg-'));
    const archive = await pg.withReadCache(async (prime) => {
      await prime(() => exportReadPlan(pg, runtime.id));
      return exportCampaign(pg, runtime.id, uploads);
    });
    expect(archive.hexes).toHaveLength(1);

    const result = importCampaign(pg, archive, { uploadsDir: uploads });
    created.push(result.campaignId);
    const restored = await new Store(pg).loadCampaign(result.campaignId);
    expect(restored).not.toBeNull();
    expect(restored!.campaign.name).toBe('Live export');
    expect([...restored!.mapStates.values()][0]!.hexes.size).toBe(1);
    expect(pg.health().failedWrites).toBe(0);
  });
});
