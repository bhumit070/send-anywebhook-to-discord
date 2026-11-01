---
title: Sample payloads
parent: Guides
nav_order: 2
---

# Sample payloads
{: .no_toc }

A relay's **sample** is one example of what the other service sends. The app uses it to:

- list the payload's fields in the mapper;
- [auto-map](mapping.md#auto-map) a first version of the message;
- preview the message while you edit.

The sample is never sent anywhere. Set or replace it from the relay's **Sample** tab, or in step 2 of the new-relay wizard.

1. TOC
{:toc}

## Paste JSON

The simplest option: copy an example payload from the service's documentation and paste it. Use the most complete example you can find, because fields missing from the sample won't appear in the field list. You can still type their paths by hand in a template.

## JSON Schema

If the service publishes a JSON Schema instead of examples, paste it into the **JSON Schema** tab and click **Generate example from schema**. For each property the app uses, in order:

1. `examples[0]`, `example`, `const`, `default` or `enum[0]`;
2. otherwise a placeholder for the type: `"example <name>"` for strings, `1` for integers, `true` for booleans, a fixed date for `format: date-time`, `https://example.com` for `format: uri`, and so on.

It follows local `$ref`s (`#/$defs/…`, `#/definitions/…`), takes the first non-null option of `oneOf`/`anyOf`, and merges `allOf`. Remote `$ref`s aren't fetched, and recursive schemas stop at the first repeat.

{: .tip }
If you paste a schema into the **Paste JSON** tab, the app notices and offers to switch tabs.

## Capture live

No docs at all? Let the service show you:

1. Open the **Capture live** tab and click **Start capturing**.
2. Paste the relay URL into the service and trigger an event (or use the curl command shown).
3. The first webhook that arrives becomes the sample. The page updates by itself.

The captured webhook is also queued for delivery as usual. Without a template yet, it's logged as *skipped*.

## Using a real webhook as the sample

Any webhook in the logs can become the sample: open it and click **Use as sample**. This is handy when a service sends several event types and you want fields from a specific one.

## Previewing with other payloads

The sample is just the default. In the template editor, the **Preview data** picker can also show:

- any of the last 15 webhooks the relay received;
- custom JSON you type in.

Use it to check how a template handles events with missing or unusual fields.
