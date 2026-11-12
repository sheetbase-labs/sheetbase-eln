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

Both operations are also on MCP (`sheetbase.lab.act`), in the assistant
(`sheetbase.pipeline.convert`, `sheetbase.pipeline.duplicate`) and as pipeline
actions.
