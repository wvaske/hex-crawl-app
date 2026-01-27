---
phase: 02-server-authentication
plan: 04
subsystem: campaigns-invitations
tags: [hono, invitations, campaigns, ui, react, crud, role-based-access]

# Dependency graph
requires:
  - phase: 02-02-campaign-schema
    provides: campaign, campaignMember, invitation schema and campaign CRUD routes
  - phase: 02-03-client-auth
    provides: Better Auth React client, AuthGuard, login/signup pages
provides:
  - Invitation CRUD routes (create, list pending, accept, decline)
  - Campaign list UI with role badges (DM/Player)
  - Create campaign modal dialog
  - Campaign dashboard with invite player and enter map
  - Pending invitations UI with accept/decline
  - View-state navigation (campaigns | dashboard | map)
  - Vite proxy for API requests (avoids cross-origin port issues)
affects: [03-real-time, 04-fog-of-war]

# Tech tracking
tech-stack:
  added: []
  patterns: [Vite dev proxy with origin rewrite, view-state navigation via useState, role-based UI gating]

key-files:
  created:
    - packages/server/src/routes/invitations.ts
    - packages/client/src/components/campaigns/CampaignList.tsx
    - packages/client/src/components/campaigns/CreateCampaignDialog.tsx
    - packages/client/src/components/campaigns/CampaignDashboard.tsx
    - packages/client/src/components/campaigns/InvitePlayerDialog.tsx
    - packages/client/src/components/campaigns/PendingInvitations.tsx
  modified:
    - packages/server/src/app.ts
    - packages/client/src/App.tsx
    - packages/client/src/lib/api.ts
    - packages/client/src/lib/auth-client.ts
    - packages/client/vite.config.ts
    - packages/client/.env

key-decisions:
  - "Vite proxy with origin rewrite replaces direct cross-origin CORS for dev (port 3000 not accessible from user browser)"
  - "Invitations router mounted at /api with full paths inside (no conflict with /api/campaigns)"
  - "View-state navigation with useState enum (campaigns|dashboard|map) instead of router library"

patterns-established:
  - "Vite proxy: /api -> localhost:3000 with Origin header rewrite to localhost:5173"
  - "Role-based UI: check campaign membership role to show/hide DM controls"
  - "apiFetch helper with empty baseURL for same-origin proxy requests"

# Metrics
duration: 12min
completed: 2026-01-27
---

# Phase 2 Plan 04: Invitations & Campaign UI Summary

**Invitation routes and complete client UI for campaigns and invitations with role-based access**

## Performance

- **Duration:** 12 min (including checkpoint debugging)
- **Completed:** 2026-01-27
- **Tasks:** 3 (2 auto + 1 human checkpoint)
- **Files created:** 6
- **Files modified:** 6

## Accomplishments
- DM can create campaigns via modal dialog
- Campaign list shows all user's campaigns with DM/Player role badges
- DM can invite players by email from campaign dashboard
- Players see pending invitations and can accept/decline
- Accepted invitations add player to campaign with "Player" role
- Role enforcement: only DMs see invite controls, server validates DM role
- "Enter Map" transitions to hex map from Phase 1 with back navigation
- All campaign/invitation data persists in PostgreSQL

## Task Commits

1. **Task 1: Create invitation routes and mount on server** - `91fbad8` (feat)
2. **Task 2: Build client campaign and invitation UI** - `a8e5281` (feat)
3. **Task 3: Human checkpoint verification** - `964de4b` (fix - proxy)

## Files Created/Modified
- `packages/server/src/routes/invitations.ts` - Invitation CRUD: create (DM-only), list pending, accept, decline
- `packages/server/src/app.ts` - Mount invitations router at /api, added remote IP to CORS origins
- `packages/client/src/components/campaigns/CampaignList.tsx` - Campaign list with role badges and create button
- `packages/client/src/components/campaigns/CreateCampaignDialog.tsx` - Modal dialog for campaign creation
- `packages/client/src/components/campaigns/CampaignDashboard.tsx` - Dashboard with invite and enter map
- `packages/client/src/components/campaigns/InvitePlayerDialog.tsx` - Email invitation dialog (DM only)
- `packages/client/src/components/campaigns/PendingInvitations.tsx` - Pending invitations with accept/decline
- `packages/client/src/App.tsx` - View-state navigation (campaigns | dashboard | map)
- `packages/client/src/lib/api.ts` - API helper updated for proxy (empty baseURL)
- `packages/client/src/lib/auth-client.ts` - Auth client updated for proxy (empty baseURL)
- `packages/client/vite.config.ts` - Vite proxy /api -> localhost:3000 with origin rewrite
- `packages/client/.env` - Cleared VITE_API_URL (proxy handles routing)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Remote dev environment port inaccessibility**
- **Found during:** Task 3 (human checkpoint)
- **Issue:** User's browser at `http://100.106.183.12:5173` could not reach port 3000 directly. Fetch requests to `http://10.241.120.98:3000` hung indefinitely.
- **Fix:** Added Vite dev server proxy (`/api` -> `localhost:3000`) with origin header rewrite. All API requests now route through port 5173. Updated auth-client.ts and api.ts to use empty baseURL (same-origin).
- **Files modified:** `vite.config.ts`, `auth-client.ts`, `api.ts`, `.env`
- **Verification:** Signup, login, logout, campaigns, invitations all work through proxy
- **Committed in:** `964de4b`

**2. [Rule 1 - Auto-fix] Better Auth origin validation rejecting user's IP**
- **Found during:** Task 3 (human checkpoint)
- **Issue:** User's actual browser IP (`100.106.183.12`) differed from server's network IP (`10.241.120.98`). Better Auth rejected `Origin: http://100.106.183.12:5173` as untrusted.
- **Fix:** Vite proxy rewrites Origin header to `http://localhost:5173` (already in trustedOrigins) before forwarding to backend.
- **Files modified:** `vite.config.ts` (proxy configure callback)
- **Committed in:** `964de4b`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 auto-fix)
**Impact on plan:** Development approach changed from direct CORS to Vite proxy. No scope change. All functionality delivered as planned.

## Human Verification Results

Checkpoint passed. User verified:
- Account creation and login
- Campaign creation
- Player invitation by email
- Invitation acceptance (second account)
- Sign out and sign in flow
- Full end-to-end flow working

## Next Phase Readiness
- All AUTH requirements (AUTH-01 through AUTH-06) delivered
- Campaign and invitation persistence in PostgreSQL confirmed
- Phase 3 (Real-time) can add WebSocket connections to the campaign context
- Phase 4 (Fog of War) can layer visibility on the existing map + campaign model

---
*Phase: 02-server-authentication*
*Completed: 2026-01-27*
