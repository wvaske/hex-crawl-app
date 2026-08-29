# HexCrawl VTT — single-container production image.
# The bundled server (Hono + ws + SQLite) also serves the built client.

FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm --filter @hexcrawl/client build \
 && pnpm --filter @hexcrawl/server bundle

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Native module is the only runtime dependency outside the bundle.
RUN npm install --no-save better-sqlite3@^12.4.0 \
 && npm cache clean --force
COPY --from=build /app/packages/server/dist/server.mjs server.mjs
COPY --from=build /app/packages/client/dist client-dist

ENV PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    CLIENT_DIST=/app/client-dist
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
