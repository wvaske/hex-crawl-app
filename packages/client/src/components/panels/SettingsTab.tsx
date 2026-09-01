import React, { useEffect, useState } from 'react';
import {
  CALENDAR_PRESETS,
  calendarDayOptions,
  formatCalendarDate,
  type CalendarConfig,
} from '@hexcrawl/shared';
import { useSession } from '../../stores/session.js';
import { send } from '../../ws.js';
import { fetchInviteKeys, type InviteKeys } from '../../api.js';
import { Button, Field, Input, Section, Select, TextArea } from '../../ui/kit.js';

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
          <Field label="Wiki base URL (for content wiki links)">
            <Input
              defaultValue={state.campaign.settings.wikiBaseUrl}
              key={state.campaign.settings.wikiBaseUrl}
              onBlur={(e) =>
                e.target.value !== state.campaign.settings.wikiBaseUrl &&
                send({ kind: 'campaign.update', settings: { wikiBaseUrl: e.target.value } })
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

      <CalendarSettings />

      <ShareLinks campaignId={campaignId} />

      <Backup campaignId={campaignId} />

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

/**
 * Calendar naming for the campaign clock (issue #79). Deliberately minimal:
 * pick a preset (or none, which keeps the plain "Day N"), the year the
 * campaign opens in, and which day of that year day 1 is. Everything else
 * about the calendar — month names, lengths, festivals — comes from the preset
 * and is stored on the campaign, so a hand-edited calendar keeps working.
 */
function CalendarSettings() {
  const calendar = useSession((s) => s.state?.campaign.settings.calendar ?? null);
  const preset = calendar ? CALENDAR_PRESETS.find((p) => p.name === calendar.name) : undefined;
  const dayOptions = calendar ? calendarDayOptions(calendar) : [];

  const patch = (next: CalendarConfig | null) =>
    send({ kind: 'campaign.update', settings: { calendar: next } });

  return (
    <Section title="Calendar">
      <div className="space-y-2.5">
        <Field label="Calendar">
          <Select
            value={calendar?.name ?? ''}
            onChange={(e) => {
              const chosen = CALENDAR_PRESETS.find((p) => p.name === e.target.value);
              patch(chosen ? { ...chosen } : null);
            }}
          >
            <option value="">None — plain "Day 1, Day 2, …"</option>
            {CALENDAR_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        {calendar && (
          <>
            <Field label="Start year">
              <Input
                type="number"
                defaultValue={calendar.startYear}
                key={`${calendar.name}-${calendar.startYear}`}
                onBlur={(e) => {
                  const year = Math.trunc(Number(e.target.value));
                  if (Number.isFinite(year) && year !== calendar.startYear) {
                    patch({ ...calendar, startYear: year });
                  }
                }}
              />
            </Field>
            <Field label="The campaign starts on">
              <Select
                value={String(calendar.startDayOfYear)}
                onChange={(e) =>
                  patch({ ...calendar, startDayOfYear: Number(e.target.value) })
                }
              >
                {dayOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-ink-400">
              Day 1 of the campaign clock is{' '}
              <span className="text-ink-200">{formatCalendarDate(0, calendar)}</span>.{' '}
              {preset?.name === 'Harptos' &&
                'Harptos runs twelve 30-day months plus five festival days; leap-year Shieldmeet is not modelled.'}
            </p>
          </>
        )}
      </div>
    </Section>
  );
}

const ROTATE_WARNINGS: Record<'player' | 'dm', string> = {
  player:
    'Regenerate the PLAYER invite link?\n\nEvery copy of the old player link stops working — anyone who has not joined yet will need the new one. Players who already have a seat stay connected.',
  dm: 'Regenerate the DM link?\n\nThe old DM link stops working, and so does every integration that uses this campaign\'s DM key as its Bearer token (the MCP server, backup cron jobs, wiki sync). You will need to update HEXCRAWL_TOKEN and any saved ?key= URLs.',
};

function ShareLinks({ campaignId }: { campaignId: string }) {
  const [keys, setKeys] = useState<InviteKeys | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [rotating, setRotating] = useState<'player' | 'dm' | null>(null);

  useEffect(() => {
    void fetchInviteKeys(campaignId).then((data) => data && setKeys(data));
  }, [campaignId]);

  const copy = (label: string, url: string) => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  /**
   * Rotation happens over the WebSocket, and secrets are deliberately absent
   * from the state snapshot — so poll /keys briefly until the new one shows up.
   */
  const rotate = async (which: 'player' | 'dm') => {
    if (!keys || rotating) return;
    if (!confirm(ROTATE_WARNINGS[which])) return;
    const before = which === 'dm' ? keys.dmKey : keys.playerKey;
    setRotating(which);
    send({ kind: 'campaign.rotateKey', which });
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const fresh = await fetchInviteKeys(campaignId);
      if (fresh && (which === 'dm' ? fresh.dmKey : fresh.playerKey) !== before) {
        setKeys(fresh);
        break;
      }
    }
    setRotating(null);
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
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => copy('player', `${base}?key=${keys.playerKey}`)}
              >
                {copied === 'player' ? '✓ Copied!' : '📋 Copy player link'}
              </Button>
              <Button
                size="sm"
                title="Mint a new player key — old player links stop working"
                disabled={rotating !== null}
                onClick={() => void rotate('player')}
              >
                {rotating === 'player' ? '…' : '♻︎ Regenerate'}
              </Button>
            </div>
          </div>
          <div>
            <p className="text-xs text-ink-400 mb-1">DM link — keep this one private</p>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => copy('dm', `${base}?key=${keys.dmKey}`)}
              >
                {copied === 'dm' ? '✓ Copied!' : '📋 Copy DM link'}
              </Button>
              <Button
                size="sm"
                title="Mint a new DM key — old DM links AND integration tokens stop working"
                disabled={rotating !== null}
                onClick={() => void rotate('dm')}
              >
                {rotating === 'dm' ? '…' : '♻︎ Regenerate'}
              </Button>
            </div>
          </div>
          <p className="text-xs text-ink-400">
            Regenerating kills every old copy of that link. The DM key is also the Bearer token for
            the integration API — rotate it and you must update the MCP server's{' '}
            <code>HEXCRAWL_TOKEN</code>, backup scripts, and any saved <code>?key=</code> URLs.
          </p>
        </div>
      )}
    </Section>
  );
}

function Backup({ campaignId }: { campaignId: string }) {
  return (
    <Section title="Backup">
      <p className="text-xs text-ink-400 mb-2">
        A full campaign archive (maps, content, images, log) as one JSON file. Restore it from the
        landing page as a new campaign with new invite links.
      </p>
      {/* Plain link: the DM seat cookie rides along and authorizes the download. */}
      <a
        href={`/api/campaigns/${campaignId}/export`}
        download
        className="block w-full rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-center text-sm text-ink-100 hover:border-brass-500 hover:text-brass-300"
      >
        ⬇ Download backup
      </a>
    </Section>
  );
}
