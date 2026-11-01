---
title: Templates and conditions
parent: Guides
nav_order: 4
---

# Templates and conditions
{: .no_toc }

1. TOC
{:toc}

{% raw %}

## Several templates per relay

Services often send different events to the same URL (`task.created`, `task.done`, …). Give a relay one template per event and the app picks the right one:

1. Templates are tried by **priority**, lowest number first (ties: oldest first).
2. The first template whose **condition** is true formats the message.
3. A template with **no condition** matches everything. Give it the highest number so it acts as the fallback.
4. If nothing matches, the webhook is logged as **skipped** and nothing is sent.

The **Templates** tab lists them in the order they're tried.

### Example

| Priority | Name | Condition |
|---|---|---|
| 0 | Task done | `event_name == "task.done"` |
| 1 | High priority | `data.task.priority >= 4` |
| 10 | Everything else | *(none)* |

### Writing conditions

A condition is a [Liquid](https://liquidjs.com/tutorials/operators.html) expression, the part you'd put inside `{% if … %}`:

```liquid
event_name == "task.created"
action == "opened" or action == "reopened"
data.task.priority >= 4 and data.task.done == false
labels contains "urgent"
repository.full_name != "acme/sandbox"
```

The editor shows whether the condition matches the current preview payload. A condition with a syntax error can't be saved.

## Liquid reference

Every string in a message template is a [LiquidJS](https://liquidjs.com) template. The visual mapper writes these for you; you only need this section for **Template** slots, **Advanced mode** and **conditions**.

### Variables

| Variable | Value |
|---|---|
| top-level payload keys | `{{ event_name }}`, `{{ data.task.title }}` |
| `payload` | The whole body. Use it when the body is a list (`{{ payload[0].id }}`) or for keys with special characters (`{{ payload["project-name"] }}`) |
| `relay.name` | The relay's name (unless the payload has its own `relay` key) |

Use dots for nested objects (`data.task.title`), `[0]` for list items, and `["key-with-dashes"]` for odd keys. Only the payload's own keys are readable; prototype properties like `constructor` aren't.

### Filters

All [standard LiquidJS filters](https://liquidjs.com/filters/overview.html) work (`upcase`, `truncate`, `join`, `map`, `size`, `date`, `default`, `replace`, `split`, `plus`, …), plus these:

| Filter | Example | Result |
|---|---|---|
| `to_text` | <code>{{ labels &#124; to_text }}</code> | lists → `a, b`; objects → JSON; null → empty |
| `bool_emoji` | <code>{{ done &#124; bool_emoji }}</code> | `✅` / `❌` |
| `number_format` | <code>{{ amount &#124; number_format }}</code> | `1,234,567` |
| `discord_time` | <code>{{ due &#124; discord_time: &quot;R&quot; }}</code> | `<t:1793664000:R>`, which Discord shows as "in 2 days" in the reader's timezone. Styles: `t` `T` `d` `D` `f` `F` `R` |
| `title_case` | <code>{{ status &#124; title_case }}</code> | `In Progress` |

### Message template format

The message is Discord's [webhook body](https://discord.com/developers/docs/resources/webhook#execute-webhook) as JSON. Strings may be templates; `color` and `timestamp` are rendered and then parsed:

```json
{
  "username": "Vikunja",
  "content": "New task in **{{ data.project.title }}**",
  "embeds": [
    {
      "title": "{{ data.task.title | truncate: 256 }}",
      "url": "{{ data.task.url }}",
      "description": "{{ data.task.description }}",
      "color": "{% if data.task.priority >= 4 %}red{% else %}#5865F2{% endif %}",
      "timestamp": "{{ time }}",
      "author": { "name": "{{ data.doer.name }}", "icon_url": "{{ data.doer.avatar_url }}" },
      "footer": { "text": "{{ relay.name }}" },
      "fields": [
        { "name": "Done", "value": "{{ data.task.done | bool_emoji }}", "inline": true },
        { "name": "Due", "value": "{{ data.task.due_date | discord_time: \"R\" }}", "inline": true }
      ],
      "fields_each": {
        "path": "data.task.labels",
        "name": "Label",
        "value": "{{ item.title }}",
        "inline": true
      }
    }
  ]
}
```

- **`color`** may render to a name (`red`), `#rgb`, `#rrggbb`, `0xrrggbb` or a decimal number.
- **`timestamp`** may render to an ISO date or a unix timestamp in seconds or milliseconds.
- **`fields_each`** adds one field per item of the list at `path`; `item` is the current item.
- Empty strings are left out. An author needs a name, and a footer icon needs footer text.

{% endraw %}

### Safety limits

Templates run on the server, so each render is limited in time and memory. A template that loops forever fails with a render error instead of hanging the worker. Messages are always sent with `allowed_mentions: { "parse": [] }`, so text from a payload can never ping `@everyone`, `@here`, roles or users.
