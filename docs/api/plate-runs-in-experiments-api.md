# Plate runs in experiments API

A plate run can belong to an experiment, and an experiment's notebook can show
the run live: the plate map, Z′ and the hits beside the results.

## Actions

### `link_plate_run`

Attaches a plate run to an experiment, moves it to another, or takes it out
when no experiment is given. The run takes the experiment’s project, so the
experiment’s team can read the result. Also a pipeline action.

Scope: `projects:write`.

| Argument           | Type |                                                                     |
| ------------------ | ---- | ------------------------------------------------------------------- |
| `p_plate_run_id` * | uuid | The plate run.                                                      |
| `p_record_id`      | uuid | The experiment. Leave it out to take the run out of its experiment. |

Returns the plate run. An archived run cannot be changed.

## The `plate_run` notebook block

Show a run in an experiment’s notebook with `insert_block` and the block type
`plate_run`:

```json
{
  "type": "plate_run",
  "payload": { "runId": "<plate run id>", "view": "hits" }
}
```

`view` is one of `hits`, `normalised`, `raw` or `roles`. The run must be in the
notebook’s workspace. The block always shows the run as it is now. The database
keeps a small pinned copy (name, quality, Z′, hits) in `payload.pinned`, which
a submitted revision keeps; callers cannot write it.

## Events

`plate_run.linked` (family `inventory`) carries `plateRunId`, `reference`,
`name`, `recordId` and `previousRecordId`. `plate_run.unlinked` carries
`plateRunId`, `reference`, `name` and `previousRecordId`. Both can start a
pipeline.

## From the assistant and MCP

Ask the assistant to add a plate run to an experiment and it offers a confirm
card (`sheetbase.plate.add_to_experiment`) that links the run and adds the
block. The same operation is an MCP action through `sheetbase.lab.act`.
