import React from 'react';
import type { Character, CharacterExtra } from '@hexcrawl/shared';
import { useSession } from '../stores/session.js';
import { send } from '../ws.js';
import { Button, Dialog, Field, Input, TextArea } from '../ui/kit.js';
import { CharacterEditor } from './panels/CharactersTab.js';

const EXTRA_FIELDS: Array<{
  key: keyof CharacterExtra;
  label: string;
  placeholder: string;
  rows: number;
  hint?: string;
}> = [
  { key: 'bio', label: 'Bio', placeholder: 'Who are they, where are they from…', rows: 4 },
  { key: 'appearance', label: 'Appearance', placeholder: 'What they look like, how they carry themselves…', rows: 3 },
  { key: 'goals', label: 'Goals', placeholder: 'What they want, who they answer to…', rows: 3 },
  { key: 'inventory', label: 'Inventory', placeholder: 'Notable gear, loot, coin…', rows: 4 },
  {
    key: 'notes',
    label: 'Notes',
    placeholder: 'Anything else worth remembering…',
    rows: 4,
    hint: 'Notes will sync to the campaign wiki in a future update.',
  },
];

/**
 * The full character sheet: skills (with roll buttons), speed, D&D Beyond
 * sync, and the player-editable extras (bio/appearance/goals/inventory/
 * notes). Opened from CharactersTab via the "Open sheet" affordance; the
 * inline party-list editor keeps working alongside this for quick edits.
 */
export function CharacterDialog({ character, onClose }: { character: Character; onClose: () => void }) {
  const role = useSession((s) => s.role);
  const seatId = useSession((s) => s.seatId);
  const state = useSession((s) => s.state);
  const mySeat = state?.seats.find((s) => s.id === seatId);
  const isDm = role === 'dm';
  const isMine = mySeat?.characterId === character.id;
  const canEdit = isDm || isMine;
  const claimedBy = state?.seats.find((s) => s.characterId === character.id);

  const patchExtra = (key: keyof CharacterExtra, value: string) => {
    if (value === character.extra[key]) return;
    send({
      kind: 'character.update',
      characterId: character.id,
      patch: { extra: { [key]: value } as Partial<CharacterExtra> },
    });
  };

  return (
    <Dialog title={`${character.name}${isMine ? ' (you)' : ''} — character sheet`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span
            className="w-12 h-12 rounded-full flex items-center justify-center text-xl shrink-0 border border-white/20"
            style={{ background: character.color }}
          >
            {character.glyph || character.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink-100 truncate">{character.name}</p>
            <p className="text-xs text-ink-400 truncate">
              {claimedBy ? `Played by ${claimedBy.name}` : 'Unclaimed'}
            </p>
          </div>
        </div>

        <Field label="Speed (ft / round)">
          {canEdit ? (
            <Input
              type="number"
              min={0}
              max={120}
              className="!w-24"
              defaultValue={character.speed}
              onBlur={(e) => {
                const v = Math.round(Number(e.target.value));
                if (Number.isFinite(v) && v !== character.speed) {
                  send({
                    kind: 'character.update',
                    characterId: character.id,
                    patch: { speed: Math.min(120, Math.max(0, v)) },
                  });
                }
              }}
            />
          ) : (
            <p className="text-sm text-ink-100">{character.speed} ft</p>
          )}
        </Field>

        <CharacterEditor character={character} readOnly={!canEdit} canRoll={canEdit} />

        <div className="space-y-3 pt-3 border-t border-ink-700">
          <p className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
            Character details
          </p>
          {EXTRA_FIELDS.map(({ key, label, placeholder, rows, hint }) => (
            <Field key={key} label={label}>
              {canEdit ? (
                <TextArea
                  rows={rows}
                  defaultValue={character.extra[key]}
                  maxLength={5000}
                  placeholder={placeholder}
                  onBlur={(e) => patchExtra(key, e.target.value)}
                />
              ) : character.extra[key] ? (
                <p className="text-sm text-ink-100 whitespace-pre-wrap">{character.extra[key]}</p>
              ) : (
                <p className="text-sm text-ink-500 italic">—</p>
              )}
              {hint && <p className="text-[11px] text-ink-500 mt-1">{hint}</p>}
            </Field>
          ))}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
