# Hex Crawl Web Application Architecture (Option C Stack)

## Overview
This document captures the solution architecture for the hex crawl web application using the Option C technology stack:

- **Frontend:** SvelteKit SPA with TypeScript and Vite.
- **Backend:** Elixir Phoenix application exposing a GraphQL API via Absinthe.
- **Realtime:** Phoenix Channels (WebSocket) for bidirectional DM/player sync.
- **Background Jobs:** Oban (PostgreSQL-backed) for long-running and resource-intensive work.
- **Database:** PostgreSQL for relational data.
- **Object Storage:** S3-compatible services (AWS S3, GCS, Azure Blob) with first-class support for MinIO in self-hosted environments.
- **Caching/Presence:** Redis for ephemeral session data, rate limiting, and realtime presence (optional but recommended).
- **Deployment:** Containerized workloads deployable to Kubernetes (with Helm) and docker-compose for development/local testing.

## Core Services

### 1. SvelteKit Frontend
- Entry points for Dungeon Masters (authenticated) and Players (link-based access).
- Uses MapLibre GL JS for map rendering with custom WebGL layers for hex overlays.
- Integrates with the Phoenix backend via GraphQL queries/mutations (Absinthe) and Phoenix Channels for realtime updates.
- Implements role-aware UI states: DM dashboards, collaborative editing, fog-of-war visualizations, nested map navigation, exploration history timeline.
- Handles resumable uploads (tus protocol) by requesting pre-signed URLs from the backend and streaming map/icon files directly to object storage.

### 2. Phoenix Backend (GraphQL + Channels)
- Phoenix/Absinthe GraphQL schema hosts campaign, map, hex, item, and history types.
- Phoenix Channels provide realtime topics per campaign and per map. Channels broadcast DM actions (explore hex, move players, add items) to subscribed players and co-DMs.
- Uses Guardian or Pow for authentication, issuing JWT access tokens for DMs. Player share links embed signed tokens stored in the `player_links` table.
- Context modules encapsulate business logic: Campaigns, Maps, Hexes, Items, History, Storage, Auth.

### 3. Oban Worker Service
- Runs within the Phoenix application with dedicated queues for asset ingestion, tiling, fog-of-war preprocessing, icon processing, and cleanup tasks.
- Supports concurrency control and retries for large map tiling (up to 16k x 16k) using libvips bindings via ImageMagick/FFI libraries.
- Publishes job status events to Phoenix Channels so DMs can monitor map processing progress.

### 4. Data Storage Layer
- PostgreSQL maintains normalized schema (see "Data Model" section).
- Object storage retains original uploads, generated tile pyramids (XYZ/quadkey), overlay assets, and custom icons.
- Redis caches GraphQL query results (short TTL), maintains channel presence, and backs rate-limiting policies.

## Detailed Feature Considerations

### Map Ingestion & Tiling Pipeline
1. DM uploads map via pre-signed direct upload.
2. Backend validates metadata (pixel dimensions, file type, hex size).
3. Oban job generates multi-resolution tile pyramid using libvips; persists tiles to object storage, storing references in `map_assets` table.
4. Hex grid geometry and optional vector overlays are computed and stored as GeoJSON for frontend consumption.
5. Parent-child map links store bounding boxes and scale ratios, enabling seamless transition between continent and regional maps.

### Realtime Collaboration
- Phoenix Channels topics: `campaign:<id>` for global events, `map:<map_id>` for map-specific updates.
- Payload filtering ensures players only receive data they are authorized to see (fog-of-war visibility, item distance rules).
- Presence tracking (Phoenix Presence backed by Redis) shows active DMs/assistants and connected player sessions.
- Channel events mirror GraphQL mutations so the SvelteKit client can optimistically update UI state.

### Fog-of-War & Visibility Logic
- Current player hex state cached in Redis for quick lookup.
- Visibility calculation uses axial coordinates: item visible if `distance(player_hex, item_hex) ≤ visibility_distance` (supporting ∞ for always visible).
- Explored hexes flagged in DB; player channel payload only contains explored geometry. History timeline logs events (`RevealHex`, `MovePlayers`, `ItemDiscovered`).
- Optional background jobs pre-render fog-of-war rasters for large maps to reduce client-side processing.

