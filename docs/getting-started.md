---
title: Getting started
nav_order: 2
---

# Getting started
{: .no_toc }

You only need **Docker** (with Compose v2). You don't need Node.js or Postgres on your machine.

1. TOC
{:toc}

## 1. Start Send Any Webhook to Discord

```sh
git clone https://github.com/bhumit070/send-anywehook-to-discord.git send-any-webhook
cd send-any-webhook
cp .env.example .env
```

Open `.env` and set two values:

```sh
APP_SECRET=      # generate one: openssl rand -hex 32
POSTGRES_PASSWORD=  # any strong password
```

Then start everything:

```sh
docker compose up -d --build
```

The first build takes a few minutes. When `docker compose ps` shows all three services as `healthy`, open:

| URL | What |
|---|---|
| <http://localhost:8080> | The web UI |
| <http://localhost:8080/docs> | Swagger API docs |
| <http://localhost:8080/healthz> | Health check (`{"status":"ok","db":"ok"}`) |

{: .note }
Database migrations run automatically every time the backend starts. There's no separate setup step.

{: .tip }
Don't want to build images? See [Prebuilt images](deployment.md#prebuilt-images).

## 2. Create an account

Open <http://localhost:8080> and click **Sign up**. Passwords need at least 8 characters.

Running Send Any Webhook to Discord only for yourself on a private network? Set `AUTH_DISABLED=true` in `.env` and skip logins entirely. See [Configuration](configuration.md#authentication).

## 3. Create a Discord webhook

In Discord, open the channel's settings and go to **Integrations → Webhooks → New Webhook**. Optionally give it a name and avatar, then click **Copy Webhook URL**. It looks like this:

```
https://discord.com/api/webhooks/123456789012345678/AbCdEf…
```

## 4. Create a relay

Click **New relay** and follow the three steps:

![The New relay form]({{ '/assets/images/new-relay.png' | relative_url }})

1. **Name and Discord channel.** Enter a name (it also becomes part of the URL) and paste the webhook URL. Send Any Webhook to Discord sends a test message to the channel so you know it works.
2. **Sample payload.** Show Send Any Webhook to Discord what the other service sends. Choose one:
   - **Paste JSON**: an example from the service's docs.
   - **JSON Schema**: Send Any Webhook to Discord generates an example from the schema.
   - **Capture live**: point the service at the relay URL and trigger an event. The first webhook that arrives becomes the sample.

   You can skip this step and add a sample later.
3. **Map fields.** **Auto-map** fills in a sensible embed from the field names. Adjust anything you like (see [Mapping fields](guides/mapping.md)) and click **Save and finish**.

## 5. Point the service at the relay

Copy the relay's URL from its page and paste it wherever the other service asks for a webhook URL. Try it from a terminal first:

```sh
curl -X POST 'http://localhost:8080/h/<your-relay-key>' \
  -H 'Content-Type: application/json' \
  -d '{"event":"test","message":"Hello from curl"}'
```

You should get `202` back and see the message in Discord within a second or two. If not, open the relay's **Logs** tab: each webhook shows its status and the exact error. Also see [Troubleshooting](troubleshooting.md).

## Stopping and starting

```sh
docker compose stop      # stop, keep data
docker compose up -d     # start again
docker compose down      # remove containers, keep the database volume
docker compose down -v   # remove everything, including all data
```

## Next steps

- [Put it behind HTTPS](deployment.md#https-and-a-public-url) so other services can reach it.
- Learn [conditional templates](guides/templates.md) to format different events differently.
- See how [retries and the logs](guides/logs.md) work.
