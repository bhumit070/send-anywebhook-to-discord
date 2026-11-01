---
title: API
nav_order: 6
---

# API
{: .no_toc }

Everything the UI does goes through a JSON API, documented with **Swagger at `/docs`** on your instance (for example <http://localhost:5252/docs>). The raw OpenAPI spec is at `/docs/json`.

1. TOC
{:toc}

## Ingest endpoint

This is the URL you give to other services.

```
POST /h/{key}
PUT  /h/{key}
```

The body must be **JSON** (objects, arrays or any JSON value), at most **1 MB**. The `Content-Type` header isn't checked strictly: a body that parses as JSON is accepted even when sent as `text/plain`.

| Response | When | Logged? |
|---|---|---|
| `202 {"id":"…","status":"queued"}` | Accepted and queued | yes (`pending`) |
| `400` | Empty body, or invalid JSON sent as JSON | yes (`rejected`) |
| `403` | The relay is disabled | yes (`rejected`) |
| `404` | No relay has this key (wrong or rotated URL) | no |
| `413` | Body larger than 1 MB | yes (`rejected`) |
| `415` | Body isn't JSON | yes (`rejected`) |
| `429` | More than 120 requests in a minute for this relay | no |

`202` means *stored*, not *delivered*. Delivery happens in the background; see [Logs, retries and the queue](guides/logs.md).

```sh
curl -i -X POST 'https://webhooks.example.com/h/vikunja-tasks_k3J9xQp2LmT8aB4cD6eF8gH0' \
  -H 'Content-Type: application/json' \
  -d '{"event_name":"task.created","data":{"task":{"title":"Fix login bug"}}}'
```

## Authentication

The dashboard API (`/api/…`) uses a session cookie, `send_any_webhook_session`, set by logging in. From a script:

```sh
# log in and store the cookie
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' \
  https://webhooks.example.com/api/auth/login

# use it
curl -b cookies.txt https://webhooks.example.com/api/relays
```

With `AUTH_DISABLED=true` no cookie is needed.

In Swagger UI, log in through the `/api/auth/login` operation ("Try it out"). The browser keeps the cookie for the other calls.

## Endpoints

| Group | Endpoints |
|---|---|
| System | `GET /healthz`, `GET /api/config` |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Discord webhooks | `GET/POST /api/discord-webhooks`, `PATCH/DELETE /api/discord-webhooks/{id}`, `POST /api/discord-webhooks/{id}/test` |
| Relays | `GET/POST /api/relays`, `GET/PATCH/DELETE /api/relays/{id}`, `POST /api/relays/{id}/rotate-key`, `PUT /api/relays/{id}/sample`, `POST /api/relays/{id}/capture`, `POST /api/relays/{id}/test` |
| Templates | `GET/POST /api/relays/{id}/templates`, `PATCH/DELETE /api/relays/{id}/templates/{templateId}`, `POST /api/preview`, `POST /api/mapping/auto` |
| Queue and logs | `GET /api/queue`, `GET /api/queue/stats`, `GET /api/queue/{id}`, `POST /api/queue/{id}/send`, `POST /api/queue/send`, `POST /api/queue/send-oldest`, `POST /api/queue/{id}/retry`, `POST /api/queue/retry`, `POST /api/queue/{id}/cancel`, `POST /api/queue/cancel`, `POST /api/queue/{id}/replay` |

Swagger has the request and response schemas for each.

## Examples

Save a Discord webhook, then create a relay that uses it:

```sh
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"#ci","url":"https://discord.com/api/webhooks/…"}' \
  https://webhooks.example.com/api/discord-webhooks
# → {"id":"<webhook-id>", …}

curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"CI","discordWebhookId":"<webhook-id>"}' \
  https://webhooks.example.com/api/relays
```

Or pass `discordWebhookUrl` (and optionally `discordWebhookName`) instead of `discordWebhookId`. The URL is saved, or matched to one you already saved.

Find failed deliveries from the last day that Discord rate-limited:

```sh
curl -b cookies.txt -G https://webhooks.example.com/api/queue \
  --data-urlencode 'status=failed' --data-urlencode 'status=dead' \
  --data-urlencode 'statusCode=429' \
  --data-urlencode "from=$(date -u -v-1d +%FT%TZ 2>/dev/null || date -u -d '1 day ago' +%FT%TZ)" \
  --data-urlencode 'sort=receivedAt:desc'
```

Query parameters for `GET /api/queue`: `relayId` (repeatable), `status` (repeatable), `from`, `to` (ISO dates), `statusCode`, `hasError`, `q` (text search), `path` + `pathValue` (payload field equals), `sort` (`receivedAt|attempts|lastStatusCode|nextAttemptAt|deliveredAt|status|relayName` + `:asc|:desc`), `page`, `pageSize` (max 200).

Retry everything that died for one relay:

```sh
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"filter":{"relayId":["<relay-id>"],"status":["dead"]}}' \
  https://webhooks.example.com/api/queue/retry
```
