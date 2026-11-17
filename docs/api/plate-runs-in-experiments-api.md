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

### `add_step_plate_run`

Puts a plate run in the protocol step it was run for. The run joins the step’s
experiment, its `plate_run` block goes straight after the step (or after the
step’s last piece of data), and the step reads in progress. A block the notebook
already had for the run, at the end say, is moved into the step. A step is a
`procedure_step` block; the block names it in `stepBlockId`, as a number added
with `add_step_result` does. Finish the step with `set_step_done` once its last
plate is in. Also a pipeline action.

Scope: `projects:write`.

| Argument           | Type |                                               |
| ------------------ | ---- | --------------------------------------------- |
| `p_block_id` *     | uuid | The protocol step (a `procedure_step` block). |
| `p_plate_run_id` * | uuid | The plate run.                                |

Returns `{ block_id, step_block_id, record_id, plate_run_id, already_there }`.
Sends `step_result` (see the event catalogue) with `resultType` `plate_run`.
`record_steps` counts the plate run in the step’s `result_count`.

### `publish_plate_run_measurements`

Gives a plate run’s results to its samples. For a run read by a standard curve
(`config.method` of `quantify`), each sample that read inside the standards, and
is linked to a sample record, gets its concentration as a sample measurement, so
the result shows on the sample’s page. The dilution is already applied. Running
it again replaces the measurements this run wrote earlier; measurements from
anywhere else are left alone. Also a pipeline action.

Scope: `lab:write`.

| Argument           | Type |                                                                                       |
| ------------------ | ---- | ------------------------------------------------------------------------------------- |
| `p_plate_run_id` * | uuid | The plate run.                                                                        |
| `p_name`           | text | What the measurement is called, such as "Capsid titre". Defaults to the assay’s name. |

Returns `{ published, skipped }`. Sends `plate_run.measurements_published`.

### Reading a plate by a standard curve

`config.method` is `screen` (the default: Z′ and hits against the plate’s
controls) or `quantify` (a standard curve is fitted to the wells with the role
`standard`, and each sample is read off it). An assay’s design remembers the
method with the rest of its setup (`save_plate_design_assay_setup`), so an
ELISA is quantified every time and a compound screen is screened. Quantify also
reads `config.dilutionFactor` (how far samples were diluted when a well does
not say) and `config.qc.standardR2Min` (the curve passes at this R², default
0.98). A well’s own `dilution` wins over the config’s.

The analysis then has a `quantify` object: `curve` (the fitted parameters,
the standards, `r2`, the range the curve covers), `failure` (`no_standards`,
`too_few_standards` or `fit_failed`) and `samples`, one per sample with its
`result` (concentration times dilution), `concentration`, `dilution`, `n` wells
in range, `cv`, and a `status` of `ok`, `below_range`, `above_range`,
`no_signal` or `no_curve`. A sample outside the standards has no number.

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
`zPrimeFail`, `signalToBackgroundMin`, `controlCvMax`, `standardR2Min`),
`method` (`screen` or `quantify`), `dilutionFactor` and `curveModel` (`4pl`
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
