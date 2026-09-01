import React, { useState } from 'react';
import {
  CONTENT_TYPES,
  CONTENT_TYPE_GLYPHS,
  CORE_SKILLS,
  isFullContent,
  type Content,
  type ContentType,
  type Gate,
  type HexCoord,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button, Dialog, Field, Input, Select, TextArea, cx } from '../ui/kit.js';
import { RegionBrushControls } from './Toolbar.js';

interface ClueDraft {
  id: string | null;
  text: string;
  gate: Gate;
  indicatesDirection: boolean;
  revealsLocation: boolean;
}

/** DM editor for hex content and its gated clues. */
export function ContentDialog() {
  const hex = useUi((s) => s.contentDialogHex)!;
  const editingId = useUi((s) => s.editingContentId);
  const setUi = useUi((s) => s.set);
  const state = useSession((s) => s.state);
  const map = activeMap(state);

  const existing =
    editingId && state?.mapState
      ? (state.mapState.contents.find((c) => c.id === editingId && isFullContent(c)) as
          | Content
          | undefined)
      : undefined;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [type, setType] = useState<ContentType>(existing?.type ?? 'landmark');
  const [glyph, setGlyph] = useState(existing?.glyph ?? '');
  const [dmNotes, setDmNotes] = useState(existing?.dmNotes ?? '');
  const [showLabel, setShowLabel] = useState(existing?.showLabel ?? false);
  const [scaleVisibility, setScaleVisibility] = useState(existing?.scaleVisibility ?? 1);
  const [wikiPage, setWikiPage] = useState(existing?.wikiPage ?? '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [knownLocation, setKnownLocation] = useState(existing?.knownLocation ?? false);
  const [quest, setQuest] = useState(existing?.quest ?? '');
  const [area, setArea] = useState<HexCoord[]>(existing?.area ?? []);
  const areaPaint = useUi((s) => s.areaPaint);

  // Painting lives in the ui store (the engine writes the toggles); the draft
  // comes back here whenever the mode ends — Done, Escape, or otherwise — so
  // no route out of paint mode silently drops the work.
  const painted = React.useRef<HexCoord[] | null>(null);
  React.useEffect(() => {
    if (areaPaint) {
      painted.current = areaPaint.cells;
    } else if (painted.current) {
      setArea(painted.current);
      painted.current = null;
    }
  }, [areaPaint]);
  const [clues, setClues] = useState<ClueDraft[]>(
    existing?.clues.map((c) => ({
      id: c.id,
      text: c.text,
      gate: c.gate,
      indicatesDirection: c.indicatesDirection,
      revealsLocation: c.revealsLocation,
    })) ?? [],
  );

  const close = () => {
    setUi('areaPaint', null);
    setUi('contentDialogHex', null);
    setUi('editingContentId', null);
  };

  // Painting hands the map over to the DM: the modal would swallow the
  // clicks, so it collapses to a floating bar until they're done. The
  // component stays mounted, so the rest of the draft survives untouched.
  const startPaint = () => setUi('areaPaint', { cells: area });

  if (!map) return null;

  if (areaPaint) {
    return (
      <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 flex-wrap justify-center max-w-[calc(100vw-1.5rem)] bg-ink-850/95 border border-brass-500/60 rounded-xl shadow-2xl px-4 py-2.5 backdrop-blur">
        <span className="text-sm text-ink-100">
          Painting the area of <span className="font-medium">{title.trim() || 'this content'}</span>
        </span>
        <span className="text-xs text-ink-400">
          {areaPaint.cells.length} extra hex{areaPaint.cells.length === 1 ? '' : 'es'} · drag to
          paint
        </span>
        <RegionBrushControls compact />
        <Button size="sm" variant="ghost" onClick={() => setUi('areaPaint', { cells: [] })}>
          Clear
        </Button>
        <Button size="sm" variant="primary" onClick={() => setUi('areaPaint', null)}>
          Done
        </Button>
      </div>
    );
  }

  const save = () => {
    if (!title.trim()) return;
    send({
      kind: 'content.upsert',
      content: {
        id: existing?.id ?? null,
        mapId: map.id,
        q: hex.q,
        r: hex.r,
        // The anchor is always a member; only the extra hexes travel here.
        area: area.filter((c) => !(c.q === hex.q && c.r === hex.r)),
        type,
        title: title.trim(),
        dmNotes,
        glyph,
        showLabel,
        scaleVisibility,
        wikiPage: wikiPage.trim(),
        enabled,
        knownLocation,
        quest: quest.trim(),
        clues: clues
          .filter((c) => c.text.trim())
          .map((c, i) => ({
            id: c.id,
            text: c.text.trim(),
            gate: c.gate,
            sortOrder: i,
            indicatesDirection: c.indicatesDirection,
            revealsLocation: c.revealsLocation,
          })),
      },
    });
    close();
  };

  return (
    <Dialog
      title={`${existing ? 'Edit' : 'New'} content — hex ${hex.q}, ${hex.r}`}
      onClose={close}
      wide
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_4rem] gap-2">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="The Sunken Barrow" maxLength={120} />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as ContentType)}>
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CONTENT_TYPE_GLYPHS[t]} {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Glyph">
            <Input value={glyph} onChange={(e) => setGlyph(e.target.value)} placeholder={CONTENT_TYPE_GLYPHS[type]} maxLength={8} />
          </Field>
        </div>
        <Field label="DM notes (never shown to players)">
          <TextArea rows={3} value={dmNotes} onChange={(e) => setDmNotes(e.target.value)} placeholder="Stat blocks, secrets, plans…" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
          <input type="checkbox" checked={showLabel} onChange={(e) => setShowLabel(e.target.checked)} />
          Always show the name on the map (major towns and the like)
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
          <input
            type="checkbox"
            checked={knownLocation}
            onChange={(e) => setKnownLocation(e.target.checked)}
          />
          Location known to players
          <span className="text-xs text-ink-400">(pin always shown; clues stay gated)</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
          <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer pb-1.5">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
            <span className="text-xs text-ink-400">(off = doesn't exist for players yet)</span>
          </label>
          <Field label="Quest tag (group for bulk enable/disable)">
            <Input value={quest} onChange={(e) => setQuest(e.target.value)} placeholder="varram-hunt" maxLength={120} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Visible at hex scales">
            <Select
              value={scaleVisibility}
              onChange={(e) => setScaleVisibility(Number(e.target.value))}
            >
              <option value={0}>Fine hexes only (searching)</option>
              <option value={1}>Fine + regional</option>
              <option value={2}>Every zoom level (cities, roads)</option>
            </Select>
          </Field>
          <Field label="Wiki page (players can read more)">
            <Input
              value={wikiPage}
              onChange={(e) => setWikiPage(e.target.value)}
              placeholder="Elturel"
              maxLength={300}
            />
          </Field>
        </div>

        <div className="border border-ink-700 rounded-lg p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
              Area
            </span>
            <span className="text-xs text-ink-300">
              {area.length === 0
                ? 'single hex'
                : `${area.length + 1} hexes (anchor + ${area.length})`}
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={startPaint}>
              🖌 Paint area
            </Button>
            {area.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setArea([])}>
                Clear area
              </Button>
            )}
          </div>
          <p className="text-[11px] text-ink-400 mt-1">
            A multi-hex region is explored if the party reaches <em>any</em> of its hexes: gates,
            searches and distances all use the nearest one.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
              Clues — what players can learn
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setClues([
                  ...clues,
                  {
                    id: null,
                    text: '',
                    gate: { kind: 'skill', skill: 'perception', dc: 12, maxDistance: 1, mode: 'passive' },
                    indicatesDirection: false,
                    revealsLocation: true,
                  },
                ])
              }
            >
              + Add clue
            </Button>
          </div>
          {clues.length === 0 && (
            <p className="text-xs text-ink-400 italic mb-2">
              Without clues, this content is only visible to you. Add clues so characters can
              discover it — automatically on arrival, via passive skills at a distance, or when you
              choose.
            </p>
          )}
          <div className="space-y-2">
            {clues.map((clue, i) => (
              <ClueEditor
                key={i}
                clue={clue}
                onChange={(next) => setClues(clues.map((c, j) => (j === i ? next : c)))}
                onRemove={() => setClues(clues.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="primary" onClick={save} disabled={!title.trim()}>
            {existing ? 'Save changes' : 'Create content'}
          </Button>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {existing && (
            <Button
              variant="danger"
              className="ml-auto"
              onClick={() => {
                if (confirm(`Delete "${existing.title}"?`)) {
                  send({ kind: 'content.delete', contentId: existing.id });
                  close();
                }
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ClueEditor({
  clue,
  onChange,
  onRemove,
}: {
  clue: ClueDraft;
  onChange: (c: ClueDraft) => void;
  onRemove: () => void;
}) {
  const gate = clue.gate;
  const setGateKind = (kind: 'auto' | 'skill' | 'manual') => {
    if (kind === 'skill') {
      onChange({
        ...clue,
        gate: { kind: 'skill', skill: 'perception', dc: 12, maxDistance: 1, mode: 'passive' },
      });
    } else {
      onChange({ ...clue, gate: { kind } });
    }
  };

  return (
    <div className="bg-ink-900 border border-ink-700 rounded-lg p-2.5">
      <div className="flex gap-2 items-start">
        <TextArea
          rows={2}
          className="!text-xs"
          value={clue.text}
          onChange={(e) => onChange({ ...clue, text: e.target.value })}
          placeholder="What the character learns, in player-facing words…"
        />
        <button className="text-ink-400 hover:text-ember-500 cursor-pointer text-sm mt-1" onClick={onRemove}>
          ✕
        </button>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {(['auto', 'skill', 'manual'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setGateKind(k)}
            className={cx(
              'px-2 py-0.5 rounded-full text-[11px] cursor-pointer border capitalize',
              gate.kind === k
                ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                : 'border-ink-700 text-ink-300 hover:bg-ink-700',
            )}
            title={
              k === 'auto'
                ? 'Revealed when a character enters this hex'
                : k === 'skill'
                  ? 'Gated by a skill check at a distance'
                  : 'Only you can reveal it'
            }
          >
            {k}
          </button>
        ))}
        {gate.kind === 'skill' && (
          <>
            <select
              className="bg-ink-900 border border-ink-600 rounded px-1 py-0.5 text-[11px] text-ink-100 cursor-pointer"
              value={gate.skill}
              onChange={(e) => onChange({ ...clue, gate: { ...gate, skill: e.target.value } })}
            >
              {CORE_SKILLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="text-[11px] text-ink-400">
              DC{' '}
              <input
                type="number"
                min={1}
                max={40}
                className="w-12 bg-ink-900 border border-ink-600 rounded px-1 py-0.5 text-[11px] text-ink-100"
                value={gate.dc}
                onChange={(e) =>
                  onChange({ ...clue, gate: { ...gate, dc: clampInt(e.target.value, 1, 40, gate.dc) } })
                }
              />
            </label>
            <label className="text-[11px] text-ink-400">
              within{' '}
              <input
                type="number"
                min={0}
                max={30}
                className="w-12 bg-ink-900 border border-ink-600 rounded px-1 py-0.5 text-[11px] text-ink-100"
                value={gate.maxDistance}
                onChange={(e) =>
                  onChange({
                    ...clue,
                    gate: { ...gate, maxDistance: clampInt(e.target.value, 0, 30, gate.maxDistance) },
                  })
                }
              />{' '}
              hexes
            </label>
            <select
              className="bg-ink-900 border border-ink-600 rounded px-1 py-0.5 text-[11px] text-ink-100 cursor-pointer"
              value={gate.mode}
              onChange={(e) =>
                onChange({ ...clue, gate: { ...gate, mode: e.target.value as 'passive' | 'active' } })
              }
              title="Passive: opens automatically when the passive score qualifies. Active: only when you trigger a roll."
            >
              <option value="passive">passive</option>
              <option value="active">active roll</option>
            </select>
          </>
        )}
        <button
          onClick={() => onChange({ ...clue, indicatesDirection: !clue.indicatesDirection })}
          className={cx(
            'px-2 py-0.5 rounded-full text-[11px] cursor-pointer border',
            clue.indicatesDirection
              ? 'border-brass-500 bg-brass-500/15 text-brass-300'
              : 'border-ink-700 text-ink-300 hover:bg-ink-700',
          )}
          title='Append the sensed compass bearing when delivered, e.g. "… — to the north-east" (computed from where the character stands toward this hex)'
        >
          🧭 direction
        </button>
        <button
          onClick={() => onChange({ ...clue, revealsLocation: !clue.revealsLocation })}
          className={cx(
            'px-2 py-0.5 rounded-full text-[11px] cursor-pointer border',
            clue.revealsLocation
              ? 'border-brass-500 bg-brass-500/15 text-brass-300'
              : 'border-ink-700 text-ink-300 hover:bg-ink-700',
          )}
          title="On: discovering this clue on the hex reveals the pin. Off: info-only — the item stays hidden until some location-revealing clue (or check) finds it."
        >
          📍 location
        </button>
      </div>
    </div>
  );
}

function clampInt(v: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
