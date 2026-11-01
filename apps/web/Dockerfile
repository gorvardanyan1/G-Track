# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/web/Dockerfile -t tempo-web .
# A static build served by nginx, which also proxies /api (and the Socket.io WebSocket) to the
# api, so the browser sees a single origin (the refresh cookie is SameSite=Strict).
ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:1.28-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace=@tempo/web --workspace=@tempo/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @tempo/web

FROM ${NGINX_IMAGE} AS runtime
# API_UPSTREAM: where nginx forwards /api (host:port of the api container).
ENV API_UPSTREAM=api:3000
COPY apps/web/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz > /dev/null || exit 1
