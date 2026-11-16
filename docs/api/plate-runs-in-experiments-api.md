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

### `save_plate_design_assay_setup`

Remembers how an assay is read on its plate design, so the next plate of the
same assay is analysed the same way with nothing typed again. When a plate run
is given, it is pointed at the design as well. Also read as the `assay_setup`
column of the `plate_designs` table. Not a pipeline step (it takes a JSON
setup); a pipeline can start on its event.

Scope: `lab:write`.

| Argument         | Type  |                                                                                                                                            |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `p_design_id` *  | uuid  | The plate design (the assay).                                                                                                              |
| `p_setup` *      | jsonb | `{ "config": { … }, "negativeColumns": "1", "positiveColumns": "11-12" }`. `config` is the plate assay settings; the columns are optional. |
| `p_plate_run_id` | uuid  | A plate run to point at the design too.                                                                                                    |

`config` holds `normalisation` (`percent_effect`, `percent_of_negative`,
`z_score`, `robust_z`, `none`), `effectDirection`, `subtractBlank`, `hit`
(`kind`, `threshold`, `direction`, `minReplicates`), `qc` (`zPrimeMin`,
`zPrimeFail`, `signalToBackgroundMin`, `controlCvMax`) and `curveModel` (`4pl`
or `5pl`). Anything missing is filled from the defaults when it is read. Other
keys are dropped. Returns the design. An archived design or run cannot be
changed.

The New plate run dialog, in an experiment, starts on the design the
experiment’s last plate followed and fills the controls and settings from this
setup; a plate saved with no remembered setup offers to remember its own.

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

`plate_design.assay_setup_saved` (family `inventory`) carries `plateDesignId`,
`name`, `plateRunId`, `normalisation` and `curveModel`. It can start a pipeline.

## From the assistant and MCP

Ask the assistant to add a plate run to an experiment and it offers a confirm
card (`sheetbase.plate.add_to_experiment`) that links the run and adds the
block. Ask it to remember how a plate was read and it offers a card
(`sheetbase.plate.remember_setup`) that saves the run’s controls and settings
on an assay design, or makes a new assay of that name. The same operation is an MCP action through `sheetbase.lab.act`.
