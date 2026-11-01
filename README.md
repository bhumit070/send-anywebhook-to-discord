# Send Any Webhook to Discord

Relay webhooks from any service to a Discord channel, even services that only know how to POST JSON somewhere.

📖 **Documentation: https://bhumit070.github.io/send-anywebhook-to-discord/**

1. Create a **relay**: a name plus the Discord channel's webhook URL. You get a URL like `https://your-host/h/vikunja_k3J9xQp2…`.
2. Give it a **sample payload**: paste example JSON, paste a JSON Schema, or capture the next real webhook.
3. **Map fields** onto a Discord message with the visual mapper (drag fields onto title, description, color, fields…) and watch a Discord-style preview update live. Or write Liquid templates directly.
4. Paste the URL into the other service. Every webhook is queued, rendered, sent to Discord with retries, and logged with every attempt.

## Run it (Docker only)

```sh
cp .env.example .env
# set APP_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD in .env
docker compose up -d --build
```

- UI: http://localhost:8080 (sign up; the first account is just a normal user)
- API docs (Swagger): http://localhost:8080/docs
- Health: http://localhost:8080/healthz

Migrations run automatically when the backend starts. Put the stack behind HTTPS (any reverse proxy) and set `PUBLIC_BASE_URL` so relay URLs are shown correctly and the session cookie is marked `Secure`.

## Configuration

See [`.env.example`](.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `APP_SECRET` | required | Signs sessions and encrypts stored Discord webhook URLs. Changing it logs everyone out and makes stored webhook URLs unreadable (re-enter them). |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | Where people reach this instance. |
| `AUTH_DISABLED` | `false` | Turns off login; everyone acts as one local user. Only for private networks. Ingest URLs still need their secret key. |
| `ALLOW_REGISTRATION` | `true` | Allow new sign-ups. |
| `EVENT_RETENTION_DAYS` | `14` | Delivered/skipped logs are deleted after this many days; dead/rejected after twice that. |
| `RUN_WORKER` | `true` | Run the delivery worker inside the API process. Workers use `SKIP LOCKED`, so you can run several. |

## How delivery works

- `POST`/`PUT /h/{key}` accepts **JSON bodies only** (up to 1 MB, 120/min per relay). Anything else is answered with an error **and logged as `rejected`**, so you can see why a service's webhooks aren't arriving.
- Accepted webhooks go into the `webhook_queue` table and get `202`. Nothing is sent from the request itself.
- The worker picks the first template whose condition matches (lowest priority number first), renders it, applies Discord's limits (cutting text and dropping invalid URLs, with warnings), and posts it.
  - **2xx** → `delivered`
  - **429** → waits for Discord's `retry_after`; doesn't use up a retry
  - **5xx / network error** → `failed`, retried after 10s, 1m, 5m, 30m; `dead` after 5 attempts
  - **401/404** (webhook deleted) → `dead`, and the relay is disabled
  - other **4xx** or a template error → `dead`
- Every try is stored in `webhook_attempts`: what was sent, Discord's response, and the error with stack trace.
- From the **Logs** page you can filter, sort, search payloads, and **send now** (skip the queue), **retry**, **cancel**, **replay**, or **send the oldest N** when there's a backlog.
- Messages are sent with `allowed_mentions: { parse: [] }`, so payload text can never ping `@everyone` or roles.

## Templates

The visual mapper compiles to a *message template*: Discord's message JSON where every string is a [Liquid](https://liquidjs.com) template. Advanced mode edits that JSON directly. Payload fields are top-level variables (`{{ data.task.title }}`), plus `payload` (the whole body) and `relay.name`. Extra filters: `to_text`, `bool_emoji`, `number_format`, `discord_time: "R"`, `title_case`. `fields_each: { path, name, value }` adds one embed field per list item, with `item` in scope.

## Development

Requires Node 24+ and Docker (for Postgres).

```sh
npm install
cp .env.example .env               # uncomment DATABASE_URL (same password as POSTGRES_PASSWORD)
npm run db:up                      # Postgres on localhost:5432
npm run dev -w @send-any-webhook/backend   # API + worker on :3000
npm run dev -w @send-any-webhook/frontend  # UI on :5173, proxies /api, /h, /docs to :3000
```

```sh
npm run typecheck
npm test                           # unit tests; integration tests are skipped without a database
TEST_DATABASE_URL=postgres://send_any_webhook:<password>@localhost:5432/send_any_webhook_test npm test
                                   # ⚠ the test database is wiped on every run
npm run db:generate -w @send-any-webhook/backend -- --name <change>   # after editing backend/src/db/schema.ts
npm run api:gen -w @send-any-webhook/frontend                         # after changing API routes/schemas
```

### Layout

```
backend/          Fastify API + Swagger, delivery worker, Drizzle schema & migrations (backend/drizzle)
frontend/         React + Tailwind + shadcn/ui; served by nginx in Docker, which also proxies the API
packages/shared/  Used by both: mapping → Liquid compiler, renderer + Discord limits, auto-map, schema → sample
```

The preview in the browser and the worker use the same renderer from `packages/shared`, so the preview shows exactly what gets sent.

### Prebuilt images

`.github/workflows/ci.yml` runs type-checks and tests (with Postgres), then publishes `ghcr.io/bhumit070/send-any-webhook-backend` and `ghcr.io/bhumit070/send-any-webhook-frontend` on pushes to `master` and `v*` tags. [`docker-compose.ghcr.yml`](docker-compose.ghcr.yml) runs them without cloning or building. See [Deployment](https://bhumit070.github.io/send-anywebhook-to-discord/deployment.html#prebuilt-images).

### Documentation site

`docs/` is a Jekyll site (Just the Docs theme) written in Markdown and published to GitHub Pages by `.github/workflows/docs.yml`.

## License

[MIT](LICENSE)
