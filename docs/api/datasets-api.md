# Datasets, measurement tables and intake API

Datasets, the measurement tables they are built on, and the files that come in
from instruments and uploads are reachable the same way as the rest of the lab:
with a token, over MCP (`sheetbase.lab.act`), from the assistant, from a
pipeline step and through webhooks. Querying, committing, snapshotting and
archiving datasets are in [external-api.md](external-api.md); connectors,
parsers and imports are in [lab-api.md](lab-api.md) with the instruments. This
page covers the rest. Webhook events are in
[event-catalogue.md](event-catalogue.md); the full request and response shapes
are in the OpenAPI document under the **Lab** tag.

## Scopes and who may do what

| Scope            | Lets you                                                                        |
| ---------------- | ------------------------------------------------------------------------------- |
| `datasets:read`  | Read the dataset tables below and call the dataset lookups.                     |
| `datasets:write` | Flag values, plan rows, keep snapshots, commit large batches, add files.        |
| `schema:read`    | Preview a change to a measurement table.                                        |
| `schema:write`   | Build measurement tables: create, start a version, change a draft.              |
| `schema:publish` | Publish or retire a measurement table, change a dataset's unit or use.          |
| `lab:read`       | Read intake problems, raw instrument files and the export log.                  |
| `lab:write`      | Record and close intake problems, file a connector's dataset, attach raw files. |

- Actions run as the person a **personal token** belongs to. The database
  still checks that person's own rights in the workspace: building a
  measurement table needs schema editing, publishing needs schema publishing,
  retiring needs schema retiring, the same as the Measurement tables page.
  A token needs both the scope and the person's right.
- MCP agents use the same actions through `sheetbase.lab.act`, under the
  workspace's agent permissions (run, ask first or never).
- Files are uploaded with the files API first; `add_dataset_import_file` and
  `attach_instrument_raw_file` then take the uploaded file's id. Neither takes
  a storage key from the caller.
- Approving a measurement table version (where the workspace asks for
  approval) stays with a person in the app; publishing waits for it.

```bash
# Open flags on a dataset
curl -H "Authorization: Bearer $TOKEN"   "https://app.example/api/db/dataset_value_flags?dataset_id=eq.<dataset id>&cleared_at=is.null"

# Start a measurement table and publish it
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   https://app.example/api/db/rpc/create_dataset_schema_definition   -d '{"p_workspace_id":"<workspace id>","p_key":"elisa_plate","p_name":"ELISA plate","p_fields":[{"key":"well","label":"Well","logical_type":"text"},{"key":"od450","label":"OD450","logical_type":"decimal"}]}'
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   https://app.example/api/db/rpc/publish_dataset_schema_version   -d '{"p_schema_version_id":"<schema_version_id from the first call>"}'
```

## Tables

