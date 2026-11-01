# Build from the repo root: docker build -f frontend/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w @send-any-webhook/shared -w @send-any-webhook/frontend
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend frontend
RUN npm run build -w @send-any-webhook/shared && npm run build -w @send-any-webhook/frontend

FROM nginx:1-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
