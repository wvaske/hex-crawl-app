import React, { useEffect, useState } from 'react';
import {
  CONTENT_TYPE_GLYPHS,
  compassDirection,
  describeGate,
  formatClock,
  formatDuration,
  formatRelativeGameTime,
  isFullContent,
  minutesOnCurrentHex,
  type Content,
  type ContentPlayerView,
  type HexOrientation,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { fetchWikiPage } from '../api.js';
import { Button, Dialog, EmptyNote, Section, cx } from '../ui/kit.js';
import { wikiHref } from './panels/InspectTab.js';

/**
 * The "More" dialog for a location (#66): everything the app knows about one
 * content pin — clues appropriate to the viewer, tokens on the hex, trails,
 * when the party was last here — plus its wiki page rendered inline.
 *
 * Opened from the DM pin popup and from the Inspect content cards; the pin
 * popup and the cards stay deliberately small.
 */
export function LocationDialog({ campaignId }: { campaignId: string }) {
  const contentId = useUi((s) => s.locationDialogContentId);
  const setUi = useUi((s) => s.set);
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  const map = activeMap(state);
  const close = () => setUi('locationDialogContentId', null);

  const content = state?.mapState?.contents.find((c) => c.id === contentId) ?? null;
  // The pin can vanish under the dialog (deleted, disabled, fogged out).
  useEffect(() => {
    if (contentId && state && !content) close();
  }, [contentId, content, state]);
  if (!content || !state?.mapState) return null;

  const isDm = role === 'dm';
  const full = isFullContent(content) ? content : null;
  const wikiBase = state.campaign.settings.wikiBaseUrl ?? '';
  const tokens = state.mapState.tokens.filter((t) => t.q === content.q && t.r === content.r);
  const visit = state.mapState.visits.find((v) => v.q === content.q && v.r === content.r) ?? null;
  const now = state.campaign.time.minutes;
  // Lingering time is credited to a hex when the party leaves it, so the
  // current hex's total is still running.
  const partyHex = state.campaign.time.partyHex;
  const here =
    !!partyHex &&
    partyHex.mapId === content.mapId &&
    partyHex.q === content.q &&
    partyHex.r === content.r;

  return (
    <Dialog
      title={`${content.glyph || CONTENT_TYPE_GLYPHS[content.type]} ${content.title}`}
      onClose={close}
      wide
    >
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap text-xs text-ink-400 -mt-1 mb-3">
          <span className="capitalize text-ink-300">{content.type}</span>
          <span>
            hex {content.q}, {content.r}
          </span>
          {full && !full.enabled && (
            <span className="text-ember-500" title="Disabled: doesn't exist for players yet">
              disabled
            </span>
          )}
          {full?.knownLocation && (
            <span className="text-brass-300" title="Players always see this pin">
              known location
            </span>
          )}
          {full?.quest && <span>quest: {full.quest}</span>}
          {content.wikiPage && (
            <a
              className="text-arcane-500 hover:text-ink-100 ml-auto"
              href={wikiHref(content.wikiPage, wikiBase)}
              target="_blank"
              rel="noreferrer"
              title={`Open ${content.wikiPage} on the wiki`}
            >
              wiki ↗
            </a>
          )}
          {isDm && (
            <Button
              size="sm"
              variant="ghost"
              className={content.wikiPage ? '' : 'ml-auto'}
              onClick={() => {
                setUi('contentDialogHex', { q: content.q, r: content.r });
                setUi('editingContentId', content.id);
                close();
              }}
            >
              Edit
            </Button>
          )}
        </div>

        <Section title="Last visited">
          {visit ? (
            <div className="text-sm text-ink-100">
              <p>
                {formatClock(visit.lastArrived)}{' '}
                <span className="text-ink-400">
                  — {here ? 'the party is here now' : formatRelativeGameTime(visit.lastArrived, now)}
                </span>
              </p>
              <p className="text-xs text-ink-400 mt-0.5">
                First arrived {formatClock(visit.firstArrived)} ·{' '}
                {(() => {
                  const spent =
                    visit.totalMinutes + (here ? minutesOnCurrentHex(state.campaign.time) : 0);
                  return spent > 0 ? `${formatDuration(spent)} spent here` : 'passed straight through';
                })()}
              </p>
            </div>
          ) : (
            <EmptyNote>The party has never been here.</EmptyNote>
          )}
        </Section>

        {full ? (
          <DmDetails content={full} />
        ) : (
          <PlayerDetails content={content as ContentPlayerView} />
        )}

        {tokens.length > 0 && (
          <Section title="On this hex">
            <ul className="space-y-1">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm text-ink-100">
                  <span
                    className="w-3.5 h-3.5 rounded-full inline-block border border-white/40 shrink-0"
                    style={{ background: t.color }}
                  />
                  <span className="truncate">{t.label || '(unnamed)'}</span>
                  <span className="text-xs text-ink-400">{t.kind.toUpperCase()}</span>
                  {isDm && !t.playerVisible && t.kind === 'npc' && (
                    <span className="text-xs text-ember-500">hidden</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <TrailLines q={content.q} r={content.r} isDm={isDm} orientation={map?.orientation ?? 'flat'} />

        <WikiPanel campaignId={campaignId} page={content.wikiPage} isDm={isDm} />
      </div>
    </Dialog>
  );
}

/** DM view of the clues: every clue, its gate, and who knows it. */
function DmDetails({ content }: { content: Content }) {
  const state = useSession((s) => s.state);
  const discoveries = state?.discoveries ?? [];
  const characters = state?.characters ?? [];
  return (
    <>
      {content.dmNotes && (
        <Section title="DM notes">
          <p className="text-sm text-ink-200 whitespace-pre-wrap">{content.dmNotes}</p>
        </Section>
      )}
      <Section title="Clues">
        {content.clues.length === 0 && <EmptyNote>No clues — only you can see this.</EmptyNote>}
        <ul className="space-y-2">
          {content.clues.map((clue) => {
            const known = discoveries.filter((d) => d.clueId === clue.id);
            return (
              <li key={clue.id} className="bg-ink-900 border border-ink-700 rounded-lg p-2">
                <p className="text-sm text-ink-100">{clue.text}</p>
                <p className="text-xs text-ink-400 mt-0.5">{describeGate(clue.gate)}</p>
                <div className="flex items-center gap-1 flex-wrap mt-1.5">
                  {characters.map((ch) => {
                    const d = known.find((k) => k.characterId === ch.id);
                    return d ? (
                      <span
                        key={ch.id}
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-ink-950 cursor-pointer"
                        style={{ background: ch.color }}
                        title="Knows this — click to revoke"
                        onClick={() => send({ kind: 'discovery.revoke', discoveryId: d.id })}
                      >
                        {ch.name} ✓
                      </span>
                    ) : (
                      <span
                        key={ch.id}
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-dashed cursor-pointer text-ink-300 hover:text-ink-100"
                        style={{ borderColor: ch.color }}
                        title={`Doesn't know yet — click to reveal to ${ch.name}`}
                        onClick={() =>
                          send({ kind: 'clue.reveal', clueId: clue.id, characterIds: [ch.id] })
                        }
                      >
                        {ch.name}
                      </span>
                    );
                  })}
                  <button
                    className="text-[10px] text-brass-400 hover:text-brass-300 cursor-pointer px-1"
                    onClick={() => send({ kind: 'clue.reveal', clueId: clue.id, characterIds: [] })}
                    title="Reveal to everyone"
                  >
                    Reveal to all
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

/** Player view: only the clues their own character has actually learned. */
function PlayerDetails({ content }: { content: ContentPlayerView }) {
  return (
    <Section title="What you know">
      {content.discoveredClues.length === 0 && (
        <EmptyNote>You know where this is, nothing more.</EmptyNote>
      )}
      <ul className="space-y-1.5">
        {content.discoveredClues.map((c) => (
          <li key={c.clueId} className="text-sm text-ink-200 flex items-start gap-2">
            <span className="flex-1">{c.text}</span>
            <button
              className="shrink-0 text-[10px] text-brass-400 hover:text-brass-300 cursor-pointer"
              title="Tell the party — everyone learns this clue"
              onClick={() => send({ kind: 'clue.share', clueId: c.clueId })}
            >
              🤝 Share
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Trails crossing this hex (DM) or the signs the character found (player). */
function TrailLines({
  q,
  r,
  isDm,
  orientation,
}: {
  q: number;
  r: number;
  isDm: boolean;
  orientation: HexOrientation;
}) {
  const state = useSession((s) => s.state);
  const ms = state?.mapState;
  if (!ms) return null;

  if (!isDm) {
    const signs = ms.trailSigns.filter((s) => s.q === q && s.r === r);
    if (signs.length === 0) return null;
    return (
      <Section title="Tracks">
        <ul className="space-y-1 text-sm text-ink-200">
          {signs.map((s, i) => (
            <li key={i}>
              {s.glyph}{' '}
              {s.forward ? `The trail continues to the ${s.forward}` : 'The trail ends here'}
              {s.backward && <span className="text-ink-400"> · back-trail {s.backward}</span>}
            </li>
          ))}
        </ul>
      </Section>
    );
  }

  const crossing = ms.trails
    .map((t) => ({ trail: t, idx: t.cells.findIndex((c) => c.q === q && c.r === r) }))
    .filter((x) => x.idx >= 0);
  if (crossing.length === 0) return null;
  return (
    <Section title="Trails here">
      <ul className="space-y-1 text-sm text-ink-200">
        {crossing.map(({ trail, idx }) => {
          const next = trail.cells[idx + 1];
          const prev = trail.cells[idx - 1];
          return (
            <li key={trail.id}>
              {trail.glyph} <span className="font-medium">{trail.name}</span>
              <span className="text-xs text-ink-400">
                {' '}
                · cell {idx + 1}/{trail.cells.length}
                {next && ` · onward ${compassDirection({ q, r }, next, orientation)}`}
                {prev && ` · back ${compassDirection({ q, r }, prev, orientation)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * Section headings the app looks for on a location page (docs/WIKI-TEMPLATE.md).
 * Anything else is only shown behind "show full page".
 */
const SUMMARY_HEADINGS = ['overview', 'what the party knows'];
/**
 * Headings a player's view drops. This is a courtesy, NOT security: the wiki
 * page is readable by anyone who can open the wiki, so DM secrets must not be
 * on a page players are pointed at in the first place (see the docs).
 */
const DM_ONLY_HEADINGS = /^(dm notes?|dm only|secrets?|behind the screen)$/i;

interface WikiSection {
  heading: string;
  /** 2 or 3 — the wiki heading level this section started at. */
  level: number;
  html: string;
}

/**
 * Split parsed MediaWiki HTML at its headings. Both h2 and h3 count as section
 * starts: real pages nest the interesting headings ("Overview") one level under
 * a page-title h2 as often as not. Resilient by design — a page with no
 * headings comes back as one untitled section, which the panel renders whole.
 */
function splitSections(html: string): WikiSection[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.mw-parser-output') ?? doc.body;
  const sections: WikiSection[] = [{ heading: '', level: 0, html: '' }];
  for (const node of Array.from(root.children)) {
    // Modern MediaWiki wraps headings in <div class="mw-heading mw-heading2">;
    // older output emits the heading element directly. The table of contents
    // also contains an h2, so skip anything inside it.
    if (node.id === 'toc' || node.classList.contains('toc')) continue;
    const heading =
      node.tagName === 'H2' || node.tagName === 'H3'
        ? node
        : node.querySelector(':scope > h2, :scope > h3');
    if (heading) {
      sections.push({
        heading: (heading.textContent ?? '').replace(/\[edit\]\s*$/i, '').trim(),
        level: heading.tagName === 'H2' ? 2 : 3,
        html: '',
      });
      continue;
    }
    sections[sections.length - 1]!.html += node.outerHTML;
  }
  return sections.filter((s) => s.heading || s.html.trim());
}

function renderSections(sections: WikiSection[]): string {
  return sections
    .map((s) => {
      if (!s.heading) return s.html;
      const tag = s.level === 2 ? 'h3' : 'h4';
      return `<${tag}>${escapeText(s.heading)}</${tag}>${s.html}`;
    })
    .join('');
}

function escapeText(s: string): string {
  return s.replace(/[<>&]/g, (ch) => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;'));
}

/** The wiki page itself, fetched through the server proxy. */
function WikiPanel({
  campaignId,
  page,
  isDm,
}: {
  campaignId: string;
  page: string;
  isDm: boolean;
}) {
  const wikiBase = useSession((s) => s.state?.campaign.settings.wikiBaseUrl ?? '');
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFull, setShowFull] = useState(false);
  // A wikiPage holding a full URL is a plain link, not something to proxy.
  const proxyable = Boolean(page) && !/^[a-z]+:\/\//i.test(page) && Boolean(wikiBase);

  useEffect(() => {
    if (!proxyable) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
    fetchWikiPage(campaignId, page)
      .then((res) => {
        if (!cancelled) setHtml(res.html);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the page');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, page, proxyable]);

  if (!page) return null;

  const sections = html ? splitSections(html) : [];
  const visible = isDm ? sections : sections.filter((s) => !DM_ONLY_HEADINGS.test(s.heading));
  // The page's opening (lead paragraph, infobox) always shows; the template
  // sections join it. Trimming only kicks in when a template section was
  // actually found AND something would be hidden — an arbitrary page renders
  // whole, with no toggle.
  const isSummary = (s: WikiSection) => SUMMARY_HEADINGS.includes(s.heading.toLowerCase());
  const summary = visible.filter((s, i) => i === 0 || !s.heading || isSummary(s));
  const trimmable = visible.some(isSummary) && summary.length < visible.length;
  const shown = trimmable && !showFull ? summary : visible;

  return (
    <Section
      title="From the wiki"
      actions={
        trimmable ? (
          <Button size="sm" variant="ghost" onClick={() => setShowFull(!showFull)}>
            {showFull ? 'Show key sections' : 'Show full page'}
          </Button>
        ) : undefined
      }
    >
      {!proxyable && (
        <EmptyNote>
          {wikiBase ? (
            <a
              className="text-arcane-500 hover:text-ink-100"
              href={wikiHref(page, wikiBase)}
              target="_blank"
              rel="noreferrer"
            >
              Open {page} ↗
            </a>
          ) : (
            'No wiki configured for this campaign.'
          )}
        </EmptyNote>
      )}
      {loading && <p className="text-sm text-ink-400 animate-pulse py-2">Loading {page}…</p>}
      {error && (
        <p className="text-sm text-ink-400 py-2">
          {error}{' '}
          <a
            className="text-arcane-500 hover:text-ink-100"
            href={wikiHref(page, wikiBase)}
            target="_blank"
            rel="noreferrer"
          >
            Open on the wiki ↗
          </a>
        </p>
      )}
      {html && (
        <div
          className={cx(
            'wiki-content max-h-96 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-3',
            'text-sm text-ink-200',
          )}
          // The server sanitizes this HTML (strips script/style/handlers and
          // javascript: URLs — packages/server/src/http/wiki.ts) before it
          // reaches the client; the wiki itself is semi-trusted content
          // authored by the DM's own table.
          dangerouslySetInnerHTML={{ __html: renderSections(shown) }}
        />
      )}
    </Section>
  );
}