| Table                    | Scope           | What it holds                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataset_rows`           | `datasets:read` | The rows of a dataset as they are now. `revision` goes up with every change; `status` is `recorded`, or `planned` for a row waiting for its measurement (see `plan_dataset_row`).                                                                                                                                                      |
| `dataset_row_values`     | `datasets:read` | One value of a dataset row: the row, the measurement-table field it fills and the value in the column for its type. `ordinal` orders the values of a list field.                                                                                                                                                                       |
| `dataset_version_rows`   | `datasets:read` | Which rows, at which revision, a dataset snapshot (version) holds.                                                                                                                                                                                                                                                                     |
| `dataset_version_values` | `datasets:read` | The values a dataset snapshot kept, laid out like `dataset_row_values`. A snapshot never changes, so these are what an analysis or a signed record cites.                                                                                                                                                                              |
| `dataset_value_flags`    | `datasets:read` | Flags on single values: `out_of_range`, `missing_unit`, `above_curve` or `high_cv`, with the reason. `source` is `manual` or `system` (set by a rule, with `system_rule`, the value checked and the threshold). A flag is open until `cleared_at` is set. Add and clear them with `flag_dataset_value` and `clear_dataset_value_flag`. |
| `dataset_bulk_commits`   | `datasets:read` | Large row commits made with `commit_dataset_row_batch_atomic`: who made each, its idempotency key and the result, so a retry returns the first answer.                                                                                                                                                                                 |
| `dataset_import_files`   | `datasets:read` | Files uploaded to be imported into a dataset, and whether they were read: `status` is `stored`, `parsed` or `failed` (with `parse_error` and `parser_failure`). Add one from a file you uploaded with `add_dataset_import_file`.                                                                                                       |
| `intake_failures`        | `lab:read`      | Files a connector (`source` `agent`) or an upload could not bring in, and why: `code` and `message`, the parser it tried and how many attempts. `status` is `open`, `resolved` or `dismissed`. Record one with `record_intake_failure`; close one with `resolve_intake_failure`.                                                       |
| `instrument_raw_files`   | `lab:read`      | The raw files an instrument run produced, kept as they came off the instrument. `file_id` is the stored file (download it from the files API); `ingestion_status` is `pending`, `complete`, `partial` or `failed`. Attach one with `attach_instrument_raw_file`.                                                                       |
| `data_exports`           | `lab:read`      | A log of data taken out of Sheetbase: what was exported (`object_type`, `object_id`), in which format, how many rows and by whom.                                                                                                                                                                                                      |

## Actions and lookups

### Measurement tables

#### `create_dataset_schema_definition`

Create a measurement table. Creates a measurement table (the columns a dataset is made of) with a first draft version holding `p_fields`. `p_key` is lower case letters, digits and _, unique in the workspace. Publish the draft with `publish_dataset_schema_version` before datasets use it. Returns `{ schema_definition_id, schema_version_id }`. Sends `measurement_table.created` and `measurement_table.version.created`.

Scope: `schema:write`. Also a pipeline action.

| Argument           | Type |                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id; a pipeline step fills it in.                                                                                                                                                                                                                                                                                                               |
| `p_key` *          | text |                                                                                                                                                                                                                                                                                                                                                               |
| `p_name` *         | text | Name.                                                                                                                                                                                                                                                                                                                                                         |
| `p_description`    | text | A description.                                                                                                                                                                                                                                                                                                                                                |
| `p_fields`         | json | JSON array of fields, each `{ key, label, logical_type, nullable?, description?, quantity?, category?, validation?, default_value?, relationship? }`. `logical_type` is `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category`, `quantity` or `reference`. Give an existing field its `field_id` to keep it the same field across versions. |

#### `create_dataset_schema_subtype`

Create a measurement table that extends another. Creates a measurement table under `p_parent_id`: it starts with every field of its parent and adds its own. Returns `{ schema_definition_id, schema_version_id }`. Sends `measurement_table.created`.

Scope: `schema:write`. Also a pipeline action.

| Argument        | Type |                  |
| --------------- | ---- | ---------------- |
| `p_parent_id` * | uuid | Parent entry id. |
| `p_key` *       | text |                  |
| `p_name` *      | text | Name.            |
| `p_description` | text | A description.   |

#### `create_dataset_structure_from_file`

Make a published measurement table from a file’s columns. Makes and publishes a measurement table straight from the columns of a file, the way the import page does on a first import. Each field is `{ key, label, logical_type }` with `logical_type` one of `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`. Needs dataset work access, not schema editing. Returns the table and its published version.

Scope: `datasets:write`. Also a pipeline action.

| Argument           | Type |                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id; a pipeline step fills it in.                                                                                                                                                                                                                                                                                                               |
| `p_name` *         | text | Name.                                                                                                                                                                                                                                                                                                                                                         |
| `p_fields` *       | json | JSON array of fields, each `{ key, label, logical_type, nullable?, description?, quantity?, category?, validation?, default_value?, relationship? }`. `logical_type` is `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category`, `quantity` or `reference`. Give an existing field its `field_id` to keep it the same field across versions. |

#### `create_next_dataset_schema_version`

Start a new draft version of a measurement table. Starts a draft version from the latest one, with the same fields, to change and publish. Returns `{ schema_version_id, version }`. Sends `measurement_table.version.created`.

Scope: `schema:write`. Also a pipeline action.

| Argument                   | Type |     |
| -------------------------- | ---- | --- |
| `p_schema_definition_id` * | uuid |     |

#### `replace_dataset_schema_version_fields`

Set the fields of a draft measurement table version. Replaces every field of a draft version with `p_fields`. Only drafts change; a draft waiting for approval is locked. `p_expected_revision` refuses the change if someone else changed the draft since you read it. Returns the version. Sends `measurement_table.version.updated`.

Scope: `schema:write`. Also a pipeline action.

| Argument                | Type   |                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_schema_version_id` * | uuid   |                                                                                                                                                                                                                                                                                                                                                               |
| `p_fields` *            | json   | JSON array of fields, each `{ key, label, logical_type, nullable?, description?, quantity?, category?, validation?, default_value?, relationship? }`. `logical_type` is `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category`, `quantity` or `reference`. Give an existing field its `field_id` to keep it the same field across versions. |
| `p_expected_revision`   | bigint | The revision of the draft you last read. A change made since is refused instead of overwritten.                                                                                                                                                                                                                                                               |

