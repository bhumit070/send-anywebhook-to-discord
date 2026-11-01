---
title: Deployment
nav_order: 5
---

# Deployment
{: .no_toc }

1. TOC
{:toc}

## What runs

| Container | Image | Role |
|---|---|---|
| `frontend` | nginx | Serves the web UI and forwards `/api`, `/h`, `/docs` and `/healthz` to the backend, so everything is on **one port** |
| `backend` | Node.js 24 | API, Swagger, and the delivery worker. Runs database migrations on startup |
| `postgres` | postgres:18-alpine | All data, including the delivery queue. Stored in the `pgdata` volume |

Only the frontend's port (default `8080`) needs to be reachable.

## Prebuilt images

Every push to `master` (and every `v*` tag) publishes multi-arch (amd64/arm64) images:

- `ghcr.io/bhumit070/send-any-webhook-backend`
- `ghcr.io/bhumit070/send-any-webhook-frontend`

Tags are `latest` (from `master`), the version for tags (e.g. `1.2.3`), and `sha-<commit>`.

To run from them, without cloning the repo or building anything:

```sh
mkdir send-any-webhook && cd send-any-webhook
curl -LO https://raw.githubusercontent.com/bhumit070/send-anywebhook-to-discord/master/docker-compose.ghcr.yml
curl -L -o .env https://raw.githubusercontent.com/bhumit070/send-anywebhook-to-discord/master/.env.example
# edit .env: set APP_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD
docker compose -f docker-compose.ghcr.yml up -d
```

Pin a version with `IMAGE_TAG=1.2.3` in `.env`.

## HTTPS and a public URL

Other services need to reach the app, so in practice it runs on a server behind HTTPS. Point a domain at the server, put any reverse proxy in front of port `8080`, and set:

```sh
PUBLIC_BASE_URL=https://webhooks.example.com
```

`PUBLIC_BASE_URL` is used for the relay URLs shown in the UI. Because it starts with `https://`, the session cookie is marked `Secure`.

Also set `TRUST_PROXY_HOPS=2`: your proxy plus the bundled nginx. Otherwise every request looks like it comes from your proxy, and all users share one login rate limit.

**Caddy** (gets certificates automatically):

```
webhooks.example.com {
    reverse_proxy localhost:8080
}
```

**nginx**:

```nginx
server {
    listen 443 ssl;
    server_name webhooks.example.com;
    # ssl_certificate / ssl_certificate_key …

    client_max_body_size 2m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

{: .tip }
To bind the app only to localhost so it can't be reached except through the proxy, change the frontend's port mapping to `"127.0.0.1:8080:80"`.

## Locking it down

- Create your account, then set `ALLOW_REGISTRATION=false` and run `docker compose up -d` to close sign-ups.
- Use `AUTH_DISABLED=true` only if the dashboard is unreachable from the internet. The `/h/…` ingest URLs are protected by their key either way.
- Keep `.env` private. `APP_SECRET` decrypts the stored Discord webhook URLs.

## Backups

Everything lives in Postgres. To back up:

```sh
docker compose exec -T postgres pg_dump -U send_any_webhook -Fc send_any_webhook > send-any-webhook-$(date +%F).dump
```

To restore into a fresh install (same `APP_SECRET`!):

```sh
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U send_any_webhook -d send_any_webhook --clean --if-exists < send-any-webhook-2026-11-01.dump
docker compose up -d
```

{: .warning }
A backup restored with a different `APP_SECRET` keeps its relays and logs, but the stored Discord webhook URLs can't be decrypted. Paste them again on each relay's Setup tab.

## Upgrading

From a clone:

```sh
git pull
docker compose up -d --build
```

With prebuilt images:

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

Migrations run when the new backend starts. Webhooks that arrive while the backend restarts are refused by nginx (`502`), and most services retry them. Webhooks already in the queue are safe in Postgres and are delivered once the backend is back.

## Scaling

One backend handles a lot. Ingest is a single insert, and delivery is limited mostly by Discord. If you do need more:

- **More backends**: `docker compose up -d --scale backend=3`, then `docker compose restart frontend` so nginx picks up the new containers. Every backend runs a worker. Workers claim queue rows with `FOR UPDATE SKIP LOCKED`, so a webhook is never sent twice.
- **Separate API and workers**: set `RUN_WORKER=false` on the API containers and run extra backend containers with `RUN_WORKER=true` as workers.

{: .note }
Each worker spaces its own sends per relay, but several workers don't coordinate that spacing. With many workers and a very busy relay you may hit Discord's rate limit more often. That's harmless (`429` is retried without using up an attempt), just slower.

## Monitoring

- `GET /healthz` returns `200 {"status":"ok","db":"ok"}`, or `503` when the database is unreachable. Docker uses it for the container healthchecks.
- Backend logs are JSON on stdout (`docker compose logs -f backend`). Delivery problems are also visible in the UI's **Logs** page.
- `GET /api/queue/stats` returns counts per status and the oldest waiting webhook. Useful for alerting on a growing backlog (needs a session cookie; see [API](api.md)).
