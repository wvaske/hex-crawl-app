import React from 'react';
import {
  CONTENT_TYPE_GLYPHS,
  CORE_SKILLS,
  TERRAINS,
  compassDirection,
  contentCells,
  contentCoversHex,
  isFullContent,
  describeGate,
  hexKey,
  type Content,
  type ContentPlayerView,
  type FogState,
  type SearchAttempt,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Section, cx } from '../../ui/kit.js';
import { stickerName, stickerUrl } from '../../stickers.js';

export function InspectTab() {
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  const seatId = useSession((s) => s.seatId);
  const hex = useUi((s) => s.selectedHex);
  const setUi = useUi((s) => s.set);
  const map = activeMap(state);

  if (!state || !map || !state.mapState) {
    return <EmptyNote>No active map yet.</EmptyNote>;
  }
  if (!hex) {
    return (
      <EmptyNote>
        Click a hex on the map to inspect it{role === 'dm' ? ' and manage its contents' : ''}.
      </EmptyNote>
    );
  }

  const ms = state.mapState;
  const key = hexKey(hex.q, hex.r);
  const cell = ms.hexes.find((h) => hexKey(h.q, h.r) === key);
  const fog: FogState = ms.fog.find((f) => hexKey(f.q, f.r) === key)?.state ?? 'hidden';
  const tokens = ms.tokens.filter((t) => t.q === hex.q && t.r === hex.r);
  const markers = ms.markers.filter((m) => m.q === hex.q && m.r === hex.r);
  // A multi-hex region belongs to every hex of its footprint, not just the
  // anchor — inspecting any of its hexes shows it (issue #69).
  const contents = ms.contents.filter((c) => contentCoversHex(c, hex));
  const isDm = role === 'dm';
  const myCharacterId = state.seats.find((s) => s.id === seatId)?.characterId ?? null;
  // Players have no toolbar; a claimed character is the bar for annotating.
  const canAddNote = !isDm && !!myCharacterId;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-semibold text-ink-100">
          Hex {hex.q}, {hex.r}
        </h2>
        <span className="text-xs text-ink-400">
          {cell ? TERRAINS[cell.terrain].label : 'Unpainted'}
        </span>
      </div>

      {isDm && (
        <div className="mb-3">
          <Button
            size="sm"
            className="w-full"
            title={`Wandering encounter check (${map.encounterCheck.die}, ${map.encounterCheck.threshold}+) using this hex's terrain — result lands in the DM log`}
            onClick={() =>
              send({
                kind: 'encounter.roll',
                mapId: map.id,
                q: hex.q,
                r: hex.r,
                tableId: null,
                skipCheck: false,
              })
            }
          >
            🎲 Roll encounter here
          </Button>
        </div>
      )}

      {isDm && (
        <Section title="Fog">
          <div className="flex gap-1">
            {(['visible', 'explored', 'hidden'] as FogState[]).map((s) => (
              <button
                key={s}
                onClick={() => send({ kind: 'fog.set', mapId: map.id, cells: [hex], state: s })}
                className={cx(
                  'flex-1 py-1 rounded text-xs capitalize cursor-pointer border',
                  fog === s
                    ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                    : 'border-ink-700 hover:bg-ink-700 text-ink-200',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </Section>
      )}

      {tokens.length > 0 && (
        <Section title="Tokens here">
          {/* auto-fill: one column in a narrow sidebar, more as it widens */}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-3 gap-y-1">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm text-ink-100 min-w-0">
                <span
                  className="w-4 h-4 rounded-full inline-block border border-white/40 shrink-0"
                  style={{ background: t.color }}
                />
                <span className="truncate">{t.label || '(unnamed)'}</span>
                <span className="text-xs text-ink-400">{t.kind.toUpperCase()}</span>
                {isDm && !t.playerVisible && t.kind === 'npc' && (
                  <span className="text-xs text-ember-500" title="Hidden from players">
                    hidden
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(markers.length > 0 || canAddNote) && (
        <Section title={isDm ? 'Markers' : 'Notes & markers'}>
          <ul className="space-y-1.5">
            {markers.map((m) => {
              // Players may edit/delete the party notes their own seat placed;
              // the DM moderates everything.
              const mine = m.playerPlaced && m.ownerSeatId === seatId;
              const owner = m.playerPlaced
                ? state.seats.find((s) => s.id === m.ownerSeatId)?.name
                : null;
              return (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <MarkerIcon icon={m.icon} glyph={m.glyph} />
                  <MarkerLabel markerId={m.id} label={m.label} editable={isDm || mine} />
                  {owner && !mine && (
                    <span className="text-[11px] text-ink-400 shrink-0" title="Party note">
                      — {owner}
                    </span>
                  )}
                  {isDm && (
                    <button
                      className="text-xs text-ink-400 hover:text-ink-100 cursor-pointer"
                      title={m.dmOnly ? 'DM-only — click to share' : 'Visible to players — click to hide'}
                      onClick={() =>
                        send({ kind: 'marker.update', markerId: m.id, patch: { dmOnly: !m.dmOnly } })
                      }
                    >
                      {m.dmOnly ? '🚫' : '👁️'}
                    </button>
                  )}
                  {(isDm || mine) && (
                    <button
                      className="text-xs text-ink-400 hover:text-ember-500 cursor-pointer ml-auto"
                      title={mine && !isDm ? 'Delete your note' : 'Delete marker'}
                      onClick={() => send({ kind: 'marker.delete', markerId: m.id })}
                    >
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {canAddNote && <AddPartyNote mapId={map.id} hex={hex} />}
        </Section>
      )}

      <Section
        title="Content"
        actions={
          isDm ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setUi('contentDialogHex', hex);
                setUi('editingContentId', null);
              }}
            >
              + Add
            </Button>
          ) : undefined
        }
      >
        {contents.length === 0 && (
          <EmptyNote>{isDm ? 'Nothing here yet.' : 'Nothing you know of here.'}</EmptyNote>
        )}
        <div className="space-y-2">
          {contents.map((c) =>
            isFullContent(c) ? (
              <DmContentCard key={c.id} content={c} />
            ) : (
              <PlayerContentCard key={c.id} content={c} />
            ),
          )}
        </div>
      </Section>

      <TrailInfo hex={hex} isDm={isDm} />

      {isDm && <InvestigationSection hex={hex} />}

      {(isDm || myCharacterId) && (
        <SearchHex mapId={map.id} hex={hex} isDm={isDm} characterId={myCharacterId} />
      )}

      {!isDm && !myCharacterId && (
        <p className="text-xs text-ink-400 mt-4">
          Claim a character in the Party tab to make discoveries and move a token.
        </p>
      )}
    </div>
  );
}

/**
 * Trail knowledge for the inspected hex. Players see the signs their
 * character has found (where the tracks lead and came from); the DM sees
 * every trail crossing the hex with its position along the route.
 */
function TrailInfo({ hex, isDm }: { hex: { q: number; r: number }; isDm: boolean }) {
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  const highlight = useUi((u) => u.trailHighlight);
  const setUi = useUi((s) => s.set);
  if (!state?.mapState || !map) return null;

  if (!isDm) {
    const signs = state.mapState.trailSigns.filter((s) => s.q === hex.q && s.r === hex.r);
    if (signs.length === 0) return null;
    const toggle = (trailId: string) => {
      if (highlight?.trailId === trailId) {
        setUi('trailHighlight', null);
        return;
      }
      const cells = state.mapState!.trailSigns
        .filter((s) => s.trailId === trailId)
        .map((s) => ({ q: s.q, r: s.r }));
      setUi('trailHighlight', { trailId, cells });
    };
    return (
      <Section title="Tracks">
        <ul className="space-y-1.5">
          {signs.map((s, i) => {
            const active = highlight?.trailId === s.trailId;
            return (
              <li key={i}>
                <button
                  onClick={() => toggle(s.trailId)}
                  className={cx(
                    'w-full text-left rounded-md border px-2.5 py-1.5 text-sm text-ink-100 cursor-pointer transition-colors',
                    active
                      ? 'border-brass-500 bg-brass-500/10'
                      : 'border-transparent hover:border-ink-600 hover:bg-ink-850',
                  )}
                  title={active ? 'Hide this trail on the map' : 'Show every cell you’ve found of this trail'}
                >
                  {s.glyph}{' '}
                  {s.forward
                    ? <>The trail continues <span className="text-brass-300">to the {s.forward}</span></>
                    : 'The trail ends here'}
                  {s.backward && (
                    <span className="text-ink-400"> · back-trail {s.backward}</span>
                  )}
                  {active && <span className="block text-[11px] text-brass-300 mt-0.5">highlighted on map</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
    );
  }

  const crossing = state.mapState.trails
    .map((t) => ({ trail: t, idx: t.cells.findIndex((c) => c.q === hex.q && c.r === hex.r) }))
    .filter((x) => x.idx >= 0);
  if (crossing.length === 0) return null;
  const toggleDm = (trailId: string, cells: { q: number; r: number }[]) => {
    if (highlight?.trailId === trailId) {
      setUi('trailHighlight', null);
      return;
    }
    setUi('trailHighlight', { trailId, cells });
  };
  return (
    <Section title="Trails here">
      <ul className="space-y-1.5">
        {crossing.map(({ trail, idx }) => {
          const next = trail.cells[idx + 1];
          const prev = trail.cells[idx - 1];
          const active = highlight?.trailId === trail.id;
          return (
            <li key={trail.id}>
              <button
                onClick={() => toggleDm(trail.id, trail.cells)}
                className={cx(
                  'w-full text-left rounded-md border px-2.5 py-1.5 text-sm text-ink-100 cursor-pointer transition-colors',
                  active
                    ? 'border-brass-500 bg-brass-500/10'
                    : 'border-transparent hover:border-ink-600 hover:bg-ink-850',
                )}
                title={active ? 'Hide this trail on the map' : 'Show the full trail on the map'}
              >
                {trail.glyph} <span className="font-medium">{trail.name}</span>
                <span className="block text-xs text-ink-400">
                  cell {idx + 1}/{trail.cells.length}
                  {next && ` · onward ${compassDirection(hex, next, map.orientation)}`}
                  {prev && ` · back ${compassDirection(hex, prev, map.orientation)}`}
                  {' · '}
                  {trail.gate.kind === 'skill'
                    ? `${trail.gate.skill} DC ${trail.gate.dc}`
                    : 'obvious'}
                </span>
                {active && <span className="block text-[11px] text-brass-300 mt-0.5">highlighted on map</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * Active search: roll a chosen skill against this hex. The server compares
 * the roll to the clue gates of content here (in range of the character) and
 * reveals anything the roll beats — including active-only gates that never
 * open passively.
 */
function SearchHex({
  mapId,
  hex,
  isDm,
  characterId,
}: {
  mapId: string;
  hex: { q: number; r: number };
  isDm: boolean;
  characterId: string | null;
}) {
  const [skill, setSkill] = React.useState('perception');
  const attempts = useSession((s) => s.state?.mapState?.searchAttempts) ?? EMPTY_ATTEMPTS;
  // A player gets one roll per skill on a hex (issue #107). The snapshot only
  // carries their own character's attempts, so this is all they can know.
  const spent = React.useMemo(() => {
    if (isDm || !characterId) return new Set<string>();
    return new Set(
      attempts
        .filter((a) => a.q === hex.q && a.r === hex.r && a.characterId === characterId)
        .map((a) => a.skill),
    );
  }, [attempts, hex.q, hex.r, characterId, isDm]);
  const used = spent.has(skill);
  return (
    <Section title="Search this hex">
      <p className="text-xs text-ink-400 mb-2">
        {isDm
          ? 'Rolls for every character with a token on the map; reveals clues the rolls beat.'
          : 'Roll a check against this hex — one attempt per skill. The DM describes what you turn up.'}
      </p>
      <div className="flex gap-1.5">
        <select
          className="flex-1 bg-ink-900 border border-ink-600 rounded px-2 py-1 text-sm text-ink-100 cursor-pointer capitalize"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
        >
          {CORE_SKILLS.map((s) => (
            <option key={s} value={s} disabled={spent.has(s)}>
              {s}
              {spent.has(s) ? ' — already tried' : ''}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="primary"
          disabled={used}
          title={used ? 'One attempt per skill — ask the DM for another chance' : undefined}
          onClick={() => send({ kind: 'check.roll', skill, dc: null, characterIds: [], mapId, hex })}
        >
          🎲 Roll
        </Button>
      </div>
      {!isDm && spent.size > 0 && (
        <p className="text-[11px] text-ink-400 mt-1">
          One attempt per skill. Already tried here: {[...spent].join(', ')}.
        </p>
      )}
    </Section>
  );
}

const EMPTY_ATTEMPTS: SearchAttempt[] = [];

function timeAgo(at: number, now: number): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The DM's investigation view for the inspected hex (issue #107): what the
 * party has already tried here, what their rolls turned up that still needs a
 * ruling, and what the players have passed on to each other.
 */
function InvestigationSection({ hex }: { hex: { q: number; r: number } }) {
  const state = useSession((s) => s.state);
  const now = Date.now();
  if (!state?.mapState) return null;
  const characters = state.characters;
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'Unknown';

  const attempts = state.mapState.searchAttempts
    .filter((a) => a.q === hex.q && a.r === hex.r)
    .sort((a, b) => b.at - a.at);
  const attemptById = new Map(state.mapState.searchAttempts.map((a) => [a.id, a]));

  // Pendings are campaign-wide; this hex's are the ones whose attempt is here.
  const pendings = state.pendingReveals.filter((p) => {
    const a = attemptById.get(p.attemptId);
    return a?.q === hex.q && a?.r === hex.r;
  });

  // Clue text lives on the content, which the DM always has in full.
  const clueText = new Map<string, string>();
  for (const c of state.mapState.contents) {
    if (!isFullContent(c)) continue;
    for (const clue of c.clues) clueText.set(clue.id, `${c.title} — ${clue.text}`);
  }

  // Player-to-player sharing on this hex's content (how.kind === 'shared').
  const hexClueIds = new Set<string>();
  for (const c of state.mapState.contents) {
    if (!isFullContent(c) || !contentCoversHex(c, hex)) continue;
    for (const clue of c.clues) hexClueIds.add(clue.id);
  }
  const shared = state.discoveries.filter(
    (d) => d.how.kind === 'shared' && hexClueIds.has(d.clueId),
  );

  if (attempts.length === 0 && pendings.length === 0 && shared.length === 0) return null;

  const byCharacter = new Map<string, typeof pendings>();
  for (const p of pendings) {
    const list = byCharacter.get(p.characterId) ?? [];
    list.push(p);
    byCharacter.set(p.characterId, list);
  }
  const resolve = (pendingIds: string[], approve: boolean) => {
    if (pendingIds.length) send({ kind: 'search.resolve', pendingIds, approve });
  };

  return (
    <Section title="Investigation">
      {pendings.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-brass-300">
              Awaiting your call ({pendings.length})
            </p>
            <div className="flex gap-1.5">
              <button
                className="text-[11px] text-brass-400 hover:text-brass-300 cursor-pointer"
                onClick={() => resolve(pendings.map((p) => p.id), true)}
              >
                Share all
              </button>
              <button
                className="text-[11px] text-ink-400 hover:text-ember-500 cursor-pointer"
                onClick={() => resolve(pendings.map((p) => p.id), false)}
              >
                Withhold all
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {[...byCharacter.entries()].map(([characterId, list]) => (
              <div
                key={characterId}
                className="bg-ink-850 border border-brass-500/40 rounded-lg p-2"
              >
                <p className="text-xs font-medium text-ink-100">{nameOf(characterId)}</p>
                <ul className="mt-1 space-y-1.5">
                  {list.map((p) => {
                    const attempt = attemptById.get(p.attemptId);
                    return (
                      <li
                        key={p.id}
                        className="text-xs border-t border-ink-700 pt-1.5 first:border-0 first:pt-0"
                      >
                        <p className="text-ink-200">{clueText.get(p.clueId) ?? '(clue removed)'}</p>
                        <p className="text-ink-400 mt-0.5">
                          {attempt?.skill ?? 'search'} {p.total} (d20 {p.roll}
                          {p.modifier >= 0 ? '+' : ''}
                          {p.modifier})
                          {p.direction ? ` · bearing ${p.direction}` : ''}
                          {p.locates ? ' · pins the location' : ''}
                        </p>
                        <div className="flex gap-1.5 mt-1">
                          <Button size="sm" variant="primary" onClick={() => resolve([p.id], true)}>
                            Share
                          </Button>
                          <Button size="sm" onClick={() => resolve([p.id], false)}>
                            Withhold
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {attempts.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-ink-300 mb-1">Attempts here</p>
          <ul className="space-y-1">
            {attempts.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-xs text-ink-200">
                <span className="truncate">{nameOf(a.characterId)}</span>
                <span className="text-ink-400 capitalize">{a.skill}</span>
                <span className="text-ink-100 font-medium">{a.total}</span>
                <span className="text-ink-400">{timeAgo(a.at, now)}</span>
                <button
                  className="ml-auto text-ink-400 hover:text-ember-500 cursor-pointer"
                  title={`Let ${nameOf(a.characterId)} try ${a.skill} here again`}
                  onClick={() => send({ kind: 'search.clearAttempt', attemptId: a.id })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {shared.length > 0 && (
        <div>
          <p className="text-xs font-medium text-ink-300 mb-1">Shared with the party</p>
          <ul className="space-y-1">
            {shared.map((d) => (
              <li key={d.id} className="text-xs text-ink-300">
                {clueText.get(d.clueId) ?? '(clue removed)'}
                <span className="text-ink-400">
                  {' '}
                  — shared by {d.how.kind === 'shared' ? nameOf(d.how.fromCharacterId) : 'someone'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

/** Glyphs a player can pick for a party note (issue #74). */
const NOTE_GLYPHS: { glyph: string; title: string }[] = [
  { glyph: '📌', title: 'Note' },
  { glyph: '⚠️', title: 'Danger' },
  { glyph: '⛺', title: 'Camp' },
];

/**
 * Player-side "add a note here": drops a party-wide marker on the inspected
 * hex. The server forces ownership and player visibility, so this only needs
 * the glyph and the text.
 */
function AddPartyNote({ mapId, hex }: { mapId: string; hex: { q: number; r: number } }) {
  const [glyph, setGlyph] = React.useState(NOTE_GLYPHS[0]!.glyph);
  const [text, setText] = React.useState('');
  const place = () => {
    const label = text.trim();
    if (!label) return;
    send({
      kind: 'marker.place',
      marker: { mapId, q: hex.q, r: hex.r, glyph, label, dmOnly: false },
    });
    setText('');
  };
  return (
    <div className="mt-2 pt-2 border-t border-ink-700">
      <div className="flex gap-1.5">
        <div className="flex gap-0.5">
          {NOTE_GLYPHS.map((g) => (
            <button
              key={g.glyph}
              title={g.title}
              onClick={() => setGlyph(g.glyph)}
              className={cx(
                'w-7 h-7 rounded border text-sm cursor-pointer',
                glyph === g.glyph
                  ? 'border-brass-500 bg-brass-500/15'
                  : 'border-ink-700 hover:bg-ink-700',
              )}
            >
              {g.glyph}
            </button>
          ))}
        </div>
        <input
          className="flex-1 min-w-0 bg-ink-900 border border-ink-600 rounded px-2 py-1 text-sm text-ink-100"
          placeholder="Add a note for the party…"
          maxLength={120}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') place();
          }}
        />
        <Button size="sm" variant="primary" onClick={place}>
          Pin
        </Button>
      </div>
      <p className="text-[11px] text-ink-400 mt-1">
        Party notes are visible to everyone at the table.
      </p>
    </div>
  );
}

/**
 * Marker row icon: the sticker image when the marker carries one (issue #67),
 * otherwise the emoji glyph it was placed with.
 */
function MarkerIcon({ icon, glyph }: { icon: string; glyph: string }) {
  const url = stickerUrl(icon);
  if (!url) return <span className="text-base">{glyph}</span>;
  return (
    <img
      src={url}
      alt={stickerName(icon)}
      title={stickerName(icon)}
      className="w-5 h-5 shrink-0 object-contain"
      draggable={false}
    />
  );
}

function MarkerLabel({
  markerId,
  label,
  editable,
}: {
  markerId: string;
  label: string;
  editable: boolean;
}) {
  if (!editable) return <span className="text-ink-200 truncate">{label}</span>;
  return (
    <input
      className="bg-transparent border-b border-transparent focus:border-ink-600 focus:outline-none text-sm text-ink-200 min-w-0 flex-1"
      defaultValue={label}
      placeholder="label…"
      onBlur={(e) => {
        if (e.target.value !== label) {
          send({ kind: 'marker.update', markerId, patch: { label: e.target.value } });
        }
      }}
    />
  );
}

/** Opens the full location dialog (#66) for a content card. */
function MoreButton({ contentId }: { contentId: string }) {
  const setUi = useUi((s) => s.set);
  return (
    <button
      className="text-xs text-ink-400 hover:text-ink-100 cursor-pointer"
      title="Everything about this location: clues, visits, wiki page"
      onClick={() => setUi('locationDialogContentId', contentId)}
    >
      More…
    </button>
  );
}

export function wikiHref(page: string, baseUrl: string): string {
  if (/^https?:\/\//.test(page)) return page;
  return baseUrl + encodeURIComponent(page.replace(/ /g, '_'));
}

/**
 * The title of a content card. For a multi-hex region it's a button that
 * toggles the footprint highlight on the map; single-hex content has nothing
 * to show, so it stays plain text.
 */
function ContentTitle({ content }: { content: Content | ContentPlayerView }) {
  const active = useUi((u) => u.areaHighlight?.contentId === content.id);
  const setUi = useUi((s) => s.set);
  if (content.area.length === 0) {
    return <span className="font-medium text-sm text-ink-100 truncate flex-1">{content.title}</span>;
  }
  const cells = contentCells(content);
  return (
    <button
      className={cx(
        'font-medium text-sm truncate flex-1 text-left cursor-pointer',
        active ? 'text-brass-300' : 'text-ink-100 hover:text-brass-300',
      )}
      title={
        active
          ? 'Hide this region on the map'
          : `Show all ${cells.length} hexes of this region on the map`
      }
      onClick={() =>
        setUi('areaHighlight', active ? null : { contentId: content.id, cells })
      }
    >
      {content.title}
      <span className="ml-1.5 text-[10px] text-ink-400 font-normal">{cells.length} hexes</span>
    </button>
  );
}

function DmContentCard({ content }: { content: Content }) {
  const state = useSession((s) => s.state);
  const setUi = useUi((s) => s.set);
  const pushToast = useSession((s) => s.pushToast);
  const discoveries = state?.discoveries ?? [];
  const characters = state?.characters ?? [];
  const wikiBase = state?.campaign.settings.wikiBaseUrl ?? '';

  return (
    <div className="bg-ink-850 border border-ink-700 rounded-lg p-2.5">
      <div className="flex items-center gap-2">
        <span>{content.glyph || CONTENT_TYPE_GLYPHS[content.type]}</span>
        <ContentTitle content={content} />
        {content.wikiPage && (
          <a
            className="text-xs text-arcane-500 hover:text-ink-100 cursor-pointer"
            href={wikiHref(content.wikiPage, wikiBase)}
            target="_blank"
            rel="noreferrer"
            title="Open wiki page"
          >
            wiki ↗
          </a>
        )}
        <MoreButton contentId={content.id} />
        <button
          className="text-xs text-ink-400 hover:text-brass-300 cursor-pointer"
          title="Move this location: click the destination hex on the map"
          onClick={() => {
            setUi('movingContentId', content.id);
            pushToast({ kind: 'info', title: 'Moving ' + content.title, text: 'Click the destination hex on the map.' });
          }}
        >
          📍 Move
        </button>
        <button
          className="text-xs text-ink-400 hover:text-ink-100 cursor-pointer"
          onClick={() => {
            setUi('contentDialogHex', { q: content.q, r: content.r });
            setUi('editingContentId', content.id);
          }}
        >
          Edit
        </button>
      </div>
      {content.dmNotes && (
        <p className="text-xs text-ink-300 mt-1.5 whitespace-pre-wrap">{content.dmNotes}</p>
      )}
      {content.clues.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {content.clues.map((clue) => {
            const known = discoveries.filter((d) => d.clueId === clue.id);
            return (
              <li key={clue.id} className="text-xs border-t border-ink-700 pt-1.5">
                <p className="text-ink-200">{clue.text}</p>
                <p className="text-ink-400 mt-0.5">{describeGate(clue.gate)}</p>
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  {known.map((d) => {
                    const ch = characters.find((c) => c.id === d.characterId);
                    return (
                      <span
                        key={d.id}
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-ink-950 cursor-pointer"
                        style={{ background: ch?.color ?? '#888' }}
                        title="Knows this — click to revoke"
                        onClick={() => send({ kind: 'discovery.revoke', discoveryId: d.id })}
                      >
                        {ch?.name ?? '?'} ✓
                      </span>
                    );
                  })}
                  {characters
                    .filter((ch) => !known.some((d) => d.characterId === ch.id))
                    .map((ch) => (
                      <span
                        key={ch.id}
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-dashed cursor-pointer text-ink-300 hover:text-ink-100"
                        style={{ borderColor: ch.color }}
                        title={`Doesn't know yet — click to reveal to ${ch.name}`}
                        onClick={() =>
                          send({ kind: 'clue.reveal', clueId: clue.id, characterIds: [ch.id] })
                        }
                      >
                        {ch.name}
                      </span>
                    ))}
                  <button
                    className="text-[10px] text-brass-400 hover:text-brass-300 cursor-pointer px-1"
                    onClick={() => send({ kind: 'clue.reveal', clueId: clue.id, characterIds: [] })}
                    title="Reveal to everyone"
                  >
                    Reveal to all
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlayerContentCard({ content }: { content: ContentPlayerView }) {
  const wikiBase = useSession((s) => s.state?.campaign.settings.wikiBaseUrl ?? '');
  return (
    <div className="bg-ink-850 border border-ink-700 rounded-lg p-2.5">
      <div className="flex items-center gap-2">
        <span>{content.glyph || CONTENT_TYPE_GLYPHS[content.type]}</span>
        <ContentTitle content={content} />
        {content.wikiPage && (
          <a
            className="text-xs text-arcane-500 hover:text-ink-100"
            href={wikiHref(content.wikiPage, wikiBase)}
            target="_blank"
            rel="noreferrer"
            title="Read more on the wiki"
          >
            wiki ↗
          </a>
        )}
        <MoreButton contentId={content.id} />
      </div>
      <ul className="mt-1.5 space-y-1">
        {content.discoveredClues.map((c) => (
          <li key={c.clueId} className="text-xs text-ink-200 flex items-start gap-2">
            <span className="flex-1">{c.text}</span>
            {/* The label spells out what sharing does — a phone never shows
                the `title` this used to hide it in (#75). */}
            <button
              className="shrink-0 text-[11px] px-1.5 py-1 text-brass-400 hover:text-brass-300 cursor-pointer"
              title="Tell the party — everyone learns this clue"
              onClick={() => send({ kind: 'clue.share', clueId: c.clueId })}
            >
              🤝 Share with party
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