#### `publish_dataset_schema_version`

Publish a measurement table version. Publishes a draft version so datasets can use it; the version before it is superseded. Refused while the workspace asks for an approval and none has been given. Returns the version. Sends `measurement_table.version.published`.

Scope: `schema:publish`. Also a pipeline action.

| Argument                | Type |     |
| ----------------------- | ---- | --- |
| `p_schema_version_id` * | uuid |     |

#### `delete_dataset_schema_version`

Discard a draft measurement table version. Discards a draft version that was never published. Published versions are kept for good. Sends `measurement_table.version.deleted`.

Scope: `schema:write`. Also a pipeline action.

| Argument                | Type |     |
| ----------------------- | ---- | --- |
| `p_schema_version_id` * | uuid |     |

#### `retire_dataset_schema_definition`

Retire a measurement table. Stops new datasets from using a measurement table. Datasets that use it keep their data and can still be read. Undo with `restore_dataset_schema_definition`. Returns the table. Sends `measurement_table.retired`.

Scope: `schema:publish`. Also a pipeline action.

| Argument                   | Type |     |
| -------------------------- | ---- | --- |
| `p_schema_definition_id` * | uuid |     |

#### `restore_dataset_schema_definition`

Restore a retired measurement table. Brings a retired measurement table back: active when it has a published version, otherwise a draft. Returns the table. Sends `measurement_table.restored`.

Scope: `schema:publish`. Also a pipeline action.

| Argument                   | Type |     |
| -------------------------- | ---- | --- |
| `p_schema_definition_id` * | uuid |     |

#### `reparent_dataset_schema`

Change what a measurement table extends. Makes a measurement table extend `p_parent_id`, or no table when it is null. Its draft picks up the parent’s fields. Returns the table. Sends `measurement_table.updated`.

Scope: `schema:write`. Also a pipeline action.

| Argument            | Type |                  |
| ------------------- | ---- | ---------------- |
| `p_definition_id` * | uuid |                  |
| `p_parent_id` *     | uuid | Parent entry id. |

#### `preview_dataset_schema_evolution`

Preview a change to a published measurement table. Says what changing a published version to `p_fields` would do: which fields are added, renamed or retired, whether it is safe for the datasets that use it, and what blocks it. Changes nothing.

Scope: `schema:read`.

| Argument                | Type |                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_schema_version_id` * | uuid |                                                                                                                                                                                                                                                                                                                                                               |
| `p_fields` *            | json | JSON array of fields, each `{ key, label, logical_type, nullable?, description?, quantity?, category?, validation?, default_value?, relationship? }`. `logical_type` is `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category`, `quantity` or `reference`. Give an existing field its `field_id` to keep it the same field across versions. |

#### `apply_dataset_schema_evolution`

Change a published measurement table in one step. Makes and publishes the next version from `p_fields` in one step, when the preview says it is safe. `p_idempotency_key` makes a retry return the first answer. Returns the preview and the published version.

Scope: `schema:publish`. Also a pipeline action.

| Argument                | Type   |                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_schema_version_id` * | uuid   |                                                                                                                                                                                                                                                                                                                                                               |
| `p_fields` *            | json   | JSON array of fields, each `{ key, label, logical_type, nullable?, description?, quantity?, category?, validation?, default_value?, relationship? }`. `logical_type` is `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category`, `quantity` or `reference`. Give an existing field its `field_id` to keep it the same field across versions. |
| `p_idempotency_key` *   | text   | Any unique string; a retry with the same key and fields returns the first result.                                                                                                                                                                                                                                                                             |
| `p_expected_revision`   | bigint | The revision of the draft you last read. A change made since is refused instead of overwritten.                                                                                                                                                                                                                                                               |

#### `preview_dataset_model_upgrade`

