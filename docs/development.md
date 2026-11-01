---
title: Development
nav_order: 7
---

# Development
{: .no_toc }

1. TOC
{:toc}

## Requirements

- Node.js **24+** and npm
- Docker, for Postgres

## Running from source

```sh
git clone https://github.com/bhumit070/send-anywehook-to-discord.git send-any-webhook
cd send-any-webhook
npm install
cp .env.example .env
```

In `.env`, set `APP_SECRET` and `POSTGRES_PASSWORD`, and uncomment `DATABASE_URL` with the same password:

```sh
DATABASE_URL=postgres://send-any-webhook:<POSTGRES_PASSWORD>@localhost:5432/send-any-webhook
PRETTY_LOGS=true
```

Then, in separate terminals:

```sh
npm run db:up                      # Postgres in Docker, exposed on localhost:5432
npm run dev -w @send-any-webhook/backend   # API + worker on :3000, restarts on changes
npm run dev -w @send-any-webhook/frontend  # UI on http://localhost:5173 with hot reload
```

The Vite dev server forwards `/api`, `/h`, `/docs` and `/healthz` to `localhost:3000`, just like nginx does in Docker. Set `PUBLIC_BASE_URL=http://localhost:5173` so relay URLs point at the dev server.

{: .note }
Both `dev` scripts build `packages/shared` first. If you change code in `packages/shared` while they're running, rebuild it with `npm run build -w @send-any-webhook/shared`.

## Project layout

```
backend/            Fastify API, Swagger, delivery worker
  src/routes/       auth, relays, templates/preview, ingest, queue
  src/services/     delivery (render + send + record attempts), worker (queue loop)
  src/db/           Drizzle schema, migration runner
  drizzle/          SQL migrations
  test/             unit + Postgres integration tests
frontend/           React + Vite + Tailwind + shadcn/ui
  src/api/          generated OpenAPI types and client
  src/components/   Discord preview, mapper, logs, shadcn ui/
  src/pages/        relays, wizard, relay detail, template editor, login
packages/shared/    used by both: mapping → Liquid compiler, renderer + Discord limits,
                    auto-map, JSON Schema → sample, payload paths
docs/               this site (GitHub Pages)
```

The template editor's preview and the delivery worker call the same `renderMessage` from `packages/shared`, so the preview always matches what gets sent.

## Checks and tests

```sh
npm run typecheck   # all three packages
npm test            # shared + backend unit tests
npm run build       # production builds
```

Backend **integration tests** need a Postgres database they can wipe. They're skipped unless `TEST_DATABASE_URL` is set:

```sh
docker compose exec postgres psql -U send-any-webhook -c 'create database send_any_webhook_test'
TEST_DATABASE_URL=postgres://send-any-webhook:<password>@localhost:5432/send_any_webhook_test npm test
```

{: .warning }
The integration tests **drop and recreate every table** in `TEST_DATABASE_URL`. Never point it at a database you care about.

They use a fake Discord sender, so nothing is ever sent to Discord. CI runs the same checks with a Postgres service on every push and pull request.

## Changing the database schema

1. Edit `backend/src/db/schema.ts`.
2. Generate a migration: `npm run db:generate -w @send-any-webhook/backend -- --name add_something`
3. Review the SQL in `backend/drizzle/` and commit it with the schema change.

Migrations run automatically when the backend starts. To run them by hand: `npm run db:migrate -w @send-any-webhook/backend`.

## Changing the API

Routes declare TypeBox schemas, which drive request validation, response serialization and Swagger. After changing a route or schema, regenerate the frontend's types:

```sh
npm run api:gen -w @send-any-webhook/frontend
```

This writes `frontend/src/api/openapi.json` and `schema.ts` (it needs no database). Commit both.

## Docker images

```sh
docker build -f backend/Dockerfile -t send-any-webhook-backend .
docker build -f frontend/Dockerfile -t send-any-webhook-frontend .
```

Both build from the **repo root**, because they need `packages/shared`.

## Documentation

This site is the `docs/` folder: Markdown pages built with Jekyll and the [Just the Docs](https://just-the-docs.com) theme, and published to GitHub Pages by `.github/workflows/docs.yml` whenever `docs/` changes on `master`.

Preview it locally with the same image GitHub uses:

```sh
docker run --rm -v "$PWD/docs:/src" -v "$PWD/_site:/out" \
  -e INPUT_SOURCE=/src -e INPUT_DESTINATION=/out \
  ghcr.io/actions/jekyll-build-pages:v1.0.13
npx serve _site   # then open the printed URL + /send-anywehook-to-discord/
```

{: .note }
Jekyll treats double curly braces as its own Liquid. Wrap examples of Send Any Webhook to Discord templates in a Liquid `raw` … `endraw` block so they show up as written (see `docs/guides/templates.md`).
