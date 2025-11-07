# Hex Crawl Backend

This Phoenix application exposes the GraphQL API, Phoenix Channels realtime layer, and Oban job queues that
power the hex crawl experience. The current implementation keeps campaign state in memory for rapid prototyping
but mirrors the schema designed for a PostgreSQL persistence layer.

## Running Locally

```bash
mix deps.get
mix phx.server
```

By default the server boots on `http://localhost:4000` with the GraphQL endpoint at `/api/graphql` and the GraphiQL
playground at `/api/graphiql`.

## Key Folders

- `lib/backend/` – context modules for campaigns, storage, and background workers.
- `lib/backend_web/` – Phoenix endpoint, router, GraphQL schema, and channel definitions.
- `priv/` – static assets and future location for Ecto migrations.

## Environment Variables

The backend reads a handful of configuration values via environment variables:

- `DATABASE_URL` – PostgreSQL connection string (not yet used by the in-memory store).
- `SECRET_KEY_BASE` – secret used for signing cookies/sessions.
- `STORAGE_*` – credentials for the S3-compatible object storage service.

## Testing

Unit tests are not yet implemented. Once persistent storage is wired up, add `ExUnit` tests covering the GraphQL
resolvers and context modules.