Preview moving a dataset to another measurement table version. Says what moving a dataset to `p_target_version_id` would do to its rows and values, and whether anything blocks it. Changes nothing.

Scope: `datasets:read`.

| Argument                | Type |             |
| ----------------------- | ---- | ----------- |
| `p_dataset_id` *        | uuid | Dataset id. |
| `p_target_version_id` * | uuid |             |

#### `apply_dataset_model_upgrade`

Move a dataset to another measurement table version. Moves a dataset to `p_target_version_id` of its measurement table, carrying its values across. `p_expected_revision` is the dataset revision you previewed. Needs schema editing. Sends `dataset.updated`.

Scope: `schema:write`. Also a pipeline action.

| Argument                | Type   |                                                                                                 |
| ----------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `p_dataset_id` *        | uuid   | Dataset id.                                                                                     |
| `p_target_version_id` * | uuid   |                                                                                                 |
| `p_expected_revision` * | bigint | The revision of the draft you last read. A change made since is refused instead of overwritten. |

### Dataset values and snapshots

#### `dataset_list_summary`

List datasets with row and issue counts. The datasets you can see, newest first, with their row count, open flags, values out of range, fields missing a unit and review state. Filter by `p_project_id`; leave out archived ones with `p_include_archived` false.

Scope: `datasets:read`.

| Argument             | Type |                              |
| -------------------- | ---- | ---------------------------- |
| `p_project_id`       | uuid | Project id.                  |
| `p_include_archived` | bool |                              |
| `p_limit`            | int  | Most to return (default 20). |
| `p_offset`           | int  |                              |

#### `dataset_version_list`

List the snapshots of a dataset. Every snapshot (version) of a dataset, newest first, with its row count, checksum, who made it, what cites it and whether it is kept.

Scope: `datasets:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_dataset_id` * | uuid | Dataset id. |

#### `compare_dataset_versions`

Compare two dataset snapshots. The rows added, removed and changed between snapshot `p_version_a` and `p_version_b`, a page at a time.

Scope: `datasets:read`.

| Argument        | Type |                              |
| --------------- | ---- | ---------------------------- |
| `p_version_a` * | uuid |                              |
| `p_version_b` * | uuid |                              |
| `p_limit`       | int  | Most to return (default 20). |
| `p_offset`      | int  |                              |

#### `dataset_version_retention`

Why a dataset snapshot is kept, and until when. Why a snapshot will not be pruned: `cited_by_signed_record`, `notebook_import_evidence`, `kept` (with `keptUntil`), `active`, or `uncited_after_archive` when it can go.

Scope: `datasets:read`.

| Argument         | Type |                     |
| ---------------- | ---- | ------------------- |
| `p_version_id` * | uuid | Dataset version id. |

#### `keep_dataset_version`

Keep a dataset snapshot from being pruned. Keeps a snapshot for the workspace’s retention period, with a reason, so it is not pruned. Returns the snapshot. Sends `dataset.version.kept`.

Scope: `datasets:write`. Also a pipeline action.

| Argument         | Type |                     |
| ---------------- | ---- | ------------------- |
| `p_version_id` * | uuid | Dataset version id. |
| `p_reason` *     | text | Why, in a sentence. |

#### `dataset_value_context`

One dataset row with its values. One row of a dataset with its values keyed by field id, its revision and the measurement table version, as the peek in the app shows it.

Scope: `datasets:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_dataset_id` * | uuid | Dataset id. |
| `p_row_id` *     | uuid |             |

#### `dataset_sheet_options`

Sheets that can open a dataset. The published sheet definitions whose inputs fit this dataset, so you can open it in one.

Scope: `datasets:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_dataset_id` * | uuid | Dataset id. |

#### `analysis_dataset_version_flags`

The value flags a dataset snapshot kept. The value flags that were open when a snapshot was taken, as an analysis of that snapshot sees them.

Scope: `datasets:read`.

| Argument                 | Type |     |
| ------------------------ | ---- | --- |
| `p_dataset_version_id` * | uuid |     |

#### `flag_dataset_value`

Flag a dataset value. Flags one value in a dataset: `p_kind` is `out_of_range`, `missing_unit`, `above_curve` or `high_cv`, with a reason (up to 200 characters) and an optional comment. Returns the flag. Sends `dataset.value.flagged`.

