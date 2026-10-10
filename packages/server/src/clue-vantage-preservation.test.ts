import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientCommandSchema, ContentSchema, seededRng } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

let store: Store;
let campaign: ReturnType<Store['createCampaign']>;
let sequence = 0;
const vantage = [{ q: 2, r: -1 }, { q: 3, r: -1 }];

beforeEach(() => {
  store = new Store(createTestDb());
  campaign = store.createCampaign('Vantage', 'DM');
  campaign.runtime.upsertContent(ContentSchema.parse({
    id: 'region', mapId: campaign.runtime.campaign.activeMapId!, q: 0, r: 0,
    type: 'region', title: 'Wood', observeFrom: [{ q: 7, r: 7 }],
    clues: [{ id: 'clue', contentId: 'region', text: 'Smoke', gate: { kind: 'manual' }, observeFrom: vantage }],
  }));
});

afterEach(() => store.db.close());

function update(cluePatch: Record<string, unknown>, contentPatch: Record<string, unknown> = {}) {
  const source = campaign.runtime.findContentByClue('clue')!;
  const { observeFrom: _omitted, ...legacy } = source.clues[0]!;
  dispatchCommand(ClientCommandSchema.parse({
    id: `vantage-${sequence++}`, kind: 'content.upsert',
    content: { ...source, ...contentPatch, clues: [{ ...legacy, ...cluePatch }] },
  }), { runtime: campaign.runtime, seat: campaign.dmSeat, hub: new Hub(), rng: seededRng(1) });
}

describe('clue vantage preservation (#176)', () => {
  it('keeps painted vantage hexes on legacy visibility and title edits, including reload', () => {
    update({}, { knownLocation: true });
    update({}, { title: 'Renamed wood' });
    const source = new Store(store.db).getCampaign(campaign.runtime.id)!.findContentByClue('clue')!;
    expect(source).toMatchObject({ knownLocation: true, title: 'Renamed wood' });
    expect(source.clues[0]?.observeFrom).toEqual(vantage);
    expect(source.observeFrom).toEqual([{ q: 7, r: 7 }]);
  });

  it('still allows an explicit clear or replacement', () => {
    update({ observeFrom: [] });
    expect(campaign.runtime.findContentByClue('clue')?.clues[0]?.observeFrom).toEqual([]);
    update({ observeFrom: [{ q: 9, r: 1 }] });
    expect(campaign.runtime.findContentByClue('clue')?.clues[0]?.observeFrom).toEqual([{ q: 9, r: 1 }]);
  });

  it('does not transfer the old vantage geometry to a newly created clue', () => {
    update({ id: null });
    const source = campaign.runtime.requireMap(campaign.runtime.campaign.activeMapId!).contents.get('region')!;
    expect(source.clues[0]?.id).not.toBe('clue');
    expect(source.clues[0]?.observeFrom).toEqual([]);
  });
});
