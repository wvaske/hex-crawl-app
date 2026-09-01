import type {
  CampaignState,
  Content,
  ContentPlayerView,
  Discovery,
  FogState,
  LogEntry,
  SeatRole,
  Sense,
  Token,
  TrailSign,
} from '../domain.js';
import { isFullContent } from '../domain.js';
import { hexDistance, hexKey, hexRange } from '../hex/coords.js';
import { bearingAngle, compassDirection, withDirection } from '../hex/direction.js';
import type { HexOrientation } from '../hex/layout.js';

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
  if (viewer.role === 'dm') return { ...full, senses: [] };

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
          // Trail definitions never reach players; only discovered signs do.
          trails: [],
          trailSigns: computeTrailSigns(full, viewer.characterId),
          // The party's own travel history (#66): where they've been, when
          // they last arrived, and how long they lingered — no DM-only data
          // rides along (q/r + clock minutes only). Gated on fog so a hex the
          // DM has re-hidden doesn't come back as a visit record.
          visits: mapState.visits.filter((v) => fogAt(v.q, v.r) !== 'hidden'),
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
    trailDiscoveries: viewer.characterId
      ? full.trailDiscoveries.filter((d) => d.characterId === viewer.characterId)
      : [],
    senses: computeSenses(full, viewer.characterId),
    encounterTables: [],
    log: full.log.filter((e) => logEntryVisibleToPlayer(e, viewer)),
  };
}

/**
 * A player's log shows their own character's actions, not the whole party's:
 * 'all'-visibility roll entries reach only viewers whose character rolled.
 * Other 'all' entries (narration, shares) reach everyone.
 */
export function logEntryVisibleToPlayer(e: LogEntry, viewer: Viewer): boolean {
  if (e.visibility === viewer.seatId) return true;
  if (e.visibility !== 'all') return false;
  if (e.kind === 'check') {
    const results = (e.data as { results?: unknown }).results;
    if (Array.isArray(results)) {
      return (
        viewer.characterId !== null &&
        results.some(
          (r) => (r as { characterId?: string } | null)?.characterId === viewer.characterId,
        )
      );
    }
  }
  return true;
}

/**
 * Signs for the trail cells the viewer's character has walked or spotted:
 * the cell, its glyph, and the bearings onward and back — never the rest
 * of the path.
 */
function computeTrailSigns(full: CampaignState, characterId: string | null): TrailSign[] {
  const mapState = full.mapState;
  if (!mapState || !characterId || mapState.trails.length === 0) return [];
  const orientation: HexOrientation =
    full.maps.find((m) => m.id === full.campaign.activeMapId)?.orientation ?? 'flat';
  const mine = full.trailDiscoveries.filter((d) => d.characterId === characterId);
  if (mine.length === 0) return [];
  const trails = new Map(mapState.trails.map((t) => [t.id, t]));

  const signs: TrailSign[] = [];
  const seen = new Set<string>();
  for (const d of mine) {
    const trail = trails.get(d.trailId);
    if (!trail) continue;
    const cell = trail.cells[d.cellIndex];
    if (!cell) continue;
    const key = `${d.trailId}|${d.cellIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const next = trail.cells[d.cellIndex + 1] ?? null;
    const prev = trail.cells[d.cellIndex - 1] ?? null;
    signs.push({
      trailId: d.trailId,
      q: cell.q,
      r: cell.r,
      glyph: trail.glyph,
      forward: next ? compassDirection(cell, next, orientation) : null,
      backward: prev ? compassDirection(cell, prev, orientation) : null,
      forwardAngle: next ? bearingAngle(cell, next, orientation) : null,
      backwardAngle: prev ? bearingAngle(cell, prev, orientation) : null,
    });
  }
  return signs;
}

export function tokenVisibleToPlayers(token: Token, fogAtToken: FogState): boolean {
  if (token.kind === 'pc') return true;
  // Dynamic entities only exist where the party can currently see.
  return token.playerVisible && fogAtToken === 'visible';
}

/**
 * Does this discovery pin down the source's location? Discoveries made on
 * the hex itself (or DM-revealed) do; sensing something from afar does not —
 * those clues live in the senses panel until the character actually reaches
 * the place, which upgrades the discovery.
 */
export function discoveryLocates(d: Discovery): boolean {
  return d.locates;
}

/**
 * A player's view of a content entry: present only once their character has
 * LOCATED it (not merely sensed a clue from afar); carries discovered clues.
 */
export function contentPlayerView(
  content: Content,
  characterId: string | null,
  full: CampaignState,
): ContentPlayerView | null {
  if (!characterId || !content.enabled) return null;
  const clueIds = new Set(content.clues.map((c) => c.id));
  const mine = full.discoveries.filter(
    (d) => d.characterId === characterId && clueIds.has(d.clueId),
  );
  // Common-knowledge places show their pin with whatever clues (possibly
  // none) the character has actually learned.
  if (!content.knownLocation && !mine.some(discoveryLocates)) return null;
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
      .map((d) => ({
        clueId: d.clueId,
        text: withDirection(clueText.get(d.clueId) ?? '', d.direction),
        at: d.at,
      })),
  };
}

/**
 * The character's sensed clues on the viewed map: every discovered clue with
 * a live bearing while in range, plus the visited hexes it can be sensed
 * from (for triangulation). Never leaks the source hex of unlocated content.
 */
function computeSenses(full: CampaignState, characterId: string | null): Sense[] {
  const mapState = full.mapState;
  if (!mapState || !characterId) return [];
  const mine = new Map(
    full.discoveries.filter((d) => d.characterId === characterId).map((d) => [d.clueId, d]),
  );
  if (mine.size === 0) return [];

  const orientation: HexOrientation =
    full.maps.find((m) => m.id === full.campaign.activeMapId)?.orientation ?? 'flat';
  const myToken = mapState.tokens.find((t) => t.kind === 'pc' && t.characterId === characterId);
  // Hexes the party has actually been to: the explored trail plus wherever
  // the character stands right now. Merely-visible cells (e.g. a map opened
  // up wholesale by the DM) don't count — you can't triangulate from a hex
  // you never walked.
  const visited = new Set(
    mapState.fog.filter((f) => f.state === 'explored').map((f) => hexKey(f.q, f.r)),
  );
  if (myToken) visited.add(hexKey(myToken.q, myToken.r));

  const senses: Sense[] = [];
  for (const content of mapState.contents) {
    if (!isFullContent(content) || !content.enabled) continue;
    const located =
      content.knownLocation ||
      content.clues.some((clue) => {
        const d = mine.get(clue.id);
        return d ? discoveryLocates(d) : false;
      });
    for (const clue of content.clues) {
      const d = mine.get(clue.id);
      if (!d) continue;
      const src = { q: content.q, r: content.r };
      const radius = clue.gate.kind === 'skill' ? clue.gate.maxDistance : 0;
      const here = myToken ? { q: myToken.q, r: myToken.r } : null;
      const inRange = here ? hexDistance(here, src) <= radius : false;
      const liveDirection =
        inRange && here && clue.indicatesDirection
          ? compassDirection(here, src, orientation)
          : null;
      senses.push({
        clueId: clue.id,
        text: clue.text,
        direction: liveDirection ?? d.direction,
        inRange,
        at: d.at,
        observableFrom: hexRange(src, radius).filter((c) => visited.has(hexKey(c.q, c.r))),
        located,
        contentTitle: located ? content.title : null,
      });
    }
  }
  return senses.sort((a, b) => Number(b.inRange) - Number(a.inRange) || b.at - a.at);
}
