import { afterEach, describe, expect, it } from 'vitest';
import { createPluginTestBed, type PluginTestBed } from '@hexcrawl/server/plugin-testing';
import plugin from './index.js';

interface State {
  pools: { characterId: string; name: string; remaining: number; rolls: { value: number; reason: string }[] }[];
}

let bed: PluginTestBed;
afterEach(() => bed.dispose());

describe('example-fate-dice', () => {
  it('spends a die, records the roll, and tells the table', async () => {
    bed = createPluginTestBed(plugin, { config: { poolSize: 2, dieSides: '8' } });
    const ana = bed.addPlayer('Ana', 'Ser Ana');

    const roll = await bed.call<{ value: number; sides: number; remaining: number; wikiError: string | null }>(
      'roll',
      { characterId: ana.character.id, reason: 'leap the chasm' },
      ana.seat,
    );
    expect(roll.status).toBe(200);
    expect(roll.result.sides).toBe(8);
    expect(roll.result.value).toBeGreaterThanOrEqual(1);
    expect(roll.result.value).toBeLessThanOrEqual(8);
    // No wiki configured: the roll stands and nothing is reported as failed.
    expect(roll.result).toMatchObject({ remaining: 1, wikiError: null });

    const state = await bed.call<State>('state', {}, ana.seat);
    expect(state.result.pools).toEqual([
      expect.objectContaining({ name: 'Ser Ana', remaining: 1, rolls: [expect.objectContaining({ reason: 'leap the chasm' })] }),
    ]);
    expect(bed.runtime.log.at(-1)?.text).toMatch(/^Ser Ana spends a fate die \(d8\): \d — leap the chasm$/);
    expect(bed.sent).toContainEqual(expect.objectContaining({ kind: 'plugin.changed', topic: 'pools' }));
  });

  it('runs dry, and only the DM can hand dice back', async () => {
    bed = createPluginTestBed(plugin, { config: { poolSize: 1 } });
    const ana = bed.addPlayer('Ana');
    await bed.call('roll', { characterId: ana.character.id }, ana.seat);
    const dry = await bed.call('roll', { characterId: ana.character.id }, ana.seat);
    expect(dry).toMatchObject({ status: 409, error: 'Ana has no fate dice left' });

    expect((await bed.call('refresh', {}, ana.seat)).status).toBe(403);
    expect((await bed.call('refresh', {})).status).toBe(200);
    expect((await bed.call('roll', { characterId: ana.character.id }, ana.seat)).status).toBe(200);
  });

  it('shows a player their own pool and the DM everyone’s', async () => {
    bed = createPluginTestBed(plugin);
    const ana = bed.addPlayer('Ana');
    const bo = bed.addPlayer('Bo');
    const mine = await bed.call<State>('state', {}, ana.seat);
    expect(mine.result.pools.map((p) => p.name)).toEqual(['Ana']);
    expect((await bed.call<State>('state')).result.pools.map((p) => p.name).sort()).toEqual(['Ana', 'Bo']);
    // …and may not roll someone else's.
    expect((await bed.call('roll', { characterId: bo.character.id }, ana.seat)).status).toBe(403);
  });
});
