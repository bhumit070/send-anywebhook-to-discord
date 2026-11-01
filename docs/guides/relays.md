---
title: Relays
parent: Guides
nav_order: 1
---

# Relays
{: .no_toc }

A **relay** connects one incoming URL to one Discord channel. Make one relay per source (one for Vikunja, one for your CI, and so on). To send the same events to two channels, create two relays.

1. TOC
{:toc}

## The relay URL

Every relay gets a URL like:

```
https://your-host/h/vikunja-tasks_k3J9xQp2LmT8aB4cD6eF8gH0
```

The part after `/h/` is the relay's **key**: a readable slug from its name, then 24 random characters. The key is the only thing that authenticates an incoming webhook, so treat the URL as a secret.

- Renaming a relay doesn't change its URL.
- **Setup → Issue a new URL** replaces the key. The old URL stops working immediately (it returns `404`), so update it in the other service.

The URL accepts `POST` and `PUT` with a JSON body. See [the ingest endpoint](../api.md#ingest-endpoint) for every response code.

## The Discord channel

Paste the channel's webhook URL from **Channel settings → Integrations → Webhooks**. Send Any Webhook to Discord:

- accepts only real Discord webhook URLs (`https://discord.com/api/webhooks/…`, including `ptb.` and `canary.`);
- stores them encrypted with `APP_SECRET`;
- never shows the full token again. The UI shows a masked version like `…/webhooks/1234…/AbCd…wxyz`.

To point a relay at another channel, use **Setup → Discord channel → Replace**. **Send a test message** posts a short message to check the channel works.

{: .note }
If Discord answers **401** or **404** for a delivery (the webhook was deleted or its token is wrong), Send Any Webhook to Discord **disables the relay** so it stops retrying a webhook that can't work. Paste a working URL and turn the relay back on.

## Enabling and disabling

The switch on the relays list (or **Setup → Enabled**) turns a relay off without deleting anything. While it's off:

- incoming webhooks get `403` and are logged as **rejected**, so you can see what you missed;
- webhooks already in the queue are marked **skipped** instead of being sent. **Retry** them after turning the relay back on.

## Deleting

**Setup → Delete relay** removes the relay, its templates and all of its logs. The URL stops working. This can't be undone.

## Relays list

The home page lists your relays with:

- the URL and a copy button;
- when the last webhook arrived, and its status;
- **Waiting**: how many webhooks are pending, being sent, or waiting for a retry. Click it to see them in the logs;
- a **No template** badge when the relay can't deliver yet. Webhooks are received but [skipped](logs.md#statuses) until you create a template.
