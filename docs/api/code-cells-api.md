# Code cells API

A **code cell** is a notebook block (`code_cell`) that runs Python or SQL on
dataset versions and keeps the output with the code. Python runs in the same
digest-pinned runner as pipeline steps; SQL runs in the pipeline SQL sandbox with
each input as a temporary table, read-only.

## The block

```
{ "type": "code_cell",
  "payload": {
    "language": "python",
    "source": "def transform(inputs, parameters):\n    return inputs['samples']\n",
    "inputs": [ { "alias": "samples", "datasetVersionId": "…" } ] } }
```

Up to five inputs, named with letters, digits and underscores. In Python,
`inputs['samples']` is a list of rows (one dict per row) and the code defines
`transform(inputs, parameters)` returning a list of rows or a DataFrame. In SQL,
`samples` is a table, and the cell is one `SELECT` (or `WITH`) statement.

Insert one with `sheetbase.notebook_block.insert` (type `code_cell`) or the
notebook API; change the code with `sheetbase.notebook_block.update`. The
assistant does both from a card, so it can write a first version or fix a failing
one: ask it, review the card, and press Run.

## Run it

Running happens in the app, as the signed-in person, so what ran and who ran it
is always on record:

```
POST /api/notebook/code-cell
{ "action": "run", "recordId": "…", "blockId": "…", "language": "sql",
  "source": "select * from samples limit 50",
  "inputs": [ { "alias": "samples", "datasetVersionId": "…" } ] }
```

The inputs are read as the person (they must be able to see the datasets), up to
50,000 rows each. The response is the output kept in the block: `reference`
(`CC-0004`), `status` (`ok` or `error`), `columns`, the first 100 `rows`,
`rowCount`, `source`, `sourceDigest`, `outputDigest` (over every row), `runtime`
(the image digest for Python, `postgres-sandbox` for SQL), the `inputs` with
their digests and `errorMessage` for a failure. A cell that cannot run because
the runner is not set up answers `503` and records nothing; a cell whose code
fails is recorded as a failed run.

The block keeps the last output, so a notebook that is signed holds the code, the
output, the inputs' digests and the image together. The page says when the code or
inputs were changed after the output was made.

## Run it again

```
POST /api/notebook/code-cell
{ "action": "reproduce", "recordId": "…", "runId": "<an earlier run>" }
```

Runs the earlier run's own code on its own pinned inputs again and records
whether the output came out the same: `reproducedFrom.matches` is true when the
digest is equal, or when a comparison within tolerance finds no change (the
`diff` is kept with the run). Needs permission to edit the experiment.

## Read the runs

`code_cell_runs` (`lab:read`) holds every run with `source`, `source_sha256`,
`inputs`, `output` (first rows), `output_digest`, `runtime`, `environment`, `logs`,
`error_message`, `duration_ms` and, for a reproduction, `reproduces_run_id`,
`matches` and `diff`. `dataset_version_rows_json` reads a dataset version as rows
(`lab:read`).

Events: `code_cell.run` and `code_cell.reproduced`.
