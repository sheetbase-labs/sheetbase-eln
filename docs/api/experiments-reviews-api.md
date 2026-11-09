# Experiments, reviews and records API

Starting and moving experiments, recording what they showed, other names for
records, formulas, label templates and the review history. Planning a project
from another, saved trails and the timeline are in the projects pages. For a token, over MCP
(`sheetbase.lab.act`, `sheetbase.canonical.read`), from a pipeline step and,
for the everyday changes, from the assistant as a confirm card.

## Scopes

| Scope            | What it covers                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `projects:read`  | Experiment readiness and counts, aliases, formulas, a hard delete preview.                     |
| `projects:write` | Starting an experiment, changing its status, recording its outcome, aliases, deleting a draft. |
| `reviews:read`   | Review workflows, submissions, check results, a revision's evidence and what moved since.      |
| `lab:read`       | Label templates.                                                                               |
| `lab:write`      | Archiving a label template, recording a QC check on an instrument run.                         |

These run as the person a personal token belongs to, so the person still
needs the right to do them.

Submitting a record for review, running its review checks and opening an
amendment run only in a signed-in person's session, which the review record
names, so they stay in the app. Deleting for good is confirmed by a person;
`preview_hard_delete` shows what it would take.

## Events

- `record.alias.added`, `record.alias.removed`
- `label.template.created`, `label.template.updated`

Starting an experiment, changing its status and its outcome already send
`record.updated`; deleting a draft sends `record.deleted`; a QC check sends its
instrument events.

## Tables

### `record_aliases`

Other names a record is known by, such as a supplier code. Add and remove them with `add_record_alias` and `remove_record_alias`.

Scope: `projects:read`. Columns: `id`, `workspace_id`, `record_id`, `alias`, `created_at`, `updated_at`, `created_by_user_id`.

### `formula_definitions`

Formulas in notebook tables: the cell each fills, what was typed (`source_expression`) and whether it is in use.

Scope: `projects:read`. Columns: `id`, `workspace_id`, `record_id`, `target_table_id`, `target_row_id`, `target_column_id`, `source_expression`, `template`, `bindings`, `engine_expression`, `syntax_profile`, `function_profile`, `literal_profile`, `engine_version`, `status`, `version`, `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`.

### `formula_dependencies`

Which cells each formula reads, so you can tell what a change will recalculate.

Scope: `projects:read`. Columns: `formula_id`, `workspace_id`, `record_id`, `source_table_id`, `source_row_id`, `source_column_id`.

### `formula_results`

What each formula gives now: the calculated value, or the error, and whether it is up to date with its inputs.

Scope: `projects:read`. Columns: `formula_id`, `workspace_id`, `record_id`, `target_table_id`, `target_row_id`, `target_column_id`, `source_expression`, `cell_kind`, `value_is_authoritative`, `definition_status`, `formula_version`, `current_input_revision`, `calculation_status`, `calculated_value`, `calculation_error_code`, `cache_input_revision`, `schema_versions`, `engine_version`, `profile_fingerprint`, `runtime_fingerprint`, `calculated_at`.

### `label_templates`

How sample and stock labels look: size, barcode and what they show. Archive or restore one with `set_label_template_archived`.

Scope: `lab:read`, personal tokens only. Columns: `id`, `workspace_id`, `name`, `record_kind`, `show_condition`, `show_use_by`, `created_by_user_id`, `created_at`, `updated_at`, `width_mm`, `height_mm`, `barcode_type`, `show_lot`, `show_sample_type`, `is_default`, `archived_at`, `layout`.

### `review_submissions`

Each time a record was submitted for review: the revision, the workflow, who it went to and where it is now (`state`).

Scope: `reviews:read`, personal tokens only. Columns: `id`, `workspace_id`, `record_id`, `revision_id`, `state`, `workflow_definition_key`, `workflow_definition_version`, `assigned_reviewer_user_ids`, `submitted_by_user_id`, `submitted_session_id`, `submitted_role`, `submitted_at`, `idempotency_key`, `created_at`, `updated_at`, `due_at`.

### `review_check_results`

The checks run on a submitted revision: how many passed, how many failed and how badly, and each result.

