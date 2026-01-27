# Phase 3: Real-Time Infrastructure - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Connected users receive live updates via WebSocket with role-based filtering and reconnection support. The DM controls session lifecycle (start/pause/end) and can broadcast immediately or stage changes. Players see only what their role and the DM's filtering permits. Session events are logged for future replay.

</domain>

<decisions>
## Implementation Decisions

### Update granularity
- DM has two broadcast modes: **immediate** (every action pushes instantly) and **staged** (changes queue up, DM publishes when ready)
- DM can toggle between immediate and staged modes
- In staged mode, DM sees a **detailed change list** showing each pending change (e.g., "Reveal hex 3,5", "Move token to 2,4") with ability to undo individual items before publishing
- In staged mode, players see a **subtle "DM is preparing..." indicator** so they know something is coming
- Delta vs full-state delivery: Claude's discretion (pick what works best technically)

### Connection feedback
- **Disconnection:** Persistent banner at top: "Connection lost. Reconnecting..." — dismisses on reconnect
- **Reconnection:** Automatic and silent — retries in the background, banner shows status
- **Player presence:** DM sees a player presence list on the campaign dashboard sidebar
- **Disconnected player tokens:** Unconnected players' tokens on the map appear **dimmed** — both for the DM and other players
- Presence list shows online/offline status per player

### Role-filtered updates
- **DM fog overlay:** Unrevealed hexes show a semi-transparent overlay on the DM's map — DM can see terrain underneath but knows what players can't see
- **Fog opacity:** Configurable in DM preferences (percentage setting)
- **Reveal confirmation:** When DM reveals a hex, the hex briefly flashes/animates to confirm the broadcast
- **Per-player filtering:** The system supports different updates for different players — e.g., if 2 players are at hex A and 2 at hex B, DM can reveal hexes specific to each group's location
- **Reveal targeting:** DM can choose per-reveal: broadcast to all players, select specific players, or proximity-based (auto-reveal to players whose tokens are within N hexes)
- Players do NOT see other players' activity in real time (beyond tokens, which is Phase 5), except for dimmed tokens of disconnected players

### Session lifecycle
- **DM explicitly starts a session** — players see "waiting for DM" until session begins
- **Pause/resume:** DM can pause a session — players see a grey screen overlay with "Session paused" notification. Players stay connected. Display updates when DM resumes.
- **End session:** When DM ends a session, players get a **frozen map view** — read-only, can look around, but no live updates
- **Outside sessions:** Players can **always access the map in read-only mode** to review revealed hexes, even without a live session
- **Session log:** Record timestamps, token movement, and revealed hexes/information per session. This data will be used in the future to generate a "replay" of a session showing how the party moved around.

### Claude's Discretion
- Delta vs full-state update strategy (whatever works best technically)
- WebSocket library/protocol choice
- Reconnection retry timing and backoff strategy
- Exact animation for reveal confirmation flash
- Session log storage format and schema

</decisions>

<specifics>
## Specific Ideas

- Dimmed tokens for disconnected players — applies everywhere tokens appear (map for all users, presence list for DM)
- "DM is preparing..." indicator should be subtle — don't distract from gameplay
- Session replay from logged data is a future feature — for now just capture the event log
- Per-player reveal filtering is critical for split-party scenarios (common in hex crawl exploration)
- DM fog overlay opacity preference — let DM tune this to their display/preference

</specifics>

<deferred>
## Deferred Ideas

- Session replay visualization (play back token movement and reveals) — future phase, but event logging happens now to enable it
- Player-to-player real-time interactions beyond token presence — future consideration

</deferred>

---

*Phase: 03-real-time-infrastructure*
*Context gathered: 2026-01-27*
