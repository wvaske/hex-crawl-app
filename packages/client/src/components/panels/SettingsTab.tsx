import React, { useEffect, useState } from 'react';
import { useSession } from '../../stores/session.js';
import { send } from '../../ws.js';
import { Button, Field, Input, Section, TextArea } from '../../ui/kit.js';

export function SettingsTab({ campaignId }: { campaignId: string }) {
  const state = useSession((s) => s.state);
  if (!state) return null;

  return (
    <div>
      <Section title="Campaign">
        <div className="space-y-2.5">
          <Field label="Name">
            <Input
              defaultValue={state.campaign.name}
              key={state.campaign.name}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== state.campaign.name &&
                send({ kind: 'campaign.update', name: e.target.value.trim() })
              }
            />
          </Field>
          <Field label="Description (shown on the join page)">
            <TextArea
              rows={3}
              defaultValue={state.campaign.settings.description}
              key={state.campaign.settings.description}
              onBlur={(e) =>
                e.target.value !== state.campaign.settings.description &&
                send({ kind: 'campaign.update', settings: { description: e.target.value } })
              }
            />
          </Field>
        </div>
      </Section>

      <ShareLinks campaignId={campaignId} />

      <Section title="Seats">
        <p className="text-xs text-ink-400 mb-2">
          A seat is a browser that joined via an invite link. If a player lost their seat (new
          device, cleared cookies), release their character here so they can claim it again after
          re-joining, and remove the stale seat.
        </p>
        <ul className="space-y-1">
          {state.seats.map((seat) => {
            const isMe = seat.id === useSession.getState().seatId;
            return (
              <li key={seat.id} className="flex items-center gap-2 text-sm text-ink-200">
                <span className={seat.online ? 'text-moss-500' : 'text-ink-600'}>●</span>
                <span className="truncate">
                  {seat.name}
                  {isMe && <span className="text-brass-400"> (you)</span>}
                </span>
                <span className="text-xs text-ink-400 uppercase">{seat.role}</span>
                {seat.characterId && (
                  <span className="text-xs text-ink-400 truncate">
                    → {state.characters.find((c) => c.id === seat.characterId)?.name}
                  </span>
                )}
                <span className="flex-1" />
                {seat.characterId && !isMe && (
                  <button
                    className="text-xs text-ink-400 hover:text-brass-300 cursor-pointer"
                    title="Release this seat's character so someone can claim it again"
                    onClick={() => send({ kind: 'seat.releaseCharacter', seatId: seat.id })}
                  >
                    release
                  </button>
                )}
                {!isMe && (
                  <button
                    className="text-xs text-ink-400 hover:text-ember-500 cursor-pointer"
                    title="Remove this seat (the browser behind it will have to re-join)"
                    onClick={() => {
                      if (confirm(`Remove seat "${seat.name}"? Their browser will need to re-join via the invite link.`)) {
                        send({ kind: 'seat.delete', seatId: seat.id });
                      }
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

function ShareLinks({ campaignId }: { campaignId: string }) {
  const [keys, setKeys] = useState<{ dmKey: string; playerKey: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/campaigns/${campaignId}/keys`)
      .then((r) => (r.ok ? (r.json() as Promise<{ dmKey: string; playerKey: string }>) : null))
      .then((data) => data && setKeys(data));
  }, [campaignId]);

  const copy = (label: string, url: string) => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const base = `${location.origin}/c/${campaignId}`;

  return (
    <Section title="Invite links">
      {!keys ? (
        <p className="text-xs text-ink-400 italic">Loading…</p>
      ) : (
        <div className="space-y-2">
          <div>
            <p className="text-xs text-ink-400 mb-1">Player invite — share with your table</p>
            <Button
              size="sm"
              className="w-full"
              onClick={() => copy('player', `${base}?key=${keys.playerKey}`)}
            >
              {copied === 'player' ? '✓ Copied!' : '📋 Copy player link'}
            </Button>
          </div>
          <div>
            <p className="text-xs text-ink-400 mb-1">DM link — keep this one private</p>
            <Button size="sm" className="w-full" onClick={() => copy('dm', `${base}?key=${keys.dmKey}`)}>
              {copied === 'dm' ? '✓ Copied!' : '📋 Copy DM link'}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
