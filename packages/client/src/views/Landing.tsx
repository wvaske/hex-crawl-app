import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { createCampaign, fetchInstanceInfo } from '../api.js';
import { Button, Field, Input } from '../ui/kit.js';

export function Landing() {
  const [name, setName] = useState('');
  const [dmName, setDmName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  /** Set by the operator via CREATE_PASSWORD; probed from /api/instance. */
  const [createGated, setCreateGated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void fetchInstanceInfo().then((info) => setCreateGated(info.createGated));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createCampaign(name.trim(), dmName.trim() || 'DM', createPassword);
      navigate(`/c/${result.campaignId}?key=${result.dmKey}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
      setBusy(false);
    }
  };

  /** Restore a `hexcrawl-*.json` export as a brand-new campaign. */
  const restore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRestoring(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('dmName', dmName.trim() || 'DM');
      // Restore creates a campaign, so it passes the same instance gate.
      if (createPassword) form.append('createPassword', createPassword);
      const res = await fetch('/api/campaigns/import', { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        campaignId?: string;
        dmKey?: string;
      };
      if (!res.ok || !body.campaignId) throw new Error(body.error ?? `Restore failed (${res.status})`);
      navigate(`/c/${body.campaignId}?key=${body.dmKey}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup');
      setRestoring(false);
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
          {createGated && (
            <Field label="Instance password">
              <Input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="Set by whoever runs this server"
                maxLength={200}
              />
            </Field>
          )}
          {error && <p className="text-sm text-ember-500">{error}</p>}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={busy || restoring || !name.trim() || (createGated && !createPassword)}
          >
            {busy ? 'Creating…' : 'Create campaign'}
          </Button>
          <p className="text-xs text-ink-400 text-center">
            You'll get a DM link and a player invite link. No accounts needed.
          </p>
          <div className="pt-3 border-t border-ink-700 space-y-2">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={restore}
            />
            <Button
              type="button"
              className="w-full"
              disabled={busy || restoring || (createGated && !createPassword)}
              onClick={() => fileInput.current?.click()}
            >
              {restoring ? 'Restoring…' : 'Restore from backup'}
            </Button>
            <p className="text-xs text-ink-400 text-center">
              Loads a <code>hexcrawl-*.json</code> export as a new campaign with new invite links.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
