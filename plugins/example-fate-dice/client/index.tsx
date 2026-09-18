import { useState } from 'react';
import {
  Button,
  EmptyNote,
  Input,
  Lbl,
  Section,
  defineClientPlugin,
  toast,
  usePluginAction,
  usePluginQuery,
  useViewer,
  type PluginPanelProps,
} from '@hexcrawl/client/plugin-api';
import manifest from '../manifest.js';

interface PoolView {
  characterId: string;
  name: string;
  color: string;
  remaining: number;
  rolls: { at: number; gameDate: string; value: number; sides: number; reason: string }[];
}
interface State {
  poolSize: number;
  dieSides: number;
  wikiPage: string | null;
  pools: PoolView[];
}

function FateDicePanel(props: PluginPanelProps) {
  const viewer = useViewer();
  const { data, error, loading } = usePluginQuery<State>(props, 'state', undefined, { topics: ['pools'] });
  const { busy, run } = usePluginAction(props);
  const [reason, setReason] = useState('');

  if (!data) return <EmptyNote>{error ?? (loading ? 'Loading…' : 'Nothing to show.')}</EmptyNote>;
  if (data.pools.length === 0) {
    return <EmptyNote>Claim a character in the Party panel to get your fate dice.</EmptyNote>;
  }

  const roll = async (pool: PoolView) => {
    const res = await run<{ value: number; sides: number; wikiError: string | null }>('roll', {
      characterId: pool.characterId,
      reason,
    });
    if (!res) return;
    setReason('');
    if (res.wikiError) toast('Fate Dice', `Rolled, but the wiki log failed: ${res.wikiError}`, 'error');
  };

  return (
    <div>
      <Section
        title={`Fate dice · d${data.dieSides}`}
        actions={
          viewer.isDm && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('refresh', {})}>
              ♻️<Lbl>Restore all</Lbl>
            </Button>
          )
        }
      >
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What is the die for? (optional)"
          maxLength={200}
          className="mb-2.5"
        />
        <ul className="space-y-2">
          {data.pools.map((pool) => (
            <li key={pool.characterId} className="rounded-md border border-ink-700 bg-ink-850/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: pool.color }} />
                <span className="text-sm font-medium text-ink-100 flex-1 truncate">{pool.name}</span>
                <span className="text-xs text-ink-300" title={`${pool.remaining} of ${data.poolSize} left`}>
                  {'●'.repeat(pool.remaining)}
                  <span className="text-ink-600">{'●'.repeat(Math.max(0, data.poolSize - pool.remaining))}</span>
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || pool.remaining === 0}
                  onClick={() => void roll(pool)}
                >
                  🎲<Lbl>Roll</Lbl>
                </Button>
              </div>
              {pool.rolls.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-300">
                  {pool.rolls.map((r) => (
                    <li key={r.at} className="flex gap-2">
                      <span className="text-brass-300 font-semibold w-5 text-right">{r.value}</span>
                      <span className="flex-1 min-w-0 truncate">{r.reason || `d${r.sides}`}</span>
                      <span className="text-ink-400 shrink-0">{r.gameDate}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Section>
      {data.wikiPage && (
        <a href={data.wikiPage} target="_blank" rel="noreferrer" className="text-xs text-brass-300 hover:underline">
          📖 Full log on the wiki ↗
        </a>
      )}
    </div>
  );
}

export default defineClientPlugin({
  manifest,
  panels: [{ id: 'main', component: FateDicePanel }],
});
