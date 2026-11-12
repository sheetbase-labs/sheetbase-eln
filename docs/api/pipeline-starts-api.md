# Pipeline starts and runs API

What starts a pipeline, and what each start did. A pipeline's starts are its schedules (`create_pipeline_schedule` and friends, see [pipelines-api.md](pipelines-api.md)), its signed webhook and new snapshots (an `event` schedule on `dataset.versioned`). The rules here sit across all of them. Reads need `pipelines:read`; the one write needs `pipelines:write` and acts as the person the token belongs to. It is on `sheetbase.lab.act` over MCP (Ask by default), in the Python and TypeScript SDKs, and the assistant offers it as a card.

## Tables and columns

| Where                              | Scope            | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline_definitions.start_rules` | `pipelines:read` | The rules across the pipeline's starts: `conditionsMatch`, `window`, `minNewRows`, `waitMinutes`, `whileRunning` and `missedRuns`. `{}` means no extra rules: every start runs.                                                                                                                                                                                                                                                                                                                                   |
| `pipeline_schedule_activity`       | `pipelines:read` | What each start did, newest first by `occurred_at`. `kind` is `started` (with `run_id`), `batched` (waiting to join the next run), `skipped_condition` (outside the hours or too few new rows), `skipped_overlap` (a run was going), `skipped_unchanged`, `skipped_missed`, `skipped_no_version`, `input_unresolved` or `start_failed`. `source` is `event` (a snapshot or other event), `schedule` or `webhook`; `label` says what was heard, such as `DS-0311 S-15`; `schedule_id` is empty for a webhook call. |

## `set_pipeline_start_rules`

Sets the rules across all of a pipeline's starts (new snapshots, its webhook and its schedules). `p_rules` is:

```json
{
  "conditionsMatch": "all",
  "window": {
    "days": "weekdays",
    "from": "07:00",
    "to": "19:00",
    "timeZone": "Europe/London"
  },
  "minNewRows": 8,
  "waitMinutes": 2,
  "missedRuns": "run_once"
}
```

- `window` (or `null`): a start outside these days and hours is skipped. `days` is `daily`, `weekdays` or `weekends`; the window opens at `from` and closes just before `to`, in `timeZone`.
- `minNewRows` (or `null`): a snapshot that adds fewer new rows than this is skipped. A schedule or a webhook passes this condition.
- `conditionsMatch`: with `all`, every condition that applies must hold; with `any`, one is enough.
- `waitMinutes`: after a snapshot, wait this long for another before running, so a batch of imports runs once, on the newest snapshot. The snapshots that waited are logged as `batched`.
- `whileRunning`: only `skip`. A start while any run of the pipeline is going, including one waiting for a person, is skipped.
- `missedRuns`: `run_once` catches up with one run after an outage; `skip` carries on from now.

Send `{}` to go back to no extra rules. The rules are replaced as a whole. Returns the pipeline, and sends `pipeline.updated`. It is not a pipeline action: a pipeline that could change the rules that start it could widen its own reach.

Scope: `pipelines:write`. Returns `row:pipeline_definitions`.

| Argument            | Type | Notes                                      |
| ------------------- | ---- | ------------------------------------------ |
| `p_workspace_id` *  | uuid | Your workspace id.                         |
| `p_definition_id` * | uuid | The pipeline, from `pipeline_definitions`. |
| `p_rules` *         | json | The rules, as above; `{}` clears them.     |
