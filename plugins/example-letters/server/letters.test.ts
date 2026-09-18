import { afterEach, describe, expect, it } from 'vitest';
import { createPluginTestBed, type PluginTestBed } from '@hexcrawl/server/plugin-testing';
import plugin from './index.js';

interface Letter {
  id: string;
  from: string;
  to: string;
  wikiTitle: string;
  wikiUrl: string | null;
  wikiError: string | null;
}

let bed: PluginTestBed;
afterEach(() => bed.dispose());

describe('example-letters', () => {
  it('keeps a letter even when the wiki cannot take it', async () => {
    bed = createPluginTestBed(plugin);
    const ana = bed.addPlayer('Ana', 'Ser Ana');
    const sent = await bed.call<Letter>(
      'send',
      { characterId: ana.character.id, to: 'Lord [Neverember]', body: 'The road is watched.' },
      ana.seat,
    );
    expect(sent.status).toBe(200);
    expect(sent.result).toMatchObject({ from: 'Ser Ana', wikiUrl: null });
    expect(sent.result.wikiError).toMatch(/No wiki/);
    // Title characters MediaWiki forbids are gone.
    expect(sent.result.wikiTitle).toMatch(/^Letters\/Ser Ana to Lord Neverember \([a-z0-9]+\)$/);
  });

  it('is private: a player lists their own letters, the DM lists all', async () => {
    bed = createPluginTestBed(plugin);
    const ana = bed.addPlayer('Ana');
    const bo = bed.addPlayer('Bo');
    await bed.call('send', { characterId: ana.character.id, to: 'Mother', body: 'I am well.' }, ana.seat);
    await bed.call('send', { characterId: bo.character.id, to: 'The Guild', body: 'Send coin.' }, bo.seat);

    const anas = await bed.call<{ letters: Letter[] }>('list', {}, ana.seat);
    expect(anas.result.letters.map((l) => l.to)).toEqual(['Mother']);
    expect((await bed.call<{ letters: Letter[] }>('list')).result.letters).toHaveLength(2);
    // The log line went to the sender's seat, not the table.
    expect(bed.runtime.log.filter((e) => e.kind === 'plugin').map((e) => e.visibility)).toEqual([
      ana.seat.id,
      bo.seat.id,
    ]);
    expect((await bed.call('send', { characterId: bo.character.id, to: 'x', body: 'y' }, ana.seat)).status).toBe(403);
  });

  it('rejects an empty letter with the schema’s own message', async () => {
    bed = createPluginTestBed(plugin);
    const ana = bed.addPlayer('Ana');
    const res = await bed.call('send', { characterId: ana.character.id, to: 'Mother', body: '   ' }, ana.seat);
    expect(res).toMatchObject({ status: 400, error: 'Invalid input — body: The letter is empty' });
  });
});
