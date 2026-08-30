import type {
  CampaignState,
  Content,
  ContentPlayerView,
  FogState,
  SeatRole,
  Token,
} from '../domain.js';
import { isFullContent } from '../domain.js';
import { hexKey } from '../hex/coords.js';

export interface Viewer {
  seatId: string;
  role: SeatRole;
  characterId: string | null;
}

/**
 * Project the full campaign state down to what one seat is allowed to see.
 * This is THE security boundary: everything sent to a player client passes
 * through here (or through the equivalent per-event filters that follow the
 * same rules). Pure function; unit-tested.
 */
export function filterStateForViewer(full: CampaignState, viewer: Viewer): CampaignState {
  if (viewer.role === 'dm') return full;

  const mapState = full.mapState;
  const filteredMapState = mapState
    ? (() => {
        const fogByKey = new Map<string, FogState>();
        for (const f of mapState.fog) fogByKey.set(hexKey(f.q, f.r), f.state);
        const fogAt = (q: number, r: number): FogState => fogByKey.get(hexKey(q, r)) ?? 'hidden';

        return {
          imageLayers: mapState.imageLayers.filter((l) => !l.dmOnly && l.visible),
          hexes: mapState.hexes.filter((h) => fogAt(h.q, h.r) !== 'hidden'),
          fog: mapState.fog.filter((f) => f.state !== 'hidden'),
          tokens: mapState.tokens.filter((t) => tokenVisibleToPlayers(t, fogAt(t.q, t.r))),
          markers: mapState.markers.filter((m) => !m.dmOnly && fogAt(m.q, m.r) !== 'hidden'),
          contents: mapState.contents
            .filter(isFullContent)
            .map((c) => contentPlayerView(c, viewer.characterId, full))
            .filter((v): v is ContentPlayerView => v !== null),
          pendingMoves: mapState.pendingMoves,
        };
      })()
    : null;

  return {
    campaign: full.campaign,
    seats: full.seats,
    characters: full.characters,
    maps: full.maps,
    mapState: filteredMapState,
    discoveries: viewer.characterId
      ? full.discoveries.filter((d) => d.characterId === viewer.characterId)
      : [],
    encounterTables: [],
    log: full.log.filter((e) => e.visibility === 'all' || e.visibility === viewer.seatId),
  };
}

export function tokenVisibleToPlayers(token: Token, fogAtToken: FogState): boolean {
  if (token.kind === 'pc') return true;
  // Dynamic entities only exist where the party can currently see.
  return token.playerVisible && fogAtToken === 'visible';
}

/**
 * A player's view of a content entry: present only if their character has
 * discovered at least one clue; carries only discovered clue texts.
 */
export function contentPlayerView(
  content: Content,
  characterId: string | null,
  full: CampaignState,
): ContentPlayerView | null {
  if (!characterId) return null;
  const clueIds = new Set(content.clues.map((c) => c.id));
  const mine = full.discoveries.filter(
    (d) => d.characterId === characterId && clueIds.has(d.clueId),
  );
  if (mine.length === 0) return null;
  const clueText = new Map(content.clues.map((c) => [c.id, c.text]));
  return {
    id: content.id,
    mapId: content.mapId,
    q: content.q,
    r: content.r,
    type: content.type,
    title: content.title,
    glyph: content.glyph,
    showLabel: content.showLabel,
    scaleVisibility: content.scaleVisibility,
    wikiPage: content.wikiPage,
    discoveredClues: mine
      .sort((a, b) => a.at - b.at)
      .map((d) => ({ clueId: d.clueId, text: clueText.get(d.clueId) ?? '', at: d.at })),
  };
}
