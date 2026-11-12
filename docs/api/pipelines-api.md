# Pipelines, schedules and plugins API

Make, ask to publish, run and schedule pipelines, and switch plugins on and off, as the person a personal token belongs to. Pipelines need `pipelines:read` and `pipelines:write`; plugins need `admin:read` and `admin:write` and an owner or admin. Every action is also on `sheetbase.lab.act` over MCP, where it follows the agent permissions (Ask by default), and in the Python and TypeScript SDKs. Saving a pipeline version is `create_pipeline_definition_version` and starting a run by key is `run_pipeline` (see [lab-api.md](lab-api.md)). Installing a plugin takes its file: `POST /api/plugins/install` with an `admin:write` token (see [`plugins-api.md`](plugins-api.md)).

Publishing needs an admin’s approval: `request_pipeline_publish` asks for it, and an owner or admin approves in the app (the approval publishes the version). A token, MCP or a pipeline cannot approve, so nothing publishes itself. The request and who decided it are on `approval_requests` and `approval_request_decisions` (see [lab-api.md](lab-api.md)).

A run that pauses for a person (`pipeline.run.waiting`) is answered by that person in the app: the pause is the pipeline asking them to confirm, so a token or an agent cannot answer for them. The prompt is readable on `pipeline_run_prompts`.

Two step kinds reach outside the run: `remote_job` (a script on an HPC queue; the run waits, up to its time limit) and `lakehouse` (read-only SQL over the open tables). Both are written in the pipeline version's `steps` like any other kind, by a token or an agent. Their connections, secrets and switch, and the jobs a run sent, are in [`pipeline-remote-api.md`](pipeline-remote-api.md).

## Tables