### Nested Map Navigation
- `maps` table includes `parent_map_id`, `parent_hex_region` (q/r ranges), and `scale_ratio` fields.
- Frontend displays breadcrumbs and minimap overlays. Clicking a parent hex can open a child map; returning shows aggregated exploration status.

### Icon Management
- DMs upload custom icons; backend validates file size/type and generates multiple resolutions via Oban job.
- Icons stored in object storage, referenced by `icon_assets` table, and served via CDN with signed URLs.

## GraphQL Schema Highlights
- **Queries**
  - `campaign(id)` – returns campaign details, maps, members, links.
  - `map(id)` – fetches map metadata, hex summaries, active player location.
  - `hex(mapId, q, r)` – returns hex info, items (filtered by visibility for players).
  - `explorationHistory(mapId, paging)` – timeline entries.
- **Mutations** (DM/assistant only)
  - `createMap`, `linkMap`, `startMapProcessing`.
  - `setPlayerLocation(mapId, hex)`.
  - `revealHexes(mapId, hexIds)`; `concealHexes`.
  - `createHexItem`, `updateHexItem`, `deleteHexItem`.
  - `generatePlayerLink`, `revokePlayerLink`.
- **Subscriptions**
  - `campaignEvents(campaignId)` – DM/admin view.
  - `playerMapEvents(mapId, token)` – filtered events for players.

## Data Model (Key Tables)
- `users`: DMs/assistants with auth credentials.
- `campaigns`: root entity; includes settings for default hex sizes and fog-of-war behavior.
- `campaign_members`: user role assignments per campaign.
- `player_links`: signed tokens, permissions, expiration.
- `maps`: metadata, hex sizing, parent-child relationships.
- `map_assets`: original upload path, tile set reference, status.
- `hexes`: axial coordinates, exploration flags, DM notes.
- `hex_items`: item details, icon reference, visibility distance.
- `exploration_events`: event log with payload JSONB for timeline replay.
- `icons`: custom icon metadata and storage paths.

## Deployment & DevOps

### Containerization
- Multi-stage Dockerfiles:
  - **Frontend:** Node 20 base image for build, Nginx (or Node adapter) for serving static assets.
  - **Backend:** Elixir/OTP release built via `mix release`; includes Oban worker runtime.
- Environment variables configure DB, Redis, object storage endpoints, JWT secrets.

### Kubernetes (Recommended Stack)
- **Ingress:** NGINX Ingress Controller with cert-manager for TLS management.
- **Secrets:** External Secrets Operator sourcing from cloud secret managers or sealed-secrets for GitOps.
- **PostgreSQL:** Managed service (RDS, Cloud SQL) or bitnami Helm chart for dev clusters.
- **Redis:** bitnami/redis chart for caching/presence.
- **Object Storage:** Use external S3/GCS or deploy MinIO operator for on-cluster hosting.
- **CI/CD:** GitHub Actions pipeline to build/push images, run tests (frontend + backend), apply migrations, and deploy via Helm.

### docker-compose (Local Development)
- Services: frontend, backend, postgres, redis, minio, mailhog.
- Backend container runs migrations and seeds, exposes GraphQL playground and channels at `localhost:4000`.
- Frontend dev server runs at `localhost:5173` proxying API requests.
- MinIO console available for inspecting uploaded assets.

### Observability
- **Metrics:** Prometheus (via kube-prometheus stack) scraping Phoenix telemetry and Oban metrics; Grafana dashboards for job durations, channel activity.
- **Logging:** JSON-structured logs shipped to Loki/ELK.
- **Tracing:** OpenTelemetry instrumentation in Phoenix and SvelteKit (via OTLP exporter) feeding Jaeger/Tempo.

## Security Considerations
- Enforce HTTPS everywhere with HSTS.
- Signed URLs for object storage access; player tokens scoped to campaign/map and short-lived.
- Role-based authorization enforced in Absinthe resolvers; guard channels with token verification.
- Rate limiting on map uploads and share link generation (Redis-based).
- Audit trail for DM actions stored in `exploration_events` and optionally replicated to long-term storage.

## Open Questions / Future Enhancements
- Should we support offline caching for players (service workers)?
- Consider integrating turn-based log exports (PDF, CSV) from exploration history.
- Potential for AI-assisted content suggestions (future iteration).
- Evaluate cost of precomputing fog-of-war rasters vs. dynamic on-demand generation once initial prototype is built.