Scope: `reviews:read`, personal tokens only. Columns: `id`, `workspace_id`, `record_id`, `revision_id`, `check_definition_key`, `check_definition_version`, `revision_integrity_digest`, `check_definition_digest`, `input_digest`, `overall_status`, `pass_count`, `blocking_failure_count`, `warning_failure_count`, `info_failure_count`, `results`, `run_by_user_id`, `run_session_id`, `run_role`, `run_at`, `idempotency_key`, `created_at`.

## Actions

### `start_experiment`

Start a planned experiment

Moves a planned experiment to running, optionally on a protocol version. The protocol must be one the project may use.

Scope: `projects:write`. Returns `row:records`.

| Parameter                     | Type   | Required | Notes                                                         |
| ----------------------------- | ------ | -------- | ------------------------------------------------------------- |
| `p_record_id`                 | uuid   | yes      | The experiment (`records.id`).                                |
| `p_expected_metadata_version` | bigint | yes      | The `metadata_version` you last read. A stale one is refused. |
| `p_protocol_version_id`       | uuid   | no       | The protocol version to run it on.                            |
| `p_reason`                    | text   | no       | Why, in a sentence.                                           |

### `set_experiment_status`

Change an experiment’s status

Moves an experiment to another status, such as on hold or complete. Some moves need a reason when the workspace asks for one.

Scope: `projects:write`. Returns `row:records`.

| Parameter                     | Type   | Required | Notes                                                         |
| ----------------------------- | ------ | -------- | ------------------------------------------------------------- |
| `p_record_id`                 | uuid   | yes      | The experiment (`records.id`).                                |
| `p_expected_metadata_version` | bigint | yes      | The `metadata_version` you last read. A stale one is refused. |
| `p_status`                    | text   | yes      | The new status.                                               |
| `p_reason`                    | text   | yes      | Why, in a sentence.                                           |

### `delete_experiment_draft`

Delete a draft experiment

Deletes a draft experiment that was never submitted. Only its author, or a workspace admin, may.

Scope: `projects:write`. Returns `void`.

| Parameter     | Type | Required | Notes                          |
| ------------- | ---- | -------- | ------------------------------ |
| `p_record_id` | uuid | yes      | The experiment (`records.id`). |

### `set_experiment_decision`

Record whether an experiment supported its hypothesis

Records the outcome against the hypothesis: `supported`, `refuted` or `inconclusive`, with notes. Leave the decision out to clear it.

Scope: `projects:write`. Returns `row:records`.

| Parameter     | Type | Required | Notes                                     |
| ------------- | ---- | -------- | ----------------------------------------- |
| `p_record_id` | uuid | yes      | The experiment (`records.id`).            |
| `p_decision`  | text | yes      | `supported`, `refuted` or `inconclusive`. |
| `p_notes`     | text | no       | Why, in a few lines.                      |

### `experiment_readiness`

What an experiment still needs before it can be submitted

The checks an experiment must pass before it can go for review, and which of them still fail.

Scope: `projects:read`. Returns `json`.

| Parameter     | Type | Required | Notes                          |
| ------------- | ---- | -------- | ------------------------------ |
| `p_record_id` | uuid | yes      | The experiment (`records.id`). |

### `experiment_open_issue_counts`

Open issues on each experiment

For each experiment you can see, how many linked issues are still open.

Scope: `projects:read`. Returns `rows:record_id=uuid,open_issues=bigint`.

| Parameter | Type | Required | Notes |
| --------- | ---- | -------- | ----- |

### `experiment_tab_counts`

How many experiments are in each status

Experiment counts by status and whether archived, in all and yours, narrowed as the Experiments list narrows them.

Scope: `projects:read`. Returns `rows:status=text,archived=bool,total=int,mine=int`.

| Parameter             | Type   | Required | Notes              |
| --------------------- | ------ | -------- | ------------------ |
| `p_user_id`           | text   | no       | Whose are “mine”.  |
| `p_project_id`        | uuid   | no       | One project.       |
| `p_since`             | ts     | no       | Changed since.     |
| `p_query`             | text   | no       | Words to match.    |
| `p_match_project_ids` | uuid[] | no       | Projects to match. |
| `p_match_owner_ids`   | text[] | no       | Owners to match.   |

