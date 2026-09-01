import React from 'react';
import {
  CONTENT_TYPE_GLYPHS,
  CORE_SKILLS,
  TERRAINS,
  compassDirection,
  isFullContent,
  describeGate,
  hexKey,
  type Content,
  type ContentPlayerView,
  type FogState,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Section, cx } from '../../ui/kit.js';

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
  const contents = ms.contents.filter((c) => c.q === hex.q && c.r === hex.r);
  const isDm = role === 'dm';
  const myCharacterId = state.seats.find((s) => s.id === seatId)?.characterId ?? null;

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
          <ul className="space-y-1">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm text-ink-100">
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

      {markers.length > 0 && (
        <Section title="Markers">
          <ul className="space-y-1.5">
            {markers.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className="text-base">{m.glyph}</span>
                <MarkerLabel markerId={m.id} label={m.label} editable={isDm} />
                {isDm && (
                  <>
                    <button
                      className="text-xs text-ink-400 hover:text-ink-100 cursor-pointer"
                      title={m.dmOnly ? 'DM-only — click to share' : 'Visible to players — click to hide'}
                      onClick={() =>
                        send({ kind: 'marker.update', markerId: m.id, patch: { dmOnly: !m.dmOnly } })
                      }
                    >
                      {m.dmOnly ? '🚫' : '👁️'}
                    </button>
                    <button
                      className="text-xs text-ink-400 hover:text-ember-500 cursor-pointer ml-auto"
                      onClick={() => send({ kind: 'marker.delete', markerId: m.id })}
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
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

      {(isDm || myCharacterId) && <SearchHex mapId={map.id} hex={hex} isDm={isDm} />}

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
function SearchHex({ mapId, hex, isDm }: { mapId: string; hex: { q: number; r: number }; isDm: boolean }) {
  const [skill, setSkill] = React.useState('perception');
  return (
    <Section title="Search this hex">
      <p className="text-xs text-ink-400 mb-2">
        {isDm
          ? 'Rolls for every character with a token on the map; reveals clues the rolls beat.'
          : 'Roll a check against this hex — you might notice something others missed.'}
      </p>
      <div className="flex gap-1.5">
        <select
          className="flex-1 bg-ink-900 border border-ink-600 rounded px-2 py-1 text-sm text-ink-100 cursor-pointer capitalize"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
        >
          {CORE_SKILLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="primary"
          onClick={() => send({ kind: 'check.roll', skill, dc: null, characterIds: [], mapId, hex })}
        >
          🎲 Roll
        </Button>
      </div>
    </Section>
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

export function wikiHref(page: string, baseUrl: string): string {
  if (/^https?:\/\//.test(page)) return page;
  return baseUrl + encodeURIComponent(page.replace(/ /g, '_'));
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
        <span className="font-medium text-sm text-ink-100 truncate flex-1">{content.title}</span>
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
        <span className="font-medium text-sm text-ink-100 flex-1">{content.title}</span>
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
      </div>
      <ul className="mt-1.5 space-y-1">
        {content.discoveredClues.map((c) => (
          <li key={c.clueId} className="text-xs text-ink-200 flex items-start gap-2">
            <span className="flex-1">{c.text}</span>
            <button
              className="shrink-0 text-[10px] text-brass-400 hover:text-brass-300 cursor-pointer"
              title="Tell the party — everyone learns this clue"
              onClick={() => send({ kind: 'clue.share', clueId: c.clueId })}
            >
              🤝 Share
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
