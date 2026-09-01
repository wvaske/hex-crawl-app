import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filterStateForViewer, seededRng } from '@hexcrawl/shared';
import type { CampaignState, ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { exportCampaign, importCampaign } from './http/portability.js';

/**
 * Hex search: one roll per skill per hex per character, and the DM's call on
 * what a successful roll actually reveals (issue #107).
 *
 * The two invariants worth defending here are (a) a player cannot spend the
 * same skill on the same hex twice, and (b) nothing a player's roll turned up
 * reaches them — not the clue, not even the *number* of clues — until the DM
 * shares it.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `s${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `s${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Search', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

interface Party {
  mapId: string;
  charId: string;
  tokenId: string;
  seat: SeatRecord;
}

/** A scout (perception +4 / survival +2) with a token at the origin. */
function party(name = 'Scout', q = 0, r = 0): Party {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name,
      color: '#00aa00',
      glyph: '🏹',
      speed: 30,
      skills: { perception: 4, survival: 2 },
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.values()].find((c) => c.name === name)!.id;
  const seat = runtime.createSeat('player', `${name}'s player`);
  asSeat(seat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  seat.characterId = runtime.seats.get(seat.id)!.characterId;
  dm({
    kind: 'token.create',
    mapId,
    q,
    r,
    tokenKind: 'pc',
    characterId: charId,
    label: name,
    color: '#00aa00',
    glyph: '',
    playerVisible: true,
  } as never);
  const tokenId = [...runtime.requireMap(mapId).tokens.values()].find(
    (t) => t.characterId === charId,
  )!.id;
  return { mapId, charId, tokenId, seat };
}

/** Content on `hex` whose single clue only an active search can open. */
function searchable(
  mapId: string,
  hex: { q: number; r: number },
  title: string,
  clue: Record<string, unknown> = {},
): { contentId: string; clueId: string } {
  dm({
    kind: 'content.upsert',
    content: {
      id: null,
      mapId,
      q: hex.q,
      r: hex.r,
      type: 'cache',
      title,
      dmNotes: '',
      glyph: '',
      clues: [
        {
          id: null,
          text: `${title}: a scuffed flagstone`,
          gate: { kind: 'skill', skill: 'survival', dc: 2, maxDistance: 2, mode: 'active' },
          sortOrder: 0,
          ...clue,
        },
      ],
    },
  } as never);
  const content = [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === title)!;
  return { contentId: content.id, clueId: content.clues[0]!.id };
}

function viewFor(seat: SeatRecord): CampaignState {
  return filterStateForViewer(runtime.buildFullState(), {
    seatId: seat.id,
    role: seat.role,
    characterId: seat.characterId,
  });
}

function search(seat: SeatRecord, mapId: string, hex: { q: number; r: number }, skill: string) {
  asSeat(seat, { kind: 'check.roll', skill, dc: null, characterIds: [], mapId, hex } as never);
}

describe('one attempt per skill per hex per character', () => {
  it('rejects a second roll of the same skill on the same hex, before rolling', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    const attempts = [...runtime.requireMap(mapId).searchAttempts.values()];
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.skill).toBe('survival');

    expect(() => search(seat, mapId, { q: 0, r: 0 }, 'survival')).toThrow(
      /Scout already searched this hex with survival/,
    );
    // Rejected before the dice: still exactly one attempt on record.
    expect(runtime.requireMap(mapId).searchAttempts.size).toBe(1);
  });

  it('scopes the limit to the skill, the hex and the character', () => {
    const { mapId, seat } = party();
    const other = party('Bard', 1, 0);
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    // A different skill, a different hex and a different character all pass.
    search(seat, mapId, { q: 0, r: 0 }, 'perception');
    search(seat, mapId, { q: 1, r: 0 }, 'survival');
    search(other.seat, mapId, { q: 0, r: 0 }, 'survival');
    expect(runtime.requireMap(mapId).searchAttempts.size).toBe(4);
  });

  it('does not limit the DM, but still records the attempt', () => {
    const { mapId, charId } = party();
    dm({
      kind: 'check.roll',
      skill: 'survival',
      dc: null,
      characterIds: [charId],
      mapId,
      hex: { q: 0, r: 0 },
    } as never);
    dm({
      kind: 'check.roll',
      skill: 'survival',
      dc: null,
      characterIds: [charId],
      mapId,
      hex: { q: 0, r: 0 },
    } as never);
    // The unique tuple means the re-roll updates the row rather than adding one.
    expect(runtime.requireMap(mapId).searchAttempts.size).toBe(1);
  });
});

