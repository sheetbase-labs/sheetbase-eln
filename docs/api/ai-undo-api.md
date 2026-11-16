# Undo for what the assistant changed

One button rolls back everything an assistant card or plan changed. It is on
the assistant chat (each card, and each multi-step plan, once it has run), and
on every other surface: the assistant itself ("undo that"), MCP, the Python SDK,
pipelines and webhooks (see [lab-api.md](lab-api.md) for scopes and how tokens
work).

Everything here needs a **personal token**: a change set belongs to the person
who approved it, and a service credential has no person. Undo runs as that
person, so their permissions apply and each thing put back writes its own audit
entry (and sends its own event, such as `record.archived`).

## How it works

A **change set** remembers the stretch of the audit trail (`change_events`)
that one card or plan wrote as the person. It holds no copy of the changes:
what was made is read back from the audit trail. While a set is open, the first
edit to each existing record also keeps that record's before-image, so its
fields can be put back.

The chat opens a set before a card or plan runs and closes it afterwards. A
plan that pauses for an approval and then carries on adds another window to the
same set, so one undo covers the whole plan. Anything you did yourself in
between is not part of the set unless it happened while a window was open.

## What can be undone

| What the set did                      | Undo does                                                     |
| ------------------------------------- | ------------------------------------------------------------- |
| Made a record (experiment, sample, …) | Archives it (it can be restored)                              |
| Made a project                        | Archives it                                                   |
| Made a booking                        | Cancels it                                                    |
| Added a block to an older record      | Removes the block                                             |
| Edited fields of an older record      | Puts the title, tags, custom fields, assignee and folder back |

Things inside a record the set made (its parts, plate, blocks, comments) go
with it. Cards and plans that make other kinds of change, for example posting a
comment, linking a record, placing a sample or ordering stock, are listed in the
preview as **stays**: they cannot be taken back, so the undo is refused.

## What stops it

Undo is **all or nothing**. If any item is blocked, nothing is touched and the
preview says why:

- the record is **signed**, **locked**, **submitted for review**, or has been
  through review (`in_review`, `approved`, `returned`);
- **someone else changed it afterwards** (the reason names them), or you changed
  it again after the plan ran;
- a status or project move, which cannot be put back here;
- the change is of a kind that cannot be taken back (see above).

If your own permissions no longer allow one of the actions, the database
refuses it and the whole undo is rolled back.

## Operations

### `begin_ai_change_set`

Opens a window on the audit trail so what you change next can be undone as one
set. Returns the set.

| Argument   | Type | Notes                                            |
| ---------- | ---- | ------------------------------------------------ |
| `p_title`  | text | What the set is, in a few words (200 characters) |
| `p_kind`   | text | `card` or `plan`; defaults to `plan`             |
| `p_set_id` | uuid | A set of yours to carry on (a plan that paused)  |

### `finish_ai_change_set`

Closes the window. A set that changed nothing is dropped and `null` comes back.

| Argument      | Type | Notes                                                                                                        |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `p_set_id`    | uuid | Your set                                                                                                     |
| `p_untracked` | json | Steps whose changes the audit trail does not carry, as `[{"title": "…"}]`; the preview lists them as staying |

### `preview_ai_undo`

Says what undoing would do. Changes nothing.

```json
{
  "setId": "…",
  "title": "Set up the dose-response experiment",
  "kind": "plan",
  "status": "applied",
  "canUndo": true,
  "toUndo": 3,
  "blocked": 0,
  "items": [
    {
      "kind": "record",
      "verb": "Archive",
      "label": "EXP-4302 Dose response",
      "state": "ok",
      "href": "/records/…"
    },
    {
      "kind": "booking",
      "verb": "Cancel",
      "label": "CAL-0914 Plate reader",
      "state": "ok"
    },
    {
      "kind": "fields",
      "verb": "Put back",
      "label": "SMP-2232 R1.0 flask A",
      "state": "ok",
      "changes": [{ "field": "batch", "from": "R1.0", "to": "R2.0" }]
    }
  ]
}
```

Each item is `ok` (will be put back), `already` (nothing to do) or `blocked`
with a `reason`. `canUndo` is true only when nothing is blocked and there is
something to put back.

### `undo_ai_change_set`

Puts everything back, all or nothing, and sends `assistant.changes.undone`.
Returns `{ "done": true, "undone": 3, "preview": … }`, or, when something is
blocked, `{ "done": false, "preview": … }` with nothing touched.

| Argument   | Type | Notes    |
| ---------- | ---- | -------- |
| `p_set_id` | uuid | Your set |

## Reading your sets

`GET /api/db/ai_change_sets` (`lab:read`; the `ai_change_sets` table), or `sheetbase.canonical.read` over
MCP, lists your sets newest first: `id`, `title`, `kind` (`card` or `plan`),
`status` (`applied` or `undone`), `created_at` and `undone_at`.

## Assistant

- `sheetbase.changes.recent` reads what the assistant changed for you recently
  and, for each, whether it can still be undone and what stops it.
- `sheetbase.changes.undo` proposes an undo card that lists exactly what would
  be put back. Nothing happens until you press **Undo these changes**. Leave
  `changeSetId` out for the latest set. If the undo is refused, the assistant
  says why instead of offering a card.

## Events

`assistant.changes.undone` (webhook, live feed and pipeline trigger) carries
`changeSetId`, `title` and `kind`. It is sent in addition to the events of each
thing that was put back.

## Pipelines

`undo_ai_change_set` is a pipeline action, so a pipeline can undo a set it knows
the id of.
