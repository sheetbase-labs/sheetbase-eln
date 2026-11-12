# Simple pipelines

A Simple pipeline is a `When / if / then` recipe (the "then" part is `actions`). The recipe is kept on the
pipeline version as `configuration.recipe`, beside the typed `steps` it
compiled to. The runner only ever runs the steps; the recipe is what the Simple
editor shows. Everything here is also in `pipelines-api.md`; this page covers
what Simple adds.

## Writing a Simple version

Create a version with `create_pipeline_definition_version` (or update a draft
with `update_pipeline_definition_version_draft`) and send `mode: "simple"` and a
`recipe` object in the configuration, next to the compiled `steps`:

```json
{
  "configVersion": 2,
  "mode": "simple",
  "recipe": {
    "when": { "datasetId": "…" },
    "join": "and",
    "conditions": [
      { "column": "Turbidity", "operator": "above", "value": "10" }
    ],
    "actions": [{ "kind": "notify", "channel": "teams", "subscriptionId": "…" }]
  },
  "parameters": [],
  "inputs": [],
  "steps": [],
  "output": {}
}
```

The database refuses a Simple version with no `recipe`, a Standard or Advanced
version that still carries one, and a version that goes back to a simpler mode
than an earlier version of the same pipeline.

## `convert_pipeline_to_standard`

`POST /api/rpc/convert_pipeline_to_standard` with `p_workspace_id` and
`p_definition_id`. One way: the recipe is dropped, the steps it compiled to stay,
and the condition values stay as parameters (`condition_1`, …) with their
defaults. The draft is converted in place; with no draft, the newest version is
copied into a new Standard draft. The published version keeps running until the
draft is published. Needs `pipelines:write`. Sends `pipeline.version.updated`
or `pipeline.version.created`.

## `duplicate_pipeline_definition`

`POST /api/rpc/duplicate_pipeline_definition` with `p_workspace_id`,
`p_version_id`, `p_key` and `p_name`. Makes a new pipeline whose first draft is
a copy of that version, in the mode it was written in. Runs, starts and history
stay with the original. Needs `pipelines:write`. Sends `pipeline.created` and
`pipeline.version.created`.

## `create_inbox_item`

`POST /api/rpc/create_inbox_item` with `p_workspace_id`, `p_user_id` and
`p_title`, and optionally `p_body`, `p_dataset_id`, `p_dataset_version_id` and
`p_due_at`. Leaves an item in that person's Inbox until they open it. The
Simple catalogue's "Assign a task in Inbox" and "Mark the snapshot for review"
call it. Read them back from `pipeline_inbox_items`. Needs `pipelines:write`.
Sends `pipeline.inbox_item.created`.

These operations are also on MCP (`sheetbase.lab.act`), in the assistant
(`sheetbase.pipeline.convert`, `sheetbase.pipeline.duplicate`, `sheetbase.inbox.list_expiring_stock`) and as pipeline
actions.

## `list_expiring_materials`

Looks at the materials that expire within `p_days` days (1 to 365, default 30; not quarantined, expired, consumed or depleted) and leaves one Inbox item for `p_user_id` with a line for each lot, soonest first, with no limit on how many. Leaves nothing when nothing expires. Stewards and anyone who can edit in the workspace. Returns `{ count, created, inboxItemId }`. Sends `pipeline.inbox_item.created` when it leaves an item.

A Simple pipeline uses it as "tell _person_ about stock expiring within _N_ days", started on a weekly schedule.