describe('pending reveals', () => {
  it("a player's successful search queues the clue instead of revealing it", () => {
    const { mapId, charId, seat } = party();
    const { clueId } = searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');

    expect(runtime.discoveries.size).toBe(0);
    expect(runtime.pendingReveals.size).toBe(1);
    const pending = [...runtime.pendingReveals.values()][0]!;
    expect(pending.clueId).toBe(clueId);
    expect(pending.characterId).toBe(charId);
    // Searched from on top of the content: the find pins the location.
    expect(pending.locates).toBe(true);
    expect(runtime.getSearchAttempt(pending.attemptId)?.skill).toBe('survival');
    // The player learns nothing of it.
    expect(viewFor(seat).mapState!.contents).toHaveLength(0);
  });

  it('freezes the bearing at roll time for a directional clue found from afar', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 2, r: 0 }, 'Distant cache', { indicatesDirection: true });
    search(seat, mapId, { q: 2, r: 0 }, 'survival');
    const pending = [...runtime.pendingReveals.values()][0]!;
    expect(pending.direction).not.toBeNull();
    // Two hexes away — knowing about it doesn't pin it on the map.
    expect(pending.locates).toBe(false);
  });

  it('a DM-initiated hex roll reveals instantly and queues nothing', () => {
    const { mapId, charId } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    dm({
      kind: 'check.roll',
      skill: 'survival',
      dc: null,
      characterIds: [charId],
      mapId,
      hex: { q: 0, r: 0 },
    } as never);
    expect(runtime.pendingReveals.size).toBe(0);
    expect(runtime.discoveries.size).toBe(1);
  });

  it('an instant reveal consumes a row already pending for that clue', () => {
    const { mapId, charId, seat } = party();
    const { clueId } = searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    expect(runtime.pendingReveals.size).toBe(1);

    dm({ kind: 'clue.reveal', clueId, characterIds: [charId] } as never);
    expect(runtime.discoveries.size).toBe(1);
    expect(runtime.pendingReveals.size).toBe(0);
  });
});

describe('search.resolve', () => {
  it('approving creates the discovery with the roll that earned it', () => {
    const { mapId, charId, seat } = party();
    const { clueId } = searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    const pending = [...runtime.pendingReveals.values()][0]!;

    dm({ kind: 'search.resolve', pendingIds: [pending.id], approve: true } as never);

    expect(runtime.pendingReveals.size).toBe(0);
    const disc = [...runtime.discoveries.values()][0]!;
    expect(disc.clueId).toBe(clueId);
    expect(disc.characterId).toBe(charId);
    expect(disc.locates).toBe(pending.locates);
    expect(disc.direction).toBe(pending.direction);
    expect(disc.how).toEqual({
      kind: 'roll',
      skill: 'survival',
      roll: pending.roll,
      modifier: pending.modifier,
      total: pending.total,
      dc: 2,
    });
    // It reaches the player through the normal delivery path.
    const view = viewFor(seat);
    expect(view.mapState!.contents.map((c) => c.title)).toEqual(['Cache']);
    expect(view.log.some((e) => e.text.includes('scuffed flagstone'))).toBe(true);
  });

  it('denying drops the rows, tells nobody but the DM, and reveals nothing', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    const pending = [...runtime.pendingReveals.values()][0]!;

    dm({ kind: 'search.resolve', pendingIds: [pending.id], approve: false } as never);

    expect(runtime.pendingReveals.size).toBe(0);
    expect(runtime.discoveries.size).toBe(0);
    const withheld = runtime.log.find((e) => e.text.startsWith('Withheld'));
    expect(withheld?.text).toBe('Withheld 1 result(s) at hex 0,0');
    expect(withheld?.visibility).toBe('dm');
    expect(viewFor(seat).log.some((e) => e.text.includes('Withheld'))).toBe(false);
    // The attempt stays spent: denial is a ruling, not a do-over.
    expect(runtime.requireMap(mapId).searchAttempts.size).toBe(1);
  });

  it('shares some and withholds others from the same roll', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache A');
    searchable(mapId, { q: 0, r: 0 }, 'Cache B');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    expect(runtime.pendingReveals.size).toBe(2);
    const [first, second] = [...runtime.pendingReveals.values()];

    dm({ kind: 'search.resolve', pendingIds: [first!.id], approve: true } as never);
    dm({ kind: 'search.resolve', pendingIds: [second!.id], approve: false } as never);

    expect(runtime.discoveries.size).toBe(1);
    expect(runtime.pendingReveals.size).toBe(0);
    expect(viewFor(seat).mapState!.contents).toHaveLength(1);
  });

  it('is DM-only', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    const pending = [...runtime.pendingReveals.values()][0]!;
    expect(() =>
      asSeat(seat, { kind: 'search.resolve', pendingIds: [pending.id], approve: true } as never),
    ).toThrow(/DM/);
    expect(() =>
      asSeat(seat, { kind: 'search.clearAttempt', attemptId: pending.attemptId } as never),
    ).toThrow(/DM/);
  });
});

describe('search.clearAttempt', () => {
  it('lets the character roll that skill here again and drops its pendings', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    const attemptId = [...runtime.requireMap(mapId).searchAttempts.keys()][0]!;
    expect(runtime.pendingReveals.size).toBe(1);

    dm({ kind: 'search.clearAttempt', attemptId } as never);
    expect(runtime.requireMap(mapId).searchAttempts.size).toBe(0);
    expect(runtime.pendingReveals.size).toBe(0);

    // The retry rolls afresh and queues the clue again.
    expect(() => search(seat, mapId, { q: 0, r: 0 }, 'survival')).not.toThrow();
    expect(runtime.pendingReveals.size).toBe(1);
  });

  it('rejects an attempt id that is already gone', () => {
    party();
    expect(() => dm({ kind: 'search.clearAttempt', attemptId: 'nope' } as never)).toThrow(
      /already gone/,
    );
  });
});

