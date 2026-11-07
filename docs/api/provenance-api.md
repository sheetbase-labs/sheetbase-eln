# Provenance API

Three things sit together here: **Reproduce** (run a finished pipeline run
again and compare), **lineage events** (OpenLineage, sent to a lineage service)
and the **event stream** ([its own page](event-stream.md)).

## Reproduce a pipeline run

```
POST /api/pipelines/reproduce
{ "runId": "…", "tolerance": 1e-9 }
```

Runs a finished (`succeeded`) pipeline run again in scratch space from what it
pinned: the published version, the parameters, the inputs (checked against the
digests the run recorded) and the sandbox image. Nothing is published and no
run, dataset version or output is left behind. The result is compared with the
original and a verdict is kept:

- `matches`: the same rows. When the run's digest is identical the answer is
  immediate (`compared: "digest"`); otherwise the rows are compared against the
  output dataset version (`dataset_version`) or the stored preview (`preview`).
- `differs`: the rows changed. `summary` has the counts (`originalRows`,
  `reproducedRows`, `changedRows`, `addedRows`, `removedRows`, `changedColumns`,
  `largestDelta`) and `changes` the first differences. `tolerance` is how close
  two numbers must be to count as equal (default 1e-9).
- `failed`: it could not be run again, with `error_code` and `error_message`.

Needs `pipelines:write` and a personal token (the reproduction is attributed to
the person), or a signed-in session, and the member must be able to run
pipelines. Errors: `401`, `403` (`workspace_membership_required`), `404`
(`run_not_found`), `409` (`run_not_finished`), `429`.

Read results from the `pipeline_reproductions` table (`lab:read`):

```
GET /api/db/pipeline_reproductions?source_run_id=eq.<run>&order=created_at.desc
```

Each reproduction sends `pipeline.run.reproduced` (webhooks and the event
stream) with `data.status` and `data.runId`.

In the app: **Reproduce** on a run's page, the **Reproduced** column in run
history, and **Made by** on a dataset version in Snapshots. The assistant offers
a **Reproduce run** card (`sheetbase.pipeline.reproduce`) and reads past results
from the reproductions area. A pipeline step can ask for one with the
**Reproduce a run** action (`request_pipeline_reproduction`): the request is
queued and the server runs it as the person who owns the pipeline's run,
within seconds.

## Lineage events (OpenLineage)

Sheetbase can post [OpenLineage](https://openlineage.io) `RunEvent`s (spec
2-0-2) for pipeline runs, dataset imports, instrument runs, plate runs and
liquid-handler worklists to a lineage service such as Marquez.

It is off until someone who manages integrations adds an endpoint in
**Settings → Integrations → Lineage events** (or with `save_lineage_target`):

| Setting           | Meaning                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Address           | Where events are posted (`http` or `https`).                                                                      |
| Namespace         | The namespace of jobs and datasets in the other service (default `sheetbase`).                                    |
| Header name/value | An authentication header, for example `Authorization` or `X-Api-Key`. The value is stored sealed and never shown. |
| Sending           | Off by default. A new endpoint starts at the newest change, so switching it on never replays history.             |

Events are `START`, `COMPLETE` and `FAIL`. A run's output datasets carry the
`schema` facet, and where input and output columns have the same name, a
`columnLineage` facet. Each change is first written to an outbox
(`lineage_deliveries`) and sent from there, so a slow or down endpoint never
slows the app. A failed delivery waits longer each time and is given up after 8
tries (`lineage.delivery_failed`); **Retry failed** (or `retry_lineage_deliveries`)
puts them back. **Send test** posts a sample event and shows the answer.

Read endpoints with `lineage_targets` and the outbox with `lineage_deliveries`
(`lab:read`, and only for people who manage integrations). Change them with the
actions `save_lineage_target`, `delete_lineage_target` and
`retry_lineage_deliveries` (`lab:write`). The header value can only be set in
the app.

## Event stream

`GET /api/events/stream` follows every catalogued change as CloudEvents, as JSON
pages or a live stream. See [event-stream.md](event-stream.md).
`set_event_stream_retention` (`lab:write`) sets how long events are kept.