| Table                        | Scope            | What it holds                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline_schedules`         | `pipelines:read` | When a pipeline runs by itself. `kind` is `interval`, `daily`, `cron` or `event`; `spec` holds `intervalMinutes`, `dailyAt`, `cron` or `eventType` (with its filters), plus the inputs and parameters it runs with. `enabled` is false while it is switched off.                                                                                                  |
| `pipeline_schedule_activity` | `pipelines:read` | What each start did, and why one did not run: `kind` is `started`, `batched`, `skipped_condition`, `skipped_missed`, `skipped_unchanged` (its inputs had not changed), `skipped_overlap` (a run was still going), `skipped_no_version`, `input_unresolved` or `start_failed`, with a `message` saying more. See [pipeline-starts-api.md](pipeline-starts-api.md). |
| `pipeline_trigger_failures`  | `pipelines:read` | A time a schedule could not start its pipeline (a missing input, a version with errors). `status` is `pending` while it is tried again and `abandoned` once it gives up.                                                                                                                                                                                          |
| `pipeline_run_prompts`       | `pipelines:read` | A step where a run paused for a person to confirm. `asked_user_ids` are the people who may answer; `answer` holds their decision (`confirm`, `skip` or `stop`) once they have. Answering is done by that person in the app.                                                                                                                                       |
| `pipeline_run_manifests`     | `pipelines:read` | The record of exactly what a run used and made (version, inputs, code, environment, outputs), chained by digest and signed when the workspace has a signing key. Check one with `GET /api/pipelines/manifest`.                                                                                                                                                    |
| `pipeline_artefact_releases` | `pipelines:read` | Whether a finished run kept its working files (`kept`) or they were deleted, and when.                                                                                                                                                                                                                                                                            |
| `pipeline_parameter_sets`    | `pipelines:read` | Reusable named lists of pipeline parameters. `key` is what a version file lists under `include:`; `parameters` is the list (`name`, `type`, `required`, `default`, `description`). A version that includes a set carries its own copy, so changing a set never changes a saved version.                |
| `extensions`                 | `admin:read`     | The plugins installed in the workspace. `key` is its name here, `status` is `installed`, `enabled` or `disabled`, `manifest` is what it declares (its parts, permissions and the hosts it may reach) and `disabled_points` the parts an administrator switched off. The code itself is never readable.                                                            |

## `POST /api/pipelines/version-file`

Reads or writes an Advanced pipeline's version file (YAML) without saving anything. Scope: `pipelines:read`, or a signed-in session. The body is at most 1 MB.

- `{ "text": "...", "pipeline": ["PL-0021", "assay"], "pythonRuntime": "..." }` returns `{ "ok", "configuration", "problems", "lineCount" }`. Each problem has a 1-based `line`, `column`, `length` and a `message`. `pipeline` lists the names the file's `pipeline:` line may be.
- `{ "configuration": {...}, "pipeline": "PL-0021", "version": 2, "title": "Assay" }` returns `{ "text" }`.

To save a file, send the returned `configuration` through `create_pipeline_definition_version` or `update_pipeline_definition_version_draft`, or use `sheetbase push` and the SDK methods `push_version_file` (Python) and `pushVersionFile` (TypeScript), which do both steps. See [the version file](../subsystems/pipelines.md#the-version-file-advanced-mode).

## `save_pipeline_parameter_set`

Makes a reusable parameter set, or replaces the one with the same key. Pipelines include it by key (`include:` in a version file); versions already saved keep the copy they took. Stewards, admins and owners. Sends `pipeline.parameter_set.created` or `pipeline.parameter_set.updated`.

Scope: `pipelines:write`. Returns a `pipeline_parameter_sets` row.

| Argument           | Type | Notes                                                                        |
| ------------------ | ---- | ---------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                                           |
| `p_key` *          | text | Lower-case letters, digits, `-` and `_`, starting with a letter.             |
| `p_name` *         | text | Name.                                                                        |
| `p_parameters` *   | json | The parameters, as a list of `{name, type, required, default, description}`. |
| `p_description`    | text | What it is for.                                                              |

## `delete_pipeline_parameter_set`

Deletes a parameter set. Versions that included it keep their copy of its parameters. Stewards, admins and owners. Sends `pipeline.parameter_set.deleted`.

Scope: `pipelines:write`. Returns `void`.

| Argument           | Type | Notes                                    |
| ------------------ | ---- | ---------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                       |
| `p_set_id` *       | uuid | The set, from `pipeline_parameter_sets`. |

## `create_pipeline_definition`

Creates an empty pipeline with a key (letters, digits and `_`, unique in the workspace) and a name. Save its first version with `create_pipeline_definition_version` and publish it to run it. Stewards, admins and owners. Returns the pipeline. Sends `pipeline.created`.

Scope: `pipelines:write`. Returns `row:pipeline_definitions`.

| Argument           | Type | Notes                        |
| ------------------ | ---- | ---------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.           |
| `p_key` *          | text | The pipeline’s key.          |
| `p_name` *         | text | Name.                        |
| `p_description`    | text | What it does, in a sentence. |

## `update_pipeline_definition`

Changes a pipeline’s name or description, or retires it (`p_lifecycle` `retired`) so it cannot be run any more; `active` brings it back. Stewards, admins and owners. Leave a field out to keep it. Returns the pipeline. Sends `pipeline.updated`.

Scope: `pipelines:write`. Returns `row:pipeline_definitions`.

| Argument            | Type | Notes                                      |
| ------------------- | ---- | ------------------------------------------ |
| `p_workspace_id` *  | uuid | Your workspace id.                         |
| `p_definition_id` * | uuid | The pipeline, from `pipeline_definitions`. |
| `p_name`            | text | A new name.                                |
| `p_description`     | text | What it does, in a sentence.               |
| `p_lifecycle`       | text | `active` or `retired`.                     |

## `request_pipeline_publish`

Asks an admin or owner to approve publishing a checked draft version, with `p_reason` saying what changed. The draft is locked while the request waits; once an admin approves, that exact version is published and runs and schedules use it, and the version before it stays as it was for the runs that used it. Where the person asking is the only admin or owner, they may approve it themselves. Returns the request; read its state on `approval_requests` (`object_kind` is `pipeline_definition_version`). Sends `approval.requested`, then `approval.approved` or `approval.returned`, and `pipeline.version.published` once it is published. Approving or returning is a person’s decision in the app and is not offered here.

Scope: `pipelines:write`. Returns `row:approval_requests`.

| Argument           | Type | Notes                                                   |
| ------------------ | ---- | ------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                      |
| `p_version_id` *   | uuid | The draft version, from `pipeline_definition_versions`. |
| `p_reason` *       | text | What changed and why, up to 500 characters.             |

A request that has not been decided can be taken back with `withdraw_approval_request` by the person who asked. Making the draft change again after a return is `update_pipeline_definition_version_draft`; it is refused (`SB085`) while a request waits.

## `retire_pipeline_definition_version`

Retires a published version so new runs cannot use it. Runs that used it keep it, and a failed one can still be retried on it. Returns the version. Sends `pipeline.version.retired`.

Scope: `pipelines:write`. Returns `row:pipeline_definition_versions`.

| Argument           | Type | Notes                                             |
| ------------------ | ---- | ------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                |
| `p_version_id` *   | uuid | The version, from `pipeline_definition_versions`. |

## `run_pipeline_version`

Starts a run of one exact published version, as the person the token belongs to, so a script that tested version 4 runs version 4 even after a newer one is published. `p_parameters` sets the pipeline’s parameters and `p_input_versions` maps each input name to the dataset version to read. Returns the run straight away; follow it on `pipeline_runs`. Sends `pipeline.run.created`, then `pipeline.run.succeeded` or `pipeline.run.failed`.

Scope: `pipelines:write`. Returns `row:pipeline_runs`. Also a pipeline action.

| Argument           | Type | Notes                                                           |
| ------------------ | ---- | --------------------------------------------------------------- |
| `p_version_id` *   | uuid | The version, from `pipeline_definition_versions`.               |
| `p_parameters`     | json | The pipeline’s parameters, by name. Leave out for the defaults. |
| `p_input_versions` | json | Each input’s name to the dataset version id it reads.           |

## `retry_pipeline_run`

Runs a failed or cancelled run again, on the same version with the same parameters and inputs, as the Retry button does. The new run points back at the old one (`retry_of_run_id`). Returns the new run. Sends `pipeline.run.created`.

Scope: `pipelines:write`. Returns `row:pipeline_runs`. Also a pipeline action.

| Argument     | Type | Notes                                   |
| ------------ | ---- | --------------------------------------- |
| `p_run_id` * | uuid | The pipeline run, from `pipeline_runs`. |

## `cancel_pipeline_run`

Stops a running run. The person who started it, or a steward, admin or owner, can cancel it. Returns the run. Sends `pipeline.run.cancelled`.

Scope: `pipelines:write`. Returns `row:pipeline_runs`. Also a pipeline action.

| Argument           | Type | Notes                                   |
| ------------------ | ---- | --------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                      |
| `p_run_id` *       | uuid | The pipeline run, from `pipeline_runs`. |

## `create_pipeline_schedule`

Makes a pipeline run by itself. `p_kind` is `interval` (`p_spec` `{ "intervalMinutes": 60 }`), `daily` (`{ "dailyAt": "06:00", "timeZone": "Europe/London" }`), `cron` (`{ "cron": "0 6 * * 1-5", "timeZone": "Europe/London" }`) or `event` (`{ "eventType": "dataset.versioned", "datasetId": "…" }`, any event that can start a pipeline). The spec can also carry `parameters`, `inputs` and `missedRunPolicy`. It runs as the person who adds it. Returns the schedule. Sends `pipeline.schedule.created`.

Scope: `pipelines:write`. Returns `row:pipeline_schedules`.

| Argument            | Type | Notes                                      |
| ------------------- | ---- | ------------------------------------------ |
| `p_workspace_id` *  | uuid | Your workspace id.                         |
| `p_definition_id` * | uuid | The pipeline, from `pipeline_definitions`. |
| `p_kind` *          | text | `interval`, `daily`, `cron` or `event`.    |
| `p_spec` *          | json | When it runs, for its kind (above).        |
| `p_enabled`         | bool | `false` switches it off; `true` on.        |

## `update_pipeline_schedule`

Changes when a schedule runs (`p_kind` and `p_spec`, as for `create_pipeline_schedule`) or switches it off and on (`p_enabled`). Leave a field out to keep it. Returns the schedule. Sends `pipeline.schedule.updated`.

Scope: `pipelines:write`. Returns `row:pipeline_schedules`. Also a pipeline action.

| Argument           | Type | Notes                                    |
| ------------------ | ---- | ---------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                       |
| `p_schedule_id` *  | uuid | The schedule, from `pipeline_schedules`. |
| `p_kind`           | text | `interval`, `daily`, `cron` or `event`.  |
| `p_spec`           | json | When it runs, for its kind.              |
| `p_enabled`        | bool | `false` switches it off; `true` on.      |

## `delete_pipeline_schedule`

Deletes a schedule. Runs it already started are kept. Sends `pipeline.schedule.deleted`.

Scope: `pipelines:write`. Returns `void`.

| Argument           | Type | Notes                                    |
| ------------------ | ---- | ---------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                       |
| `p_schedule_id` *  | uuid | The schedule, from `pipeline_schedules`. |

## `enable_extension`

Switches an installed plugin on, so what it adds shows in the app, the assistant, MCP and pipelines. Owners and admins. Returns the plugin. Sends `extension.enabled`.

Scope: `admin:write`. Returns `row:extensions`.

| Argument           | Type | Notes                                    |
| ------------------ | ---- | ---------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                       |
| `p_extension_id` * | uuid | The installed plugin, from `extensions`. |

## `disable_extension`

Switches a plugin off: everything it adds stops at once, and it can be switched on again. Owners and admins. Returns the plugin. Sends `extension.disabled`.

Scope: `admin:write`. Returns `row:extensions`.

| Argument           | Type | Notes                                    |
| ------------------ | ---- | ---------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                       |
| `p_extension_id` * | uuid | The installed plugin, from `extensions`. |

## `set_extension_point_enabled`

Switches one part of a plugin (`p_point`, such as `operations`, `pipeline-steps` or `analysis-kinds`; its parts are the keys of `manifest.contributions`) on or off, leaving the rest as it is. Owners and admins. Returns the plugin. Sends `extension.point.enabled` or `extension.point.disabled`.

Scope: `admin:write`. Returns `row:extensions`.

| Argument           | Type | Notes                                               |
| ------------------ | ---- | --------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                  |
| `p_extension_id` * | uuid | The installed plugin, from `extensions`.            |
| `p_point` *        | text | The part, such as `operations` or `pipeline-steps`. |
| `p_enabled` *      | bool | `true` switches it on, `false` off.                 |

## `remove_extension`

Removes an installed plugin and its code; everything it added stops at once. Owners and admins. Sends `extension.removed`.

Scope: `admin:write`. Returns `void`.

| Argument           | Type | Notes                                    |
| ------------------ | ---- | ---------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                       |
| `p_extension_id` * | uuid | The installed plugin, from `extensions`. |
