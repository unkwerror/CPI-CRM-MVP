# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/importer/package.json ./packages/importer/package.json

RUN --mount=type=cache,id=cpi-crm-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build

ARG API_PROXY_TARGET=http://api:3001
ENV API_PROXY_TARGET=$API_PROXY_TARGET

COPY . .
RUN pnpm build

FROM build AS api-deployment
RUN --mount=type=cache,id=cpi-crm-pnpm,target=/pnpm/store \
    pnpm --filter @cpi-crm/api deploy --prod --legacy /opt/cpi-api

FROM build AS worker-deployment
RUN --mount=type=cache,id=cpi-crm-pnpm,target=/pnpm/store \
    pnpm --filter @cpi-crm/worker deploy --prod --legacy /opt/cpi-worker

FROM node:22-bookworm-slim AS api

ENV NODE_ENV=production \
    API_PORT=3001
WORKDIR /app
COPY --from=api-deployment --chown=node:node /opt/cpi-api/ ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]

FROM node:22-bookworm-slim AS worker

ENV NODE_ENV=production
WORKDIR /app
COPY --from=worker-deployment --chown=node:node /opt/cpi-worker/ ./
USER node
CMD ["node", "dist/src/index.js"]

FROM node:22-bookworm-slim AS web

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app/apps/web
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone/ /app/
COPY --from=build --chown=node:node /workspace/apps/web/.next/static/ /app/apps/web/.next/static/
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(r.status>=500)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

# One-shot migration image. It intentionally keeps build dependencies, while
# API/web/worker runtime images contain only their production dependencies.
FROM build AS tools
CMD ["corepack", "pnpm", "--filter", "@cpi-crm/db", "migrate"]
