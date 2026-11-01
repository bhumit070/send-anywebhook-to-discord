---
title: Troubleshooting
nav_order: 8
---

# Troubleshooting
{: .no_toc }

Start with the **Logs**: almost every problem shows up there with an exact error. Open the webhook, then its **Attempts** tab, for Discord's full response.

1. TOC
{:toc}

## Nothing shows up in the logs

The service's requests aren't reaching a relay.

- **Wrong or old URL.** Unknown keys get `404` and aren't logged. Copy the URL again from the relay page; it may have been rotated.
- **Not reachable.** `localhost:5252` only works on your machine. Other services need a public URL; see [HTTPS and a public URL](deployment.md#https-and-a-public-url). Test with `curl` from another machine.
- **Rate limited.** More than 120 requests a minute to one relay get `429` and aren't logged.

## Webhooks are "rejected"

The error says why:

| Error | Fix |
|---|---|
| *Only JSON bodies are supported (content-type: …)* | The service sends form data or XML. The app accepts JSON only. Check the service's settings for a JSON option |
| *Invalid JSON: …* | The service sent broken JSON |
| *Empty body; a JSON body is required* | The service sent no body (some send a bodyless "ping" when you save the webhook; that's harmless) |
| *Body larger than 1024 KB* | Payloads over 1 MB aren't accepted |
| *Relay is disabled* | Turn the relay back on (and check why it was disabled; see below) |

## Webhooks are "skipped"

| Error | Fix |
|---|---|
| *Relay has no templates yet* | Create a template on the relay's **Templates** tab, then **Retry** the skipped rows |
| *No template condition matched this payload* | Add a template without a condition as a fallback, or fix the conditions. The template editor shows whether a condition matches a given payload (pick it under **Preview data**) |
| *Relay is disabled* | The relay was off when this was processed. Turn it on and **Retry** |

## Webhooks are "dead"

| Error | Meaning |
|---|---|
| *Discord 401/404 … relays using it were disabled* | The Discord webhook was deleted, or the URL is wrong. The app disabled every relay using that saved webhook. Fix the URL on the **Discord webhooks** page (**Edit**), turn the relays on, then **Retry** |
| *Discord 400: Invalid Form Body {…}* | Discord refused the message. The JSON after it names the bad field. The app already drops invalid URLs and cuts long text, so this is rare; open the template and check the preview's warnings |
| *Template "…": The message is empty for this payload* | Every part of the message rendered empty (often mapped fields that don't exist in this payload). Add a fallback (**If empty, show**) or static text |
| *Template "…": embeds[0].title: …* | A Liquid syntax or render error in that slot |
| *… (gave up after 5 attempts)* | Discord or the network failed 5 times in a row. **Retry** once it's fixed |
| *Cancelled by user* | Someone cancelled it |

After fixing a template, filter the logs by **dead**, select the rows and **Retry**. They're re-rendered with the current template.

## Webhooks stay "failed" or "pending"

- `failed` with a **next try** time is normal: the app is backing off (10s, 1m, 5m, 30m). Use **Send now** to try immediately.
- `429` means Discord is rate-limiting this webhook. The app waits as long as Discord asks, and this doesn't use up attempts.
- Lots of `pending` that never move: check the backend is running (`docker compose ps`, `docker compose logs backend`) and that `RUN_WORKER` isn't `false` on every backend.

## The message looks different in Discord

- Use **Send test to Discord** in the template editor to compare the real thing with the preview.
- `<t:…>` timestamps show in each reader's timezone and language, so they differ between people.
- Mentions (`<@123>`, `@everyone`) are shown but never ping anyone; the app disables pings.

## Login problems

- **"Registration is closed on this instance"**: `ALLOW_REGISTRATION=false`. Set it to `true` temporarily, or have someone with server access create the account.
- **Logged out unexpectedly**: sessions last 30 days, and changing `APP_SECRET` ends all of them.
- **Can't stay logged in over plain HTTP on a server**: if `PUBLIC_BASE_URL` starts with `https://`, the cookie is `Secure` and browsers won't send it over `http://`. Use the HTTPS address.

## Saved webhooks show "https://discord.com/api/webhooks/…" with no ID

`APP_SECRET` changed since the URL was saved, so it can't be decrypted. Restore the old secret, or paste the URL again on the **Discord webhooks** page (**Edit**).

## Startup errors

| Log message | Fix |
|---|---|
| `Missing required environment variable APP_SECRET` | Set it in `.env` |
| `APP_SECRET must be at least 32 characters` | Use `openssl rand -hex 32` |
| `set POSTGRES_PASSWORD in .env` (from Compose) | Set it in `.env` |
| Backend restarts with database connection errors | Postgres isn't healthy yet, or the password in `.env` changed after the database was created. The password is fixed when the `pgdata` volume is first created |