describe('what the roll tells each side', () => {
  it("the player's log entry names no outcome; the DM's carries the accounting", () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');

    const playerLog = viewFor(seat).log.filter((e) => e.kind === 'check');
    expect(playerLog).toHaveLength(1);
    expect(playerLog[0]!.text).toContain('the DM will describe what you find');
    expect(playerLog[0]!.text).not.toMatch(/clue\(s\)|nothing|awaiting/);

    const dmLog = runtime.log.filter((e) => e.kind === 'check' && e.visibility === 'dm');
    expect(dmLog).toHaveLength(1);
    expect(dmLog[0]!.text).toContain('1 awaiting your approval');
    expect(dmLog[0]!.data.pending).toBe(1);
  });

  it('a fruitless search reads identically to a fruitful one for the player', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache', {
      gate: { kind: 'skill', skill: 'survival', dc: 39, maxDistance: 2, mode: 'active' },
    });
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    expect(runtime.pendingReveals.size).toBe(0);
    const playerLog = viewFor(seat).log.filter((e) => e.kind === 'check');
    expect(playerLog[0]!.text).toContain('the DM will describe what you find');
    expect(playerLog[0]!.text).not.toContain('nothing');
  });

  it('a non-hex check keeps its plain summary', () => {
    const { mapId, seat } = party();
    void mapId;
    asSeat(seat, {
      kind: 'check.roll',
      skill: 'survival',
      dc: 10,
      characterIds: [],
      mapId: null,
      hex: null,
    } as never);
    const playerLog = viewFor(seat).log.filter((e) => e.kind === 'check');
    expect(playerLog).toHaveLength(1);
    expect(playerLog[0]!.text).not.toContain('the DM will describe');
  });
});

describe('filterStateForViewer (issue #107)', () => {
  it('gives a player their own attempts only, and never a pending reveal', () => {
    const { mapId, seat } = party();
    const other = party('Bard', 1, 0);
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    search(other.seat, mapId, { q: 0, r: 0 }, 'perception');

    const mine = viewFor(seat);
    expect(mine.mapState!.searchAttempts).toHaveLength(1);
    expect(mine.mapState!.searchAttempts[0]!.characterId).toBe(seat.characterId);
    expect(mine.pendingReveals).toEqual([]);

    const theirs = viewFor(other.seat);
    expect(theirs.mapState!.searchAttempts.map((a) => a.skill)).toEqual(['perception']);
    expect(theirs.pendingReveals).toEqual([]);

    // The DM sees the lot.
    const dmView = viewFor(dmSeat);
    expect(dmView.mapState!.searchAttempts).toHaveLength(2);
    expect(dmView.pendingReveals).toHaveLength(1);
  });

  it('gives an unclaimed player seat no attempts at all', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    const bare = runtime.createSeat('player', 'Lurker');
    expect(viewFor(bare).mapState!.searchAttempts).toEqual([]);
  });
});

describe('portability', () => {
  it('carries attempts and pending reveals through an export/import roundtrip', () => {
    const { mapId, seat } = party();
    searchable(mapId, { q: 0, r: 0 }, 'Cache');
    search(seat, mapId, { q: 0, r: 0 }, 'survival');
    const attempt = [...runtime.requireMap(mapId).searchAttempts.values()][0]!;
    const pending = [...runtime.pendingReveals.values()][0]!;

    const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcrawl-search-'));
    const archive = exportCampaign(store.db, runtime.id, uploads);
    expect(archive.searchAttempts).toHaveLength(1);
    expect(archive.pendingReveals).toHaveLength(1);

    const result = importCampaign(store.db, archive, { uploadsDir: uploads });
    expect(result.counts.search_attempt).toBe(1);
    expect(result.counts.pending_reveal).toBe(1);

    const restored = store.getCampaign(result.campaignId)!;
    const restoredMap = [...restored.mapStates.values()].find((m) => m.searchAttempts.size > 0)!;
    const restoredAttempt = [...restoredMap.searchAttempts.values()][0]!;
    expect(restoredAttempt.id).not.toBe(attempt.id);
    expect(restoredAttempt.skill).toBe('survival');
    expect(restoredAttempt.total).toBe(attempt.total);
    expect(restoredAttempt.characterId).not.toBe(attempt.characterId);

    const restoredPending = [...restored.pendingReveals.values()][0]!;
    expect(restoredPending.attemptId).toBe(restoredAttempt.id);
    expect(restoredPending.characterId).toBe(restoredAttempt.characterId);
    expect(restoredPending.clueId).not.toBe(pending.clueId);
    expect(restoredPending.locates).toBe(pending.locates);
    // The restored pending still points at a live clue.
    expect(restored.findContentByClue(restoredPending.clueId)?.title).toBe('Cache');
  });
});
