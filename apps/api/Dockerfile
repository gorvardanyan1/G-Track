# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile -t tempo-api .
# The api runs its TypeScript directly (Node's type stripping), so there is no compile step;
# the image holds the api, the shared package and production dependencies only.
ARG NODE_IMAGE=node:24-alpine

# ── dependencies + generated Prisma client ─────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
# The api's postinstall runs `prisma generate` (into apps/api/src/generated).
RUN npm ci --workspace=@tempo/api --workspace=@tempo/shared --include-workspace-root

# ── one-off migrations (the Prisma CLI is a dev dependency) ───────────────────
#   docker build -f apps/api/Dockerfile --target migrate -t tempo-api-migrate .
#   docker run --rm -e DATABASE_URL=… tempo-api-migrate
FROM deps AS migrate
WORKDIR /app/apps/api
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

# ── runtime ───────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HUSKY=0 \
    HOST=0.0.0.0 \
    PORT=3000 \
    MAIL_OUTBOX_DIR=/var/lib/tempo/outbox
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts --workspace=@tempo/api --workspace=@tempo/shared \
    && npm cache clean --force \
    && mkdir -p /var/lib/tempo/outbox \
    && chown -R node:node /var/lib/tempo
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
COPY --from=deps /app/apps/api/src/generated apps/api/src/generated
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" > /dev/null || exit 1
CMD ["node", "apps/api/src/server.ts"]
