---
title: Configuration
nav_order: 3
---

# Configuration
{: .no_toc }

All settings are environment variables. With Docker Compose they're read from `.env` next to `docker-compose.yml`. Copy [`.env.example`](https://github.com/bhumit070/send-anywebhook-to-discord/blob/master/.env.example) to start.

1. TOC
{:toc}

## Required

| Variable | Description |
|---|---|
| `APP_SECRET` | At least 32 characters. Used to sign login sessions and to encrypt the Discord webhook URLs stored in the database. Generate one with `openssl rand -hex 32`. |
| `POSTGRES_PASSWORD` | Password for the bundled Postgres. Compose uses it for both the database and the backend's `DATABASE_URL`. |

{: .warning }
Changing `APP_SECRET` logs everyone out. The app can then no longer decrypt stored Discord webhook URLs, so you'd need to paste each URL again on the **Discord webhooks** page (**Edit**). Keep it safe and keep it stable.

## General

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5252` | Host port the web UI, API and ingest endpoint are published on. |
| `PUBLIC_BASE_URL` | `http://localhost:5252` | The address people and services reach the app at. Relay URLs shown in the UI are built from it. If it starts with `https://`, the session cookie is marked `Secure`. |
| `LOG_LEVEL` | `info` | Backend log level: `fatal`, `error`, `warn`, `info`, `debug` or `trace`. Logs are JSON on stdout. |
| `TRUST_PROXY_HOPS` | `1` | How many reverse proxies sit in front of the backend. `1` is the bundled nginx; use `2` when you add your own proxy for HTTPS. The client IP (used for login rate limits and shown in logs) is read from `X-Forwarded-For` only through these proxies, so clients can't fake it. |

## Authentication

| Variable | Default | Description |
|---|---|---|
| `ALLOW_REGISTRATION` | `true` | Whether new users can sign up. Create your account, then set it to `false` to close sign-ups. |
| `AUTH_DISABLED` | `false` | Turns login off completely. Every request acts as one built-in local user, and the sign-up and login endpoints return `404`. |

{: .warning }
With `AUTH_DISABLED=true`, **anyone who can reach the dashboard can manage relays and read logs.** Use it only on a private network or behind your own auth (a VPN, or a reverse proxy with basic auth). Relay ingest URLs still need their secret key either way.

## Delivery and logs

| Variable | Default | Description |
|---|---|---|
| `RUN_WORKER` | `true` | Run the delivery worker inside the API process. Set `false` on API-only replicas if you run workers separately (see [Scaling](deployment.md#scaling)). |
| `EVENT_RETENTION_DAYS` | `14` | How long logs are kept. Delivered and skipped webhooks are deleted after this many days; dead and rejected ones after twice as long. The cleanup runs every hour. |

## Running from source only

These matter when running the backend outside Docker (see [Development](development.md)):

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string. Compose sets this itself. |
| `BACKEND_PORT` | `5353` | Port the backend listens on (in Docker: the localhost port it's published on). |
| `HOST` | `0.0.0.0` | Interface the API binds to. |
| `PRETTY_LOGS` | `false` | Human-readable logs instead of JSON. |

## Fixed limits

These aren't configurable:

| Limit | Value |
|---|---|
| Webhook body size | 1 MB |
| Webhooks per relay | 120 per minute (then `429`) |
| Login and sign-up attempts | 10 per minute per IP |
| Delivery attempts | 5, with backoff of 10s, 1m, 5m, 30m |
| Discord request timeout | 10 seconds |
| Sessions | 30 days |