Scope: `datasets:write`. Also a pipeline action.

| Argument         | Type |                             |
| ---------------- | ---- | --------------------------- |
| `p_dataset_id` * | uuid | Dataset id.                 |
| `p_row_id` *     | uuid |                             |
| `p_field_id` *   | uuid |                             |
| `p_kind` *       | text | Kind, as listed in the app. |
| `p_reason` *     | text | Why, in a sentence.         |
| `p_comment`      | text |                             |

#### `clear_dataset_value_flag`

Clear a flag on a dataset value. Clears an open flag, with an optional reason. Returns the flag. Sends `dataset.value.flag_cleared`.

Scope: `datasets:write`. Also a pipeline action.

| Argument      | Type |                     |
| ------------- | ---- | ------------------- |
| `p_flag_id` * | uuid |                     |
| `p_reason`    | text | Why, in a sentence. |

#### `recompute_dataset_system_flags`

Run the value checks on a dataset again. Runs the automatic checks (range, units, replicate CV) over every row again, opening and clearing system flags to match. Returns how many rows it checked.

Scope: `datasets:write`. Also a pipeline action.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_dataset_id` * | uuid | Dataset id. |

#### `set_dataset_column_unit`

Set the unit of a dataset column. Sets the unit of one field of a dataset (by `p_field_key`) with a reason. The dataset moves to a new measurement table version with that unit, and `missing_unit` flags on the column clear. Needs publishing rights. Sends `dataset.updated`.

Scope: `schema:publish`. Also a pipeline action.

| Argument         | Type |                       |
| ---------------- | ---- | --------------------- |
| `p_dataset_id` * | uuid | Dataset id.           |
| `p_field_key` *  | text |                       |
| `p_unit` *       | text | Unit of the quantity. |
| `p_reason` *     | text | Why, in a sentence.   |

#### `set_dataset_intended_use`

Set the intended use of a dataset. Sets what a dataset is for: `exploratory_research`, `controlled_development` or `regulated_record`, with a reason. Regulated datasets only take approved parsers. Needs publishing rights. Returns the dataset. Sends `dataset.updated`.

Scope: `schema:publish`. Also a pipeline action.

| Argument           | Type |                     |
| ------------------ | ---- | ------------------- |
| `p_dataset_id` *   | uuid | Dataset id.         |
| `p_intended_use` * | text |                     |
| `p_reason` *       | text | Why, in a sentence. |

#### `plan_dataset_row`

Add a planned row to a dataset. Adds a row that is waiting for its measurement, optionally with when it is due (`p_scheduled_at`) and a key to find it by (`p_planned_key`, such as a sample or timepoint). Committing values to it later records it. Returns the row. Sends `dataset.updated`.

Scope: `datasets:write`. Also a pipeline action.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_dataset_id` * | uuid | Dataset id. |
| `p_scheduled_at` | ts   |             |
| `p_planned_key`  | text |             |

#### `commit_dataset_row_batch_atomic`

Commit a large batch of dataset rows in one go. Commits more rows than `commit_dataset_row_batch` takes at once (it splits them into chunks) and keeps the whole batch or none of it. `p_expected_dataset_revision` refuses the commit if the dataset changed since; `p_idempotency_key` makes a retry return the first answer. Sends `dataset.updated`.

Scope: `datasets:write`. Also a pipeline action.

| Argument                        | Type   |                                                                                                                                |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `p_dataset_id` *                | uuid   | Dataset id.                                                                                                                    |
| `p_expected_dataset_revision` * | bigint |                                                                                                                                |
| `p_rows` *                      | json   | JSON array of rows, each `{ op: "insert" \| "update" \| "delete", rowId?, expectedRevision?, values: { <field id>: value } }`. |
| `p_idempotency_key` *           | text   | Any unique string; a retry with the same key and rows returns the first result.                                                |

#### `link_intake_dataset`

File a dataset a connector made in a project and run. Files a dataset a connector made: in project `p_project_id`, against instrument run `p_run_id` and its experiments, and records which connector run made it. Returns what it linked.

Scope: `lab:write`. Also a pipeline action.

| Argument               | Type |                                                  |
| ---------------------- | ---- | ------------------------------------------------ |
| `p_workspace_id` *     | uuid | Your workspace id; a pipeline step fills it in.  |
| `p_dataset_id` *       | uuid | Dataset id.                                      |
| `p_project_id` *       | uuid | Project id.                                      |
| `p_run_id` *           | uuid | Run id: the workflow run, or the instrument run. |
| `p_connector_run_id` * | uuid |                                                  |

