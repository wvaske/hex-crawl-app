import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { createCampaign } from '../api.js';
import { Button, Field, Input } from '../ui/kit.js';

export function Landing() {
  const [name, setName] = useState('');
  const [dmName, setDmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createCampaign(name.trim(), dmName.trim() || 'DM');
      navigate(`/c/${result.campaignId}?key=${result.dmKey}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-[radial-gradient(ellipse_at_top,#1d2230_0%,#0b0d12_65%)]">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⬡</div>
          <h1 className="text-3xl font-bold tracking-tight text-ink-100">HexCrawl VTT</h1>
          <p className="text-ink-400 mt-2">
            Fog of war, wandering encounters, and skill-gated discoveries — a virtual tabletop
            built for hex crawl exploration.
          </p>
        </div>
        <form
          onSubmit={submit}
          className="bg-ink-850/80 border border-ink-700 rounded-xl p-5 space-y-4 shadow-xl"
        >
          <Field label="Campaign name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Sunless Marches"
              autoFocus
              maxLength={120}
            />
          </Field>
          <Field label="Your name (as DM)">
            <Input
              value={dmName}
              onChange={(e) => setDmName(e.target.value)}
              placeholder="DM"
              maxLength={60}
            />
          </Field>
          {error && <p className="text-sm text-ember-500">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create campaign'}
          </Button>
          <p className="text-xs text-ink-400 text-center">
            You'll get a DM link and a player invite link. No accounts needed.
          </p>
        </form>
      </div>
    </div>
  );
}
