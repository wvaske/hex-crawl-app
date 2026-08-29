import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { fetchCampaignInfo, joinCampaign, type CampaignInfo } from '../api.js';
import { Button, Field, Input } from '../ui/kit.js';
import { TableView } from './TableView.js';

type GateState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'join'; info: CampaignInfo }
  | { phase: 'ready' };

/** Resolves seat access for /c/:campaignId, then renders the table. */
export function CampaignGate() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [params] = useSearchParams();
  const key = params.get('key');
  const [gate, setGate] = useState<GateState>({ phase: 'loading' });

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await fetchCampaignInfo(campaignId, key);
        if (cancelled) return;
        if (info.seat) {
          setGate({ phase: 'ready' });
        } else if (info.keyRole) {
          setGate({ phase: 'join', info });
        } else {
          setGate({
            phase: 'error',
            message:
              'This link is missing a valid invite key. Ask your DM to share the invite link again.',
          });
        }
      } catch (err) {
        if (!cancelled) {
          setGate({
            phase: 'error',
            message: err instanceof Error ? err.message : 'Campaign not found',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, key]);

  if (!campaignId) return null;

  if (gate.phase === 'loading') {
    return <Centered><p className="text-ink-400 animate-pulse">Entering the wilds…</p></Centered>;
  }
  if (gate.phase === 'error') {
    return (
      <Centered>
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">🌫️</div>
          <p className="text-ink-200">{gate.message}</p>
        </div>
      </Centered>
    );
  }
  if (gate.phase === 'join') {
    return <JoinForm campaignId={campaignId} info={gate.info} keyValue={key!} onJoined={() => setGate({ phase: 'ready' })} />;
  }
  return <TableView campaignId={campaignId} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center">{children}</div>;
}

function JoinForm({
  campaignId,
  info,
  keyValue,
  onJoined,
}: {
  campaignId: string;
  info: CampaignInfo;
  keyValue: string;
  onJoined: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await joinCampaign(campaignId, keyValue, name.trim());
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
      setBusy(false);
    }
  };

  return (
    <Centered>
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">⬡</div>
          <h1 className="text-2xl font-bold text-ink-100">{info.name}</h1>
          {info.description && <p className="text-ink-400 mt-1">{info.description}</p>}
          <p className="text-ink-300 mt-3">
            You've been invited {info.keyRole === 'dm' ? 'as the DM' : 'as a player'}.
          </p>
        </div>
        <form onSubmit={submit} className="bg-ink-850/80 border border-ink-700 rounded-xl p-5 space-y-4">
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} placeholder="What shall we call you?" />
          </Field>
          {error && <p className="text-sm text-ember-500">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !name.trim()}>
            {busy ? 'Joining…' : 'Join the table'}
          </Button>
        </form>
      </div>
    </Centered>
  );
}
