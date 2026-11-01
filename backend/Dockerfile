# Build from the repo root: docker build -f backend/Dockerfile .
FROM node:24-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w @send-any-webhook/shared -w @send-any-webhook/backend

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY backend backend
RUN npm run build -w @send-any-webhook/shared && npm run build -w @send-any-webhook/backend

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w @send-any-webhook/shared -w @send-any-webhook/backend && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/package.json ./
COPY packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY backend/package.json backend/
COPY backend/drizzle backend/drizzle
COPY --from=build /app/backend/dist backend/dist

USER node
WORKDIR /app/backend
EXPOSE 5353
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5353/healthz >/dev/null || exit 1
# Applies pending migrations, then starts the API
CMD ["node", "dist/server.js"]
