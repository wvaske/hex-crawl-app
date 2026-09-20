import React, { useEffect, useState } from 'react';
import { resolvePluginConfig, type PluginConfigField, type PluginManifest } from '@hexcrawl/shared';
import { useSession } from '../../stores/session.js';
import { send } from '../../ws.js';
import { CLIENT_PLUGINS } from '../../plugins/registry.js';
import { Button, EmptyNote, Field, Input, Section, Select, TextArea, Toggle } from '../../ui/kit.js';

/**
 * Setup → Plugins, and the wiki bot login plugins write through
 * (plugins/AGENTS.md). Installed plugins come from the build; whether one is
 * on, and its settings, are per campaign (`campaign.settings.plugins`).
 */

interface WikiStatus {
  hasWiki: boolean;
  canWrite: boolean;
  username: string | null;
}

export function PluginSettings({ campaignId }: { campaignId: string }) {
  const wikiBaseUrl = useSession((s) => s.state?.campaign.settings.wikiBaseUrl ?? '');
  const [wiki, setWiki] = useState<WikiStatus | null>(null);

  useEffect(() => {
    let stale = false;
    fetch(`/api/campaigns/${campaignId}/integrations/wiki`)
      .then((r) => (r.ok ? (r.json() as Promise<WikiStatus>) : null))
      .then((s) => !stale && setWiki(s))
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [campaignId, wikiBaseUrl]);

  if (CLIENT_PLUGINS.length === 0) return null;
  const anyUsesWiki = CLIENT_PLUGINS.some((p) => p.manifest.usesWiki);

  return (
    <>
      <Section title="Plugins">
        <div className="space-y-2">
          {CLIENT_PLUGINS.map((p) => (
            <PluginCard key={p.manifest.id} manifest={p.manifest} wiki={wiki} />
          ))}
        </div>
      </Section>
      {anyUsesWiki && <WikiWriteAccess campaignId={campaignId} status={wiki} onChange={setWiki} />}
    </>
  );
}

function PluginCard({ manifest, wiki }: { manifest: PluginManifest; wiki: WikiStatus | null }) {
  const stored = useSession((s) => s.state?.campaign.settings.plugins[manifest.id]);
  const enabled = stored?.enabled ?? false;
  const config = resolvePluginConfig(manifest, stored?.config);
  const fields = manifest.config ?? [];

  const setField = (key: string, value: string | number | boolean) => {
    if (config[key] === value) return;
    send({
      kind: 'campaign.update',
      settings: { plugins: { [manifest.id]: { config: { ...config, [key]: value } } } },
    });
  };

  return (
    <div className="rounded-md border border-ink-700 bg-ink-850/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink-100">
            {manifest.panels?.[0]?.icon ?? '🧩'} {manifest.name}
            <span className="ml-1.5 text-[0.625rem] text-ink-400 font-normal">v{manifest.version}</span>
          </div>
          <p className="text-xs text-ink-400 mt-0.5">{manifest.description}</p>
        </div>
        <Toggle
          checked={enabled}
          onChange={(v) =>
            send({ kind: 'campaign.update', settings: { plugins: { [manifest.id]: { enabled: v } } } })
          }
          label=""
        />
      </div>
      {enabled && manifest.usesWiki && wiki && !wiki.canWrite && (
        <p className="text-xs text-brass-300 mt-2">
          ⚠️ This plugin writes to the wiki —{' '}
          {wiki.hasWiki ? 'add a bot login under “Wiki write access” below.' : 'set the wiki base URL first.'}
        </p>
      )}
      {enabled && fields.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-ink-700 space-y-2.5">
          {fields.map((f) => (
            <ConfigField key={f.key} field={f} value={config[f.key] ?? f.default} onChange={setField} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: PluginConfigField;
  value: string | number | boolean;
  onChange: (key: string, value: string | number | boolean) => void;
}) {
  const help = field.help && <p className="text-[0.6875rem] text-ink-400 mt-1">{field.help}</p>;
  if (field.type === 'boolean') {
    return (
      <div>
        <Toggle checked={Boolean(value)} onChange={(v) => onChange(field.key, v)} label={field.label} />
        {help}
      </div>
    );
  }
  return (
    <Field label={field.label}>
      {field.type === 'select' ? (
        <Select value={String(value)} onChange={(e) => onChange(field.key, e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.type === 'textarea' ? (
        <TextArea
          rows={3}
          defaultValue={String(value)}
          key={String(value)}
          placeholder={field.placeholder}
          onBlur={(e) => onChange(field.key, e.target.value)}
        />
      ) : (
        <Input
          type={field.type === 'number' ? 'number' : 'text'}
          min={field.min}
          max={field.max}
          defaultValue={String(value)}
          key={String(value)}
          placeholder={field.placeholder}
          onBlur={(e) => {
            if (field.type !== 'number') return onChange(field.key, e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(field.key, n);
          }}
        />
      )}
      {help}
    </Field>
  );
}

/**
 * The bot login is write-only: the server verifies it by logging in, keeps it
 * out of snapshots and backups, and only ever reports the username back.
 */
function WikiWriteAccess({
  campaignId,
  status,
  onChange,
}: {
  campaignId: string;
  status: WikiStatus | null;
  onChange: (s: WikiStatus) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/integrations/wiki/secret`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ username: username.trim(), password }) : undefined,
      });
      const body = (await res.json().catch(() => ({}))) as WikiStatus & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      onChange(body);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Wiki write access">
      {!status?.hasWiki ? (
        <EmptyNote>Set the wiki base URL (Campaign, above) before adding a bot login.</EmptyNote>
      ) : status.canWrite ? (
        <div className="flex items-center justify-between gap-2 text-sm text-ink-200">
          <span className="min-w-0 truncate">
            ✅ Writing as <span className="text-ink-100 font-medium">{status.username}</span>
          </span>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void request('DELETE')}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-ink-400">
            Plugins write to the wiki as a bot. Create one on the wiki under{' '}
            <span className="text-ink-200">Special:BotPasswords</span> (grant “edit existing pages” and
            “create, edit, and move pages”), then paste its login here. It is stored on the server and
            never shown again.
          </p>
          <Field label="Bot username (User@botname)">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Bot password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !username.trim() || !password}
            onClick={() => void request('POST')}
          >
            {busy ? 'Checking…' : 'Verify & save'}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-ember-500 mt-2">{error}</p>}
    </Section>
  );
}
