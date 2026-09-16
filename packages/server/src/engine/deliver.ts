import type { CampaignRuntime } from '../state/runtime.js';
import type { Hub } from '../ws/hub.js';
import type { NewDiscovery } from './knowledge.js';

/**
 * Deliver freshly-created discoveries: a journal entry for the owning
 * player(s), an entry in the DM feed, and a live `discovery.new` event so open
 * clients toast it. EVERY path that calls `evaluateKnowledge` must hand its
 * result here — a discovery that is only written to the table is invisible:
 * the player's senses list grows silently, with no journal line and no toast
 * (the bug behind AI-added locations "not showing up" for players).
 */
export function deliverDiscoveries(
  runtime: CampaignRuntime,
  hub: Hub,
  discoveries: NewDiscovery[],
): void {
  for (const d of discoveries) {
    const character = runtime.characters.get(d.discovery.characterId);
    const ownerSeats = [...runtime.seats.values()]
      .filter((s) => s.characterId === d.discovery.characterId)
      .map((s) => s.id);
    const how = d.discovery.how;
    const howText =
      how.kind === 'passive'
        ? `passive ${how.skill} ${how.passive} vs DC ${how.dc} at ${how.distance} hex${how.distance === 1 ? '' : 'es'}`
        : how.kind === 'roll'
          ? `rolled ${how.skill} ${how.total} (d20 ${how.roll}${how.modifier >= 0 ? '+' : ''}${how.modifier}) vs DC ${how.dc}`
          : how.kind;
    runtime.appendLog(
      'discovery',
      `${d.characterName} discovered "${d.contentTitle}": ${d.clueText} (${howText})`,
      'dm',
      { contentId: d.contentId, clueId: d.discovery.clueId, characterId: d.discovery.characterId },
    );
    for (const seatId of ownerSeats) {
      runtime.appendLog('discovery', `${character?.name ?? 'You'} noticed: ${d.clueText}`, seatId, {
        contentId: d.contentId,
      });
    }
    hub.sendTo(
      runtime,
      {
        type: 'event',
        kind: 'discovery.new',
        discovery: d.discovery,
        contentId: d.contentId,
        contentTitle: d.contentTitle,
        clueText: d.clueText,
        characterName: d.characterName,
      },
      { dm: true, seatIds: ownerSeats },
    );
  }
}