### `add_record_alias`

Add an alias to a record

Gives a record another name it can be found by, such as a supplier code or an old identifier. Returns the alias.

Scope: `projects:write`. Returns `row:record_aliases`.

| Parameter     | Type | Required | Notes                                                         |
| ------------- | ---- | -------- | ------------------------------------------------------------- |
| `p_record_id` | uuid | yes      | The record id.                                                |
| `p_alias`     | text | yes      | Another name the record is known by, such as a supplier code. |

Events:

- `record.alias.added`: A record was given another name.
- `record.alias.removed`: Another name was taken off a record.

### `remove_record_alias`

Remove an alias from a record

Takes one of a record’s other names off it.

Scope: `projects:write`. Returns `void`.

| Parameter     | Type | Required | Notes                                                         |
| ------------- | ---- | -------- | ------------------------------------------------------------- |
| `p_record_id` | uuid | yes      | The record id.                                                |
| `p_alias`     | text | yes      | Another name the record is known by, such as a supplier code. |

### `preview_hard_delete`

What deleting something for good would remove or be blocked by

Lists what a permanent delete would take with it, and what stops it. Deleting for good stays with a person in the app.

Scope: `projects:read`. Returns `json`.

| Parameter     | Type | Required | Notes                         |
| ------------- | ---- | -------- | ----------------------------- |
| `p_kind`      | text | yes      | What it is, such as `record`. |
| `p_object_id` | uuid | yes      | Its id.                       |

### `available_review_workflows`

The review workflows records can be submitted to

Each review workflow by key and version, and whether it needs a signature.

Scope: `reviews:read`. Returns `rows:definition_key=text,version=int,requires_signature=bool`.

| Parameter | Type | Required | Notes |
| --------- | ---- | -------- | ----- |

### `review_workflow_options`

The review workflows offered in settings

The review workflows a workspace can choose from, by key and version, and whether each needs a signature.

Scope: `reviews:read`. Returns `rows:definition_key=text,version=int,requires_signature=bool`.

| Parameter | Type | Required | Notes |
| --------- | ---- | -------- | ----- |

### `revision_drift`

What changed on a record since a revision was submitted

Compares a submitted revision with the record as it is now, and lists what moved.

Scope: `reviews:read`. Returns `json`.

| Parameter       | Type | Required | Notes                                    |
| --------------- | ---- | -------- | ---------------------------------------- |
| `p_revision_id` | uuid | yes      | The submitted revision (`revisions.id`). |

### `revision_evidence_package`

The evidence package of a submitted revision

Everything a reviewer sees for a revision: its content digest, checks, links, files and signatures.

Scope: `reviews:read`. Returns `json`.

| Parameter       | Type | Required | Notes                                    |
| --------------- | ---- | -------- | ---------------------------------------- |
| `p_revision_id` | uuid | yes      | The submitted revision (`revisions.id`). |

### `record_qc_check`

Record a quality check on an instrument run

Adds a quality check result to an instrument run: its name, `info`, `pass`, `warn` or `fail`, a message and any detail.

Scope: `lab:write`. Returns `row:instrument_qc_checks`.

| Parameter        | Type | Required | Notes                |
| ---------------- | ---- | -------- | -------------------- |
| `p_workspace_id` | uuid | yes      | Your workspace id.   |
| `p_run_id`       | uuid | yes      | The instrument run.  |
| `p_check_name`   | text | yes      | What was checked.    |
| `p_check_type`   | text | no       | The result kind.     |
| `p_message`      | text | no       | What it found.       |
| `p_detail`       | json | no       | Any detail, as JSON. |

### `set_label_template_archived`

Archive or restore a label template

Stops a label template being offered when printing, or brings it back.

Scope: `lab:write`. Returns `row:label_templates`.

| Parameter       | Type | Required | Notes                              |
| --------------- | ---- | -------- | ---------------------------------- |
| `p_template_id` | uuid | yes      | The label template.                |
| `p_archived`    | bool | yes      | true to archive, false to restore. |

Events:

- `label.template.created`: A label template was added.
- `label.template.updated`: A label template was changed, archived or restored.
