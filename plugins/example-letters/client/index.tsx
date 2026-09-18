import { useEffect, useState } from 'react';
import {
  Button,
  EmptyNote,
  Field,
  Input,
  Lbl,
  Section,
  Select,
  TextArea,
  defineClientPlugin,
  usePluginAction,
  usePluginQuery,
  useViewer,
  type PluginPanelProps,
} from '@hexcrawl/client/plugin-api';
import manifest from '../manifest.js';

interface Letter {
  id: string;
  characterId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  gameDate: string;
  wikiUrl: string | null;
  wikiError: string | null;
}

function LettersPanel(props: PluginPanelProps) {
  const viewer = useViewer();
  const { data, error } = usePluginQuery<{ canPublish: boolean; letters: Letter[] }>(props, 'list', undefined, {
    topics: ['letters'],
  });
  const { busy, run } = usePluginAction(props);
  // A player writes as their own character; the DM may write as anyone (an NPC's reply, say).
  const writers = viewer.isDm ? viewer.characters : viewer.character ? [viewer.character] : [];
  const [characterId, setCharacterId] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!writers.some((c) => c.id === characterId)) setCharacterId(writers[0]?.id ?? '');
  }, [writers, characterId]);

  const send = async () => {
    const sent = await run<Letter>('send', { characterId, to, subject, body });
    if (!sent) return; // the draft stays in the form; the error is already toasted
    setTo('');
    setSubject('');
    setBody('');
    setOpen(sent.id);
  };

  return (
    <div>
      <Section title="Write a letter">
        {writers.length === 0 ? (
          <EmptyNote>Claim a character in the Party panel to write letters.</EmptyNote>
        ) : (
          <div className="space-y-2.5">
            {writers.length > 1 && (
              <Field label="From">
                <Select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
                  {writers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="To">
              <Input value={to} onChange={(e) => setTo(e.target.value)} maxLength={120} />
            </Field>
            <Field label="Subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
            </Field>
            <Field label="Letter">
              <TextArea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !to.trim() || !body.trim()}
              onClick={() => void send()}
            >
              ✉️<Lbl>{busy ? 'Sending…' : 'Send'}</Lbl>
            </Button>
            {data && !data.canPublish && (
              <p className="text-[0.6875rem] text-ink-400">
                The wiki is not connected yet — letters are kept here and can be published later.
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title={viewer.isDm ? 'All letters' : 'Your letters'}>
        {error && <p className="text-xs text-ember-500 mb-2">{error}</p>}
        {!data?.letters.length ? (
          <EmptyNote>No letters yet.</EmptyNote>
        ) : (
          <ul className="space-y-1.5">
            {data.letters.map((l) => (
              <li key={l.id} className="rounded-md border border-ink-700 bg-ink-850/60">
                <button
                  className="w-full text-left px-2.5 py-2 cursor-pointer"
                  onClick={() => setOpen(open === l.id ? null : l.id)}
                >
                  <div className="text-sm text-ink-100 truncate">
                    {l.from} → {l.to}
                    {!l.wikiUrl && <span className="ml-1.5 text-[0.625rem] text-brass-300">not on the wiki</span>}
                  </div>
                  <div className="text-[0.6875rem] text-ink-400 truncate">
                    {l.gameDate}
                    {l.subject && ` · ${l.subject}`}
                  </div>
                </button>
                {open === l.id && (
                  <div className="px-2.5 pb-2.5 border-t border-ink-700 pt-2">
                    <p className="text-xs text-ink-200 whitespace-pre-wrap break-words">{l.body}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {l.wikiUrl ? (
                        <a
                          href={l.wikiUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brass-300 hover:underline"
                        >
                          📖 On the wiki ↗
                        </a>
                      ) : (
                        <Button size="sm" disabled={busy} onClick={() => void run('publish', { id: l.id })}>
                          📤<Lbl>Publish to wiki</Lbl>
                        </Button>
                      )}
                      {viewer.isDm && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => window.confirm('Remove this letter from the app?') && void run('remove', { id: l.id })}
                        >
                          ✕<Lbl>Remove</Lbl>
                        </Button>
                      )}
                    </div>
                    {l.wikiError && <p className="text-[0.6875rem] text-ember-500 mt-1.5">{l.wikiError}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default defineClientPlugin({
  manifest,
  panels: [{ id: 'main', component: LettersPanel }],
});
