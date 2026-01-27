# Phase 2: Server & Authentication - Context

**Gathered:** 2026-01-27
**Status:** Ready for execution (plans already created)

<domain>
## Phase Boundary

Users create accounts, log in, and DMs create campaigns and invite players. All campaign data persists in PostgreSQL across browser sessions. Technical stack is decided: Hono, Better Auth, Drizzle ORM, PostgreSQL.

</domain>

<decisions>
## Implementation Decisions

### Login/Signup UX
- Signup form: name, email, password (3 fields)
- Auth errors displayed inline under the relevant input field
- Include a basic "forgot password" link using Better Auth's built-in password reset flow

### Claude's Discretion: Login/Signup
- Page switching approach (toggle on same page vs separate views)

### Campaign Management
- Campaign creation via modal dialog overlay on top of campaign list
- "Enter Map" does a full screen transition to the hex map with a back button to return to campaign dashboard

### Claude's Discretion: Campaign Management
- Campaign list layout (cards vs list vs other)
- Campaign dashboard content and layout

### Invitation Flow
- After accepting an invitation, player stays on campaign list (campaign appears with "Player" badge)
- DM sees a toast/flash message after sending an invitation ("Invitation sent to player@email.com")
- DM can see status of sent invitations in the campaign dashboard (pending/accepted/declined list)

### Claude's Discretion: Invitation Flow
- How pending invitations are displayed to the player after login (banner, notification, etc.)

</decisions>

<specifics>
## Specific Ideas

- The "Enter Map" button should lead to the existing Phase 1 hex map, with a clear way to navigate back to the campaign dashboard
- Toast messages for invite confirmation should auto-dismiss after a few seconds
- Invitation status tracking in the dashboard helps DMs know who hasn't responded yet

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 02-server-authentication*
*Context gathered: 2026-01-27*
