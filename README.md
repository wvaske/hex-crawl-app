# Hex Crawl Web Application

This repository contains a prototype implementation of the hex crawl platform described in `docs/architecture.md`.
It ships both the Phoenix/Absinthe backend and the SvelteKit frontend, together with docker-compose assets for
local development.

## Repository Layout

- `backend/` – Phoenix application exposing the GraphQL API, Phoenix Channels, and Oban job worker definitions.
- `frontend/` – SvelteKit SPA that renders DM and player experiences powered by MapLibre and Phoenix WebSocket clients.
- `docs/` – Architecture documentation.
- `docker-compose.yml` – Local orchestration for Postgres, Redis, MinIO, backend, and frontend containers.

## Getting Started

### Prerequisites

- Elixir 1.15 and Erlang/OTP 26
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- A MinIO or S3-compatible object storage endpoint (the compose stack provides MinIO automatically)

### Local Development (without Docker)

1. Install backend dependencies:
   ```bash
   cd backend
   mix deps.get
   mix ecto.create
   mix ecto.migrate
   mix phx.server
   ```

2. Install frontend dependencies:
   ```bash
   cd ../frontend
   npm install
   npm run dev -- --host
   ```

3. Open the DM console at [http://localhost:5173/dm](http://localhost:5173/dm). Player links can load maps at
   `/player/<map-id>`.

### docker-compose

The included `docker-compose.yml` provisions the full stack:

```bash
docker compose up --build
```

The services expose:

- Backend GraphQL API at `http://localhost:4000/api/graphql`
- Phoenix Channels at `ws://localhost:4000/socket`
- Frontend SPA at `http://localhost:5173`
- MinIO console at `http://localhost:9001`

### Environment Variables

Key settings are surfaced as environment variables for container and local use:

- `DATABASE_URL` – PostgreSQL connection string.
- `SECRET_KEY_BASE` – Phoenix secret used for session signing.
- `STORAGE_*` – Object storage connection details for map and icon uploads.
- `VITE_GRAPHQL_URL` / `VITE_SOCKET_URL` – Frontend endpoints for the API and realtime layer.

## Tests & Tooling

The project currently focuses on delivering the feature-complete prototype; automated tests are not yet implemented.
Running `mix test` and `npm run test` are recommended additions when extending the platform.

## Known Limitations

- The backend ships with in-memory state seeded at runtime rather than a persistent Postgres implementation.
- Background map tiling jobs simulate progress events but do not perform real image processing.
- Authentication is stubbed for demonstration purposes.
- Because outbound internet access is restricted in this environment, dependency installation commands may require
  mirrored package registries.

## Contributing

1. Fork and clone the repository.
2. Make your changes in a feature branch.
3. Ensure `mix format` and `npm run lint` (or `svelte-check`) pass locally.
4. Submit a pull request summarizing your changes.
