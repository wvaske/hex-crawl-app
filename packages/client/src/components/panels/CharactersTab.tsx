import React, { useState } from 'react';
import { CORE_SKILLS, passiveScore, type Character } from '@hexcrawl/shared';
import { useSession } from '../../stores/session.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Field, Input, Section, cx } from '../../ui/kit.js';

const CHARACTER_COLORS = [
  '#e05555', '#e08f3c', '#c9a24b', '#6fa06b', '#4a9d9c', '#5b8dd9', '#8b7fd4', '#c56bb8',
];

export function CharactersTab() {
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  const seatId = useSession((s) => s.seatId);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!state) return null;
  const mySeat = state.seats.find((s) => s.id === seatId);
  const isDm = role === 'dm';

  return (
    <div>
      <Section
        title="Party"
        actions={
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            + New character
          </Button>
        }
      >
        {state.characters.length === 0 && (
          <EmptyNote>
            No characters yet. {isDm ? 'Create the party here, or let players make their own.' : 'Create your character to join the exploration.'}
          </EmptyNote>
        )}
        <div className="space-y-2">
          {state.characters.map((ch) => {
            const claimedBy = state.seats.find((s) => s.characterId === ch.id);
            const isMine = mySeat?.characterId === ch.id;
            const canEdit = isDm || isMine;
            const open = expanded === ch.id;
            return (
              <div key={ch.id} className="bg-ink-850 border border-ink-700 rounded-lg">
                <button
                  className="w-full flex items-center gap-2.5 p-2.5 cursor-pointer text-left"
                  onClick={() => setExpanded(open ? null : ch.id)}
                >
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 border border-white/20"
                    style={{ background: ch.color }}
                  >
                    {ch.glyph || ch.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink-100 truncate">
                      {ch.name} {isMine && <span className="text-brass-400">(you)</span>}
                    </span>
                    <span className="block text-xs text-ink-400 truncate">
                      {claimedBy ? `Played by ${claimedBy.name}` : 'Unclaimed'} · Passive Perception{' '}
                      {passiveScore(ch.skills, 'perception')}
                    </span>
                  </span>
                  <span className="text-ink-400 text-xs">{open ? '▲' : '▼'}</span>
                </button>
                {open && (
                  <div className="border-t border-ink-700 p-2.5">
                    {!claimedBy && !isDm && !mySeat?.characterId && (
                      <Button
                        variant="primary"
                        size="sm"
                        className="w-full mb-2.5"
                        onClick={() => send({ kind: 'seat.claimCharacter', characterId: ch.id })}
                      >
                        Play as {ch.name}
                      </Button>
                    )}
                    {isMine && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full mb-2.5"
                        onClick={() => send({ kind: 'seat.claimCharacter', characterId: null })}
                      >
                        Release character
                      </Button>
                    )}
                    <CharacterEditor character={ch} readOnly={!canEdit} />
                    {isDm && (
                      <Button
                        variant="danger"
                        size="sm"
                        className="w-full mt-2.5"
                        onClick={() => {
                          if (confirm(`Delete ${ch.name}? Their discoveries are lost.`)) {
                            send({ kind: 'character.delete', characterId: ch.id });
                          }
                        }}
                      >
                        Delete character
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
      {creating && <NewCharacterForm onDone={() => setCreating(false)} />}
    </div>
  );
}

function NewCharacterForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(CHARACTER_COLORS[0]!);
  const role = useSession((s) => s.role);
  const seatCharacter = useSession((s) =>
    s.state?.seats.find((seat) => seat.id === s.seatId)?.characterId,
  );

  const create = () => {
    if (!name.trim()) return;
    send({
      kind: 'character.create',
      character: { name: name.trim(), color, glyph: '', speed: 30, skills: {} },
    });
    onDone();
  };

  return (
    <div className="bg-ink-850 border border-brass-500/40 rounded-lg p-3 space-y-2.5">
      <Field label="Character name">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} onKeyDown={(e) => e.key === 'Enter' && create()} />
      </Field>
      <Field label="Color">
        <div className="flex gap-1.5 flex-wrap">
          {CHARACTER_COLORS.map((c) => (
            <button
              key={c}
              className={cx(
                'w-6 h-6 rounded-full cursor-pointer border-2',
                color === c ? 'border-white' : 'border-transparent',
              )}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </Field>
      {role === 'player' && !seatCharacter && (
        <p className="text-xs text-ink-400">Tip: after creating, claim it to play.</p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={create} disabled={!name.trim()}>
          Create
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CharacterEditor({ character, readOnly }: { character: Character; readOnly: boolean }) {
  const [customName, setCustomName] = useState('');
  const patch = (p: Partial<Character>) =>
    send({ kind: 'character.update', characterId: character.id, patch: p });

  const allSkills: string[] = [
    ...CORE_SKILLS,
    ...Object.keys(character.skills).filter((s) => !(CORE_SKILLS as readonly string[]).includes(s)),
  ];

  return (
    <div className="space-y-2.5">
      {!readOnly && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name">
            <Input
              defaultValue={character.name}
              maxLength={60}
              onBlur={(e) => e.target.value.trim() && e.target.value !== character.name && patch({ name: e.target.value.trim() })}
            />
          </Field>
          <Field label="Glyph / emoji">
            <Input
              defaultValue={character.glyph}
              maxLength={8}
              placeholder="🏹"
              onBlur={(e) => e.target.value !== character.glyph && patch({ glyph: e.target.value })}
            />
          </Field>
        </div>
      )}
      <div>
        <p className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5">
          Skill modifiers <span className="normal-case">(passive = 10 + mod)</span>
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {allSkills.map((skill) => (
            <label key={skill} className="flex items-center justify-between gap-1 text-xs text-ink-200">
              <span className="capitalize truncate">{skill}</span>
              {readOnly ? (
                <span className="font-mono text-ink-100">
                  {(character.skills[skill] ?? 0) >= 0 ? '+' : ''}
                  {character.skills[skill] ?? 0}
                </span>
              ) : (
                <input
                  type="number"
                  min={-10}
                  max={20}
                  className="w-13 rounded bg-ink-900 border border-ink-600 px-1 py-0.5 text-xs text-right focus:outline-none focus:border-brass-500"
                  key={`${skill}-${character.skills[skill] ?? 0}`}
                  defaultValue={character.skills[skill] ?? 0}
                  onBlur={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (Number.isFinite(v) && v !== (character.skills[skill] ?? 0)) {
                      patch({ skills: { ...character.skills, [skill]: Math.min(20, Math.max(-10, v)) } });
                    }
                  }}
                />
              )}
            </label>
          ))}
        </div>
        {!readOnly && (
          <div className="flex gap-1.5 mt-2">
            <Input
              className="!text-xs !py-1"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Custom skill…"
              maxLength={30}
            />
            <Button
              size="sm"
              onClick={() => {
                const key = customName.trim().toLowerCase();
                if (key && !(key in character.skills)) {
                  patch({ skills: { ...character.skills, [key]: 0 } });
                  setCustomName('');
                }
              }}
            >
              +
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