### Imports and intake

#### `add_dataset_import_file`

Add an uploaded file to be imported into a dataset. Takes a file you uploaded with the files API (`p_file_id`) as a file to import: `p_format` is `csv`, `tsv`, `xlsx` or `json`, and `p_dataset_id` the dataset it is for, if you know. Returns the import file. Sends `import.file.added`.

Scope: `datasets:write`. Also a pipeline action.

| Argument       | Type |                                                                           |
| -------------- | ---- | ------------------------------------------------------------------------- |
| `p_file_id` *  | uuid |                                                                           |
| `p_format` *   | text | Plate format, such as `96_well` or `384_well`; or a worklist file format. |
| `p_dataset_id` | uuid | Dataset id.                                                               |

#### `record_intake_failure`

Report a file a connector could not bring in. Records that a connector could not bring a file in, with a short `p_code` and a `p_message` for people. The same file failing again adds an attempt instead of a new problem. `p_source` is `agent` (a connector) or `upload`. Returns the problem. Sends `intake.failed`.

Scope: `lab:write`. Also a pipeline action.

| Argument             | Type   |                                                 |
| -------------------- | ------ | ----------------------------------------------- |
| `p_workspace_id` *   | uuid   | Your workspace id; a pipeline step fills it in. |
| `p_connector_id` *   | uuid   |                                                 |
| `p_file_name` *      | text   |                                                 |
| `p_source` *         | text   |                                                 |
| `p_code` *           | text   |                                                 |
| `p_message` *        | text   |                                                 |
| `p_file_record_id`   | uuid   |                                                 |
| `p_checksum`         | text   |                                                 |
| `p_byte_size`        | bigint |                                                 |
| `p_parser_key`       | text   |                                                 |
| `p_target`           | json   |                                                 |
| `p_connector_run_id` | uuid   |                                                 |

#### `resolve_intake_failure`

Close a problem bringing a file in. Closes an open intake problem: `p_resolution` is `resolved` (it came in after all, with the connector run that did it as `p_run_id`) or `dismissed`. Returns the problem. Sends `intake.resolved`.

Scope: `lab:write`. Also a pipeline action.

| Argument         | Type |                                                  |
| ---------------- | ---- | ------------------------------------------------ |
| `p_failure_id` * | uuid |                                                  |
| `p_resolution` * | text |                                                  |
| `p_run_id`       | uuid | Run id: the workflow run, or the instrument run. |

#### `resolve_intake_failures_for_file`

Close every open problem for a file that has now come in. Marks every open problem a connector had with the file of this checksum as resolved by connector run `p_run_id`. A connector calls it after a file finally comes in. Returns how many it closed. Sends `intake.resolved` for each.

Scope: `lab:write`. Also a pipeline action.

| Argument           | Type |                                                  |
| ------------------ | ---- | ------------------------------------------------ |
| `p_connector_id` * | uuid |                                                  |
| `p_checksum` *     | text |                                                  |
| `p_run_id` *       | uuid | Run id: the workflow run, or the instrument run. |

#### `attach_instrument_raw_file`

Attach an uploaded raw file to an instrument run. Keeps a file you uploaded with the files API (`p_file_id`) as a raw file of instrument run `p_run_id`, as it came off the instrument. `p_ingestion_status` is `pending` (default), `complete`, `partial` or `failed`, with `p_error_detail`. Returns the raw file. Sends `instrument.raw_file.added`.

Scope: `lab:write`. Also a pipeline action.

| Argument             | Type |                                                  |
| -------------------- | ---- | ------------------------------------------------ |
| `p_run_id` *         | uuid | Run id: the workflow run, or the instrument run. |
| `p_file_id` *        | uuid |                                                  |
| `p_ingestion_status` | text |                                                  |
| `p_error_detail`     | text |                                                  |

## Not on the API

- The older schema registry and scientific tables (`dataset_schemas`,
  `scientific_tables` and their calls) are a compatibility layer the app is
  moving off. Use measurement tables and datasets instead.
- Pruning old snapshots runs in the background for every workspace; keep one
  with `keep_dataset_version`.
