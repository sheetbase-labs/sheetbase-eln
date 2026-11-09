# Models, sheets and templates API

Record types (models) and their fields, choices and rules; sheet definitions
and their versions; notebook templates and their versions; and the sheets made
from them. Everything the settings pages and editors do is here, for a token,
over MCP (`sheetbase.lab.act`, `sheetbase.canonical.read`), from a pipeline
step and, for the everyday changes, from the assistant as a confirm card.

## Scopes

| Scope            | What it covers                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `schema:read`    | Record types, fields, choices, rules, versions, and what depends on a type.                          |
| `schema:write`   | Adding and changing record types, fields, choices, rules, sheet definitions and templates as drafts. |
| `schema:publish` | Publishing a version of a record type, sheet definition or template, and moving open work onto it.   |
| `sheets:read`    | Sheets and their history; searching inside sheets.                                                   |
| `sheets:write`   | Renaming a sheet.                                                                                    |
| `templates:read` | Templates and the notebooks made from them.                                                          |

A personal token acts as its person, so the person still needs the right to
edit (or publish) schemas in the workspace. A service credential has no person
and is refused by the database. Publishing is its own scope, so a token can be
given drafts without the right to publish them.

Retiring a notebook template version is signed (a signature meaning, from
someone with a signing certificate), so it stays with a person in the app.

## Events

These reach webhooks, the live feed and pipeline triggers, however the change
was made:

- `model.field.option.created`, `model.field.option.updated`
- `model.rule.created`, `model.rule.updated`, `model.rule.removed`
- `model.link_rule.set`, `model.link_rule.removed`
- `model.version.discarded`
- `sheet.definition.version.published`, `sheet.definition.version.retired`
- `notebook.template.version.published`, `notebook.template.version.retired`

Record types, fields and versions already send `model.created`,
`model.updated`, `model.field.*` and `model.version.*`; sheets and definitions
send `sheet.*` and `sheet.definition.*`; templates send `notebook.template.*`.
See [the event catalogue](event-catalogue.md).

## SQL for stewards

With SQL access switched on, stewards also get `data.record_types`,
`data.record_type_fields`, `data.record_type_rules`, `data.record_type_links`,
`data.record_type_versions`, `data.sheet_definitions`, `data.sheets` and
`data.notebook_templates`.

## Tables

### `model_kinds`

The families record types belong to (records, projects, instruments): what each holds and what it can do. Fixed by Sheetbase.

Scope: `schema:read`. Columns: `key`, `label`, `identity_table`, `custom_field_strategy`, `capabilities`, `record_kind`.

### `model_base_fields`

The built-in fields every record type of a family has, such as title and status, with how each is shown.

Scope: `schema:read`. Columns: `model_key`, `field_key`, `label`, `presentation`.

### `model_field_options`

The choices of each category field: the stored `key`, the `label` people see, the order and whether it is retired. Change them with `create_model_field_option`, `update_model_field_option` and `retire_model_field_option`.

Scope: `schema:read`. Columns: `id`, `definition_id`, `key`, `label`, `display_order`, `lifecycle`, `created_at`, `updated_at`.

### `model_rules`

Checks on records of a type: the fields each looks at, its condition, and whether it warns, blocks the save or blocks submitting (`effect`).

Scope: `schema:read`. Columns: `id`, `workspace_id`, `model_key`, `name`, `field_keys`, `condition`, `effect`, `message`, `created_at`, `updated_at`, `created_by_user_id`.

### `model_relationship_rules`

How many links of a kind records of one type must or may have to records of another (`min_links`, `max_links`).

Scope: `schema:read`. Columns: `id`, `workspace_id`, `source_model_key`, `link_type`, `target_model_key`, `min_links`, `max_links`, `label`, `created_at`, `updated_at`, `created_by_user_id`.

### `record_model_versions`

Each version of a record type: a `draft` being worked on or `published`, with what it holds (`definition`).

Scope: `schema:read`. Columns: `id`, `workspace_id`, `model_id`, `version`, `revision`, `lifecycle`, `definition`, `reason`, `published_at`, `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`.

### `record_model_version_upgrades`

Each time a record was moved onto a newer version of its type, by whom and why.

Scope: `schema:read`. Columns: `id`, `workspace_id`, `record_id`, `from_version_id`, `to_version_id`, `reason`, `created_at`, `upgraded_by_user_id`.

### `notebook_template_instantiations`

Each notebook made from a template version, and who made it.

Scope: `templates:read`. Columns: `id`, `workspace_id`, `actor_user_id`, `idempotency_key`, `template_version_id`, `record_id`, `result`, `created_at`.

### `notebook_template_upgrades`

Each time a notebook was moved onto a newer template version, with the decisions taken.

Scope: `templates:read`. Columns: `id`, `workspace_id`, `record_id`, `source_version_id`, `target_version_id`, `decisions`, `actor_user_id`, `created_at`.

### `sheet_instance_calculation_mutations`

Each change to a sheet’s own calculations, with the sheet revision before and after.

Scope: `sheets:read`. Columns: `id`, `workspace_id`, `instance_id`, `retry_token`, `request_digest`, `operation`, `result_revision`, `result`, `actor_user_id`, `created_at`.

### `sheet_instance_composition_adoptions`

Each time a sheet took on columns from a definition.

Scope: `sheets:read`. Columns: `id`, `workspace_id`, `instance_id`, `target_definition_version_id`, `source_instance_revision`, `resulting_instance_revision`, `retry_token`, `request_digest`, `unmatched_local_row_keys`, `actor_user_id`, `adopted_at`, `result`.

### `sheet_instance_definition_upgrades`

Each time a sheet was moved onto a newer version of its definition.

Scope: `sheets:read`. Columns: `id`, `workspace_id`, `instance_id`, `source_definition_version_id`, `target_definition_version_id`, `source_instance_revision`, `resulting_instance_revision`, `decision_manifest`, `actor_user_id`, `upgraded_at`.

### `sheet_instance_local_mutations`

Each change to a sheet’s own columns (ones no definition has).

Scope: `sheets:read`. Columns: `id`, `workspace_id`, `instance_id`, `retry_token`, `request_digest`, `result_revision`, `result`, `actor_user_id`, `operation`, `affected`, `created_at`, `actor_credential_id`.

### `sheet_materializations`

Each time a sheet’s rows were saved as a dataset version.

Scope: `sheets:read`. Columns: `id`, `workspace_id`, `instance_id`, `definition_version_id`, `instance_revision`, `output_dataset_id`, `output_dataset_version_id`, `output_schema_version_id`, `source_versions`, `calculation_provenance`, `request_digest`, `idempotency_key`, `actor_user_id`, `materialized_at`.

### `sheet_record_bulk_commits`

Each batch of records saved from a sheet at once.

Scope: `sheets:read`. Columns: `id`, `workspace_id`, `project_id`, `actor_user_id`, `idempotency_key`, `request_digest`, `result`, `created_at`.

### `revision_sheet_evidence`

The sheets as they were when a notebook revision was submitted for review: the sheet’s state, grid and dataset versions.

Scope: `reviews:read`. Columns: `id`, `workspace_id`, `revision_id`, `block_id`, `instance_id`, `source_definition_version_id`, `instance_revision`, `instance_state`, `dataset_versions`, `created_at`, `composed_grid`.

## Actions

### `create_model_record`

Add a record of any record type

Create an experiment, sample, material, report or supported model record in a project.

Scope: `projects:write`. Returns `json`.

| Parameter         | Type   | Required | Notes |
| ----------------- | ------ | -------- | ----- |
| `p_project_id`    | uuid   | yes      |       |
| `p_kind`          | text   | yes      |       |
| `p_title`         | text   | yes      |       |
| `p_status`        | text   | no       |       |
| `p_tags`          | text[] | no       |       |
| `p_properties`    | json   | no       |       |
| `p_custom_fields` | json   | no       |       |

### `create_workspace_model`

Add a record type

Adds a record type (model) to the workspace, such as Cell line or Supplier, with the prefix its identifiers start with. It starts with a draft version to add fields to. Returns the type.

Scope: `schema:write`. Returns `row:record_models`.

| Parameter             | Type | Required | Notes                                                         |
| --------------------- | ---- | -------- | ------------------------------------------------------------- |
| `p_workspace_id`      | uuid | yes      | Your workspace id.                                            |
| `p_key`               | text | yes      | Key, lower case letters, digits and `_`, such as `cell_line`. |
| `p_name`              | text | yes      |                                                               |
| `p_identifier_prefix` | text | yes      | What identifiers start with, such as `CL`.                    |
| `p_description`       | text | no       | A description.                                                |

### `create_model_subtype`

Add a kind of a record type

Adds a record type that is a kind of another, such as Antibody under Reagent. It has the parent’s fields and can add its own. Returns the new type.

Scope: `schema:write`. Returns `row:record_models`.

| Parameter             | Type | Required | Notes                          |
| --------------------- | ---- | -------- | ------------------------------ |
| `p_workspace_id`      | uuid | yes      | Your workspace id.             |
| `p_parent_key`        | text | yes      | Key of the parent record type. |
| `p_key`               | text | yes      | Key of the new type.           |
| `p_name`              | text | yes      |                                |
| `p_identifier_prefix` | text | yes      | What identifiers start with.   |
| `p_description`       | text | no       | A description.                 |

### `reparent_record_model`

Move a record type under another

Makes a record type a kind of another one, or a top-level type again when `p_parent_key` is null. Returns the type.

Scope: `schema:write`. Returns `row:record_models`.

| Parameter      | Type | Required | Notes                                    |
| -------------- | ---- | -------- | ---------------------------------------- |
| `p_model_id`   | uuid | yes      | The record type (`record_models.id`).    |
| `p_parent_key` | text | yes      | Key of the new parent, or null for none. |

### `create_registry_model`

Add a registry

Adds a record type that works as a registry (cell lines, constructs): entries get a running number and likely duplicates are refused by the key fields. `p_fields` is a JSON list of `{ name, label, type, required, options }`. Returns the type.

Scope: `schema:write`. Returns `row:record_models`.

| Parameter          | Type   | Required | Notes                                                    |
| ------------------ | ------ | -------- | -------------------------------------------------------- |
| `p_key`            | text   | yes      |                                                          |
| `p_name`           | text   | yes      |                                                          |
| `p_prefix`         | text   | yes      | What identifiers start with.                             |
| `p_description`    | text   | yes      |                                                          |
| `p_fields`         | json   | yes      | JSON list of `{ name, label, type, required, options }`. |
| `p_key_fields`     | text[] | yes      | Fields that together say two entries are the same thing. |
| `p_sequence_field` | text   | no       | The field that holds the running number.                 |

### `create_request_model`

Add a request form

Adds a record type that people send as a request (a sequencing request, a stores order), with an intro shown on the form. `p_fields` is a JSON list of `{ name, label, type, required, options }`. Returns the type.

Scope: `schema:write`. Returns `row:record_models`.

| Parameter       | Type | Required | Notes                                                    |
| --------------- | ---- | -------- | -------------------------------------------------------- |
| `p_key`         | text | yes      |                                                          |
| `p_name`        | text | yes      |                                                          |
| `p_prefix`      | text | yes      | What identifiers start with.                             |
| `p_description` | text | yes      |                                                          |
| `p_fields`      | json | yes      | JSON list of `{ name, label, type, required, options }`. |
| `p_intro`       | text | no       | Text shown at the top of the form.                       |

### `create_starter_model`

Add a record type from a starter

Adds a record type with its fields in one go, optionally used as an incident log. `p_fields` is a JSON list of `{ name, label, type, required, options }`. Returns the type.

Scope: `schema:write`. Returns `row:record_models`.

| Parameter        | Type | Required | Notes                                                    |
| ---------------- | ---- | -------- | -------------------------------------------------------- |
| `p_key`          | text | yes      |                                                          |
| `p_name`         | text | yes      |                                                          |
| `p_prefix`       | text | yes      | What identifiers start with.                             |
| `p_description`  | text | yes      |                                                          |
| `p_fields`       | json | yes      | JSON list of `{ name, label, type, required, options }`. |
| `p_incident_log` | bool | no       | true to use it as an incident log.                       |

### `set_model_registry`

Make a record type a registry, or not

Turns a record type into a registry (or back), with the fields that say two entries are the same thing and the field that holds the running number. Returns the type.

Scope: `schema:write`. Returns `row:record_models`.

| Parameter          | Type   | Required | Notes                                                    |
| ------------------ | ------ | -------- | -------------------------------------------------------- |
| `p_model_key`      | text   | yes      | Key of the record type (model), such as `cell_line`.     |
| `p_is_registry`    | bool   | yes      |                                                          |
| `p_key_fields`     | text[] | no       | Fields that together say two entries are the same thing. |
| `p_sequence_field` | text   | no       | The field that holds the running number.                 |

### `set_registry_lot_kind`

Choose the record type a registry’s lots are

Says which record type the lots of a registry entry are, such as Compound lot. Null takes it off. Returns the registry’s type.

Scope: `schema:write`. Returns `row:record_models`.

| Parameter     | Type | Required | Notes                                                |
| ------------- | ---- | -------- | ---------------------------------------------------- |
| `p_model_key` | text | yes      | Key of the record type (model), such as `cell_line`. |
| `p_lot_kind`  | text | no       | Key of the lot record type, or null.                 |

### `set_registry_sameness_rule`

Choose the plugin rule that spots duplicates in a registry

Picks the plugin rule that decides when two entries of a registry are the same thing. `p_plugin_item` is `plugin.<plugin>.<rule>`; null goes back to the key fields.

Scope: `schema:write`. Returns `void`.

| Parameter       | Type | Required | Notes                                                |
| --------------- | ---- | -------- | ---------------------------------------------------- |
| `p_model_key`   | text | yes      | Key of the record type (model), such as `cell_line`. |
| `p_plugin_item` | text | yes      | `plugin.<plugin>.<rule>`, or null.                   |

### `set_model_incident_log`

Use a record type as an incident log, or not

Turns incident log behaviour on or off for a record type: entries show in the incident list with their severity and follow-up. Returns whether it is on.

Scope: `schema:write`. Returns `bool`.

| Parameter     | Type | Required | Notes                                                |
| ------------- | ---- | -------- | ---------------------------------------------------- |
| `p_model_key` | text | yes      | Key of the record type (model), such as `cell_line`. |
| `p_enabled`   | bool | yes      |                                                      |

### `set_request_form`

Take requests on a record type, or stop

Says whether people can send a record type as a request, the intro on the form, and who handles requests.

Scope: `schema:write`. Returns `void`.

| Parameter            | Type   | Required | Notes                                                |
| -------------------- | ------ | -------- | ---------------------------------------------------- |
| `p_model_key`        | text   | yes      | Key of the record type (model), such as `cell_line`. |
| `p_accepts`          | bool   | yes      |                                                      |
| `p_intro`            | text   | no       | Text shown at the top of the form.                   |
| `p_handler_user_ids` | text[] | no       | Who handles requests, as user ids.                   |

### `discover_model_dependencies`

What uses a record type

Lists what depends on a record type: its records, fields, rules, links from other types, sheets, templates and pipelines. Read it before retiring or changing a type.

Scope: `schema:read`. Returns `json`.

| Parameter     | Type | Required | Notes                                                |
| ------------- | ---- | -------- | ---------------------------------------------------- |
| `p_model_key` | text | yes      | Key of the record type (model), such as `cell_line`. |

### `create_model_field`

Add a draft field to a record type

Adds a field to a record type as a draft. It does nothing on records until it is switched on (`activate_model_field`). `p_logical_type` is `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category` or `reference`. Returns the field.

Scope: `schema:write`. Returns `row:record_field_definitions`.

| Parameter         | Type | Required | Notes                                                                                    |
| ----------------- | ---- | -------- | ---------------------------------------------------------------------------------------- |
| `p_workspace_id`  | uuid | yes      | Your workspace id.                                                                       |
| `p_model_key`     | text | yes      | Key of the record type (model), such as `cell_line`.                                     |
| `p_field_name`    | text | yes      | Field name: lower case letters, digits and `_`.                                          |
| `p_label`         | text | yes      |                                                                                          |
| `p_logical_type`  | text | yes      | `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category` or `reference`. |
| `p_nullable`      | bool | no       | false makes it required.                                                                 |
| `p_default_value` | json | no       | Default value, as JSON.                                                                  |
| `p_validation`    | json | no       | Checks as JSON, such as `{ "min": 0, "max": 100 }`.                                      |
| `p_unit`          | json | no       | Unit as JSON, such as `{ "symbol": "mL" }`.                                              |
| `p_description`   | text | no       | A description.                                                                           |

### `create_and_activate_model_field`

Add a field to a record type and switch it on

Adds a field and switches it on in one go, with the choices of a category field. `p_options` is a JSON list of `{ key, label }`. Returns the field.

Scope: `schema:write`. Returns `row:record_field_definitions`.

| Parameter         | Type | Required | Notes                                                                                    |
| ----------------- | ---- | -------- | ---------------------------------------------------------------------------------------- |
| `p_workspace_id`  | uuid | yes      | Your workspace id.                                                                       |
| `p_model_key`     | text | yes      | Key of the record type (model), such as `cell_line`.                                     |
| `p_field_name`    | text | yes      | Field name: lower case letters, digits and `_`.                                          |
| `p_label`         | text | yes      |                                                                                          |
| `p_logical_type`  | text | yes      | `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category` or `reference`. |
| `p_nullable`      | bool | yes      | false makes it required.                                                                 |
| `p_default_value` | json | yes      | Default value, as JSON, or null.                                                         |
| `p_validation`    | json | yes      | Checks as JSON, such as `{}` or `{ "min": 0 }`.                                          |
| `p_options`       | json | no       | Choices of a category field, as `[{ key, label }]`.                                      |
| `p_unit`          | json | no       | Unit as JSON, such as `{ "symbol": "mL" }`.                                              |
| `p_description`   | text | no       | A description.                                                                           |

### `activate_model_field`

Switch a draft field on

Switches a draft field on, so records of the type show and keep it. Returns the field.

Scope: `schema:write`. Returns `row:record_field_definitions`.

| Parameter         | Type | Required | Notes                                      |
| ----------------- | ---- | -------- | ------------------------------------------ |
| `p_definition_id` | uuid | yes      | The field (`record_field_definitions.id`). |

### `update_model_field`

Change a field

Changes a field’s label, description, order, section, unit or checks. `p_patch` holds only what changes, such as `{ "label": "Passage", "show_in_list": true }`. A change that would break existing values goes through `apply_model_field_evolution`. Returns the field.

Scope: `schema:write`. Returns `row:record_field_definitions`.

| Parameter         | Type | Required | Notes                                      |
| ----------------- | ---- | -------- | ------------------------------------------ |
| `p_definition_id` | uuid | yes      | The field (`record_field_definitions.id`). |
| `p_patch`         | json | yes      | Only the columns that change.              |

### `retire_model_field`

Retire a field

Takes a field out of use. Values already kept on records stay; new records no longer show it. Returns the field.

Scope: `schema:write`. Returns `row:record_field_definitions`.

| Parameter         | Type | Required | Notes                                      |
| ----------------- | ---- | -------- | ------------------------------------------ |
| `p_definition_id` | uuid | yes      | The field (`record_field_definitions.id`). |

### `configure_model_field_semantics`

Say what a draft field measures

Sets what a draft field means: the quantity and unit it measures, one value or many, where a category’s choices come from, or which record type a reference points at. Returns the field.

Scope: `schema:write`. Returns `row:record_field_definitions`.

| Parameter           | Type | Required | Notes                                                       |
| ------------------- | ---- | -------- | ----------------------------------------------------------- |
| `p_definition_id`   | uuid | yes      | The field (`record_field_definitions.id`).                  |
| `p_quantity`        | json | no       | The quantity, such as `{ "kind": "volume", "unit": "mL" }`. |
| `p_cardinality`     | text | no       | `one` or `many`.                                            |
| `p_category_source` | json | no       | Where the choices of a category come from.                  |
| `p_relationship`    | json | no       | For a reference: `{ "targetModelKey": "…" }`.               |

### `preview_model_field_evolution`

Check a field change before making it

Says what changing or retiring a field in use would do to existing records: how many hold a value, and whether the change is safe, needs confirming or is blocked. `p_action` is `update` or `retire`.

Scope: `schema:read`. Returns `json`.

| Parameter         | Type | Required | Notes                                      |
| ----------------- | ---- | -------- | ------------------------------------------ |
| `p_definition_id` | uuid | yes      | The field (`record_field_definitions.id`). |
| `p_action`        | text | yes      | `update` or `retire`.                      |
| `p_patch`         | json | no       | For `update`, the columns that change.     |

### `apply_model_field_evolution`

Change or retire a field that records already use

Makes a change `preview_model_field_evolution` checked. A change that needs confirming is refused with `SB071` unless `p_confirm` is true; one that would lose data is refused with `SB072`.

Scope: `schema:write`. Returns `json`.

| Parameter         | Type | Required | Notes                                                 |
| ----------------- | ---- | -------- | ----------------------------------------------------- |
| `p_definition_id` | uuid | yes      | The field (`record_field_definitions.id`).            |
| `p_action`        | text | yes      | `update` or `retire`.                                 |
| `p_patch`         | json | no       | For `update`, the columns that change.                |
| `p_confirm`       | bool | no       | true to go ahead with a change that needs confirming. |

### `model_field_usage`

How many records use a field

Counts the records that hold a value in a field.

Scope: `schema:read`. Returns `bigint`.

| Parameter         | Type | Required | Notes                                      |
| ----------------- | ---- | -------- | ------------------------------------------ |
| `p_definition_id` | uuid | yes      | The field (`record_field_definitions.id`). |

### `create_model_field_option`

Add a choice to a category field

Adds a choice to a category field, such as `frozen` / Frozen to a Status field. Returns the option.

Scope: `schema:write`. Returns `row:model_field_options`.

| Parameter         | Type | Required | Notes                                      |
| ----------------- | ---- | -------- | ------------------------------------------ |
| `p_definition_id` | uuid | yes      | The field (`record_field_definitions.id`). |
| `p_key`           | text | yes      | What is stored, such as `frozen`.          |
| `p_label`         | text | yes      | What people see, such as Frozen.           |
| `p_display_order` | int  | no       | Where it sits in the list.                 |

Events:

- `model.field.option.created`: A choice was added to a category field.
- `model.field.option.updated`: A choice on a category field was renamed, moved or retired.

### `update_model_field_option`

Rename or move a choice on a category field

Changes the label people see for a choice, or where it sits. What is stored does not change. Returns the option.

Scope: `schema:write`. Returns `row:model_field_options`.

| Parameter         | Type | Required | Notes                                  |
| ----------------- | ---- | -------- | -------------------------------------- |
| `p_option_id`     | uuid | yes      | The option (`model_field_options.id`). |
| `p_label`         | text | yes      |                                        |
| `p_display_order` | int  | yes      | Where it sits in the list.             |

### `retire_model_field_option`

Retire a choice on a category field

Stops a choice being offered. Records that already have it keep it. Returns the option.

Scope: `schema:write`. Returns `row:model_field_options`.

| Parameter     | Type | Required | Notes                                  |
| ------------- | ---- | -------- | -------------------------------------- |
| `p_option_id` | uuid | yes      | The option (`model_field_options.id`). |

### `list_model_rules`

List the rules on record types

The rules that check records of a type, or of every type when `p_model_key` is left out: which fields each looks at, its condition, and whether it warns or blocks.

Scope: `schema:read`. Returns `rows:id=uuid,model_key=text,name=text,field_keys=text[],condition=json,effect=text,message=text,created_at=ts,updated_at=ts`.

| Parameter        | Type | Required | Notes                                  |
| ---------------- | ---- | -------- | -------------------------------------- |
| `p_workspace_id` | uuid | yes      | Your workspace id.                     |
| `p_model_key`    | text | no       | One record type, or leave out for all. |

### `create_model_rule`

Add a rule to a record type

Adds a check on records of a type, such as “Passage must be under 30”. `p_effect` is `warn` (shown, not enforced), `block` (refuses the save) or `flag_block_submit` (can be saved, cannot be submitted). Returns the rule.

Scope: `schema:write`. Returns `row:model_rules`.

| Parameter        | Type   | Required | Notes                                                                                    |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------------------------- |
| `p_workspace_id` | uuid   | yes      | Your workspace id.                                                                       |
| `p_model_key`    | text   | yes      | Key of the record type (model), such as `cell_line`.                                     |
| `p_name`         | text   | yes      |                                                                                          |
| `p_field_keys`   | text[] | yes      | The fields the rule looks at.                                                            |
| `p_condition`    | json   | yes      | When the rule fails, as JSON, such as `{ "field": "passage", "op": "gt", "value": 30 }`. |
| `p_effect`       | text   | yes      | `warn`, `block` or `flag_block_submit`.                                                  |
| `p_message`      | text   | yes      | What people see when it fails.                                                           |

Events:

- `model.rule.created`: A rule was added to a record type.
- `model.rule.updated`: A rule on a record type was changed.
- `model.rule.removed`: A rule was taken off a record type.

### `update_model_rule`

Change a rule on a record type

Changes a rule’s name, fields, condition, effect or message. `p_patch` holds only what changes. Returns the rule.

Scope: `schema:write`. Returns `row:model_rules`.

| Parameter   | Type | Required | Notes                                                                      |
| ----------- | ---- | -------- | -------------------------------------------------------------------------- |
| `p_rule_id` | uuid | yes      | The rule id.                                                               |
| `p_patch`   | json | yes      | Only what changes: `name`, `field_keys`, `condition`, `effect`, `message`. |

### `remove_model_rule`

Remove a rule from a record type

Takes a rule off a record type.

Scope: `schema:write`. Returns `void`.

| Parameter   | Type | Required | Notes        |
| ----------- | ---- | -------- | ------------ |
| `p_rule_id` | uuid | yes      | The rule id. |

### `configure_model_relationship_rule`

Set how records of one type link to another

Says how many links of a kind a record must or may have to records of another type, such as “every Lot links to exactly one Compound” (`p_min_links` 1, `p_max_links` 1). Setting it again for the same pair changes it. Returns the rule.

Scope: `schema:write`. Returns `row:model_relationship_rules`.

| Parameter            | Type | Required | Notes                                     |
| -------------------- | ---- | -------- | ----------------------------------------- |
| `p_workspace_id`     | uuid | yes      | Your workspace id.                        |
| `p_source_model_key` | text | yes      | The type the link is from.                |
| `p_link_type`        | text | yes      | The kind of link, such as `derived_from`. |
| `p_target_model_key` | text | yes      | The type the link is to.                  |
| `p_min_links`        | int  | no       | At least this many. 0 or more.            |
| `p_max_links`        | int  | no       | At most this many, or null for no limit.  |
| `p_label`            | text | no       | What people see for the link.             |

Events:

- `model.link_rule.set`: A rule for how two record types link was set or changed.
- `model.link_rule.removed`: A rule for how two record types link was removed.

### `remove_model_relationship_rule`

Remove a rule for how record types link

Takes off a rule for how records of two types link.

Scope: `schema:write`. Returns `void`.

| Parameter   | Type | Required | Notes        |
| ----------- | ---- | -------- | ------------ |
| `p_rule_id` | uuid | yes      | The rule id. |

### `create_record_model_version`

Start a new draft version of a record type

Starts a draft of the next version of a record type from the current one. Records stay on their version until it is published and they are moved onto it. Returns the version.

Scope: `schema:write`. Returns `row:record_model_versions`.

| Parameter    | Type | Required | Notes                                 |
| ------------ | ---- | -------- | ------------------------------------- |
| `p_model_id` | uuid | yes      | The record type (`record_models.id`). |
| `p_reason`   | text | yes      |                                       |

Events:

- `model.version.discarded`: A draft version of a record type was thrown away.

### `replace_record_model_version_definition`

Change a draft version of a record type

Replaces what a draft version holds (its fields, sections and layout) with `p_definition`. Returns the version.

Scope: `schema:write`. Returns `row:record_model_versions`.

| Parameter             | Type   | Required | Notes                                                                          |
| --------------------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `p_version_id`        | uuid   | yes      | The record type version (`record_model_versions.id`).                          |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`.             |
| `p_definition`        | json   | yes      | The whole definition, the same shape `record_model_versions.definition` holds. |
| `p_reason`            | text   | yes      |                                                                                |

### `discard_record_model_version`

Throw away a draft version of a record type

Deletes a draft version that was never published. A published version cannot be thrown away.

Scope: `schema:write`. Returns `void`.

| Parameter      | Type | Required | Notes                                                 |
| -------------- | ---- | -------- | ----------------------------------------------------- |
| `p_version_id` | uuid | yes      | The record type version (`record_model_versions.id`). |

### `publish_record_model_version`

Publish a draft version of a record type

Makes a draft version the current one. New records use it; existing ones stay on their version until moved. Needs `schema:publish`. Returns the version.

Scope: `schema:publish`. Returns `row:record_model_versions`.

| Parameter      | Type | Required | Notes                                                 |
| -------------- | ---- | -------- | ----------------------------------------------------- |
| `p_version_id` | uuid | yes      | The record type version (`record_model_versions.id`). |

### `record_model_version_usage`

How many records are on each version of a record type

For each version of a record type: how many records are on it, how many were made on it or moved onto it, and how many open ones could be moved.

Scope: `schema:read`. Returns `rows:version_id=uuid,record_count=int,created_record_count=int,upgraded_record_count=int,migratable_record_count=int`.

| Parameter    | Type | Required | Notes                                 |
| ------------ | ---- | -------- | ------------------------------------- |
| `p_model_id` | uuid | yes      | The record type (`record_models.id`). |

### `migrate_open_experiments_to_model_version`

Move open experiments onto a published version

Moves every experiment of the type that is not finished (draft, planned, in progress, on hold or in review) onto a published version. Signed records stay where they are. Needs `schema:publish`. Returns how many moved.

Scope: `schema:publish`. Returns `json`.

| Parameter      | Type | Required | Notes                                                 |
| -------------- | ---- | -------- | ----------------------------------------------------- |
| `p_model_id`   | uuid | yes      | The record type (`record_models.id`).                 |
| `p_version_id` | uuid | yes      | The record type version (`record_model_versions.id`). |
| `p_reason`     | text | yes      |                                                       |

### `upgrade_record_model_record`

Move one record onto a newer version of its type

Moves one record onto a published version of its type. Returns the record.

Scope: `projects:write`. Returns `row:records`.

| Parameter                     | Type   | Required | Notes                                                 |
| ----------------------------- | ------ | -------- | ----------------------------------------------------- |
| `p_record_id`                 | uuid   | yes      | The record.                                           |
| `p_version_id`                | uuid   | yes      | The record type version (`record_model_versions.id`). |
| `p_expected_metadata_version` | bigint | yes      | The record’s `metadata_version` you last read.        |
| `p_reason`                    | text   | yes      |                                                       |

### `model_record_validation`

Check a record against its type’s fields and rules

Says what is missing or wrong on a record: required fields with no value and rules that fail, each with whether it warns or blocks.

Scope: `projects:read`. Returns `json`.

| Parameter     | Type | Required | Notes       |
| ------------- | ---- | -------- | ----------- |
| `p_record_id` | uuid | yes      | The record. |

### `set_model_type`

Change a record, project or instrument to another type in its family

Moves a record, project or instrument to another type of the same family, such as Reagent to Antibody, with the new type’s field values. `p_host` is `records`, `project` or `instrument`. A signed record keeps its type.

Scope: `models:write`. Returns `json`.

| Parameter         | Type | Required | Notes                                 |
| ----------------- | ---- | -------- | ------------------------------------- |
| `p_host`          | text | yes      | `records`, `project` or `instrument`. |
| `p_id`            | uuid | yes      | The record, project or instrument.    |
| `p_model_key`     | text | yes      | Key of the new type.                  |
| `p_custom_fields` | json | yes      | Field values, keyed by field name.    |

### `set_experiment_fields`

Set an experiment’s reviewer and planned end date

Sets who reviews an experiment and when it is planned to end. Returns the record.

Scope: `projects:write`. Returns `row:records`.

| Parameter            | Type | Required | Notes                       |
| -------------------- | ---- | -------- | --------------------------- |
| `p_record_id`        | uuid | yes      | The experiment.             |
| `p_reviewer_user_id` | text | no       | The reviewer, as a user id. |
| `p_planned_end`      | date | no       | Planned end, YYYY-MM-DD.    |

### `create_sheet_definition`

Add a reusable sheet definition

Adds a reusable sheet layout (columns, parameters, calculations) with its first draft version. Returns `{ definition, version }`.

Scope: `schema:write`. Returns `json`.

| Parameter         | Type | Required | Notes                                                                                                                                 |
| ----------------- | ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `p_workspace_id`  | uuid | yes      | Your workspace id.                                                                                                                    |
| `p_key`           | text | yes      | Key, lower case letters, digits and `_`.                                                                                              |
| `p_name`          | text | yes      |                                                                                                                                       |
| `p_description`   | text | yes      |                                                                                                                                       |
| `p_configuration` | json | yes      | The sheet layout as JSON: `{ columns, parameters, calculations, … }`, the same shape `sheet_definition_versions.configuration` holds. |

### `update_sheet_definition`

Rename or describe a sheet definition

Changes a sheet definition’s name or description. `p_patch` holds only what changes. Returns the definition.

Scope: `schema:write`. Returns `row:sheet_definitions`.

| Parameter             | Type   | Required | Notes                                                              |
| --------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `p_definition_id`     | uuid   | yes      | The sheet definition (`sheet_definitions.id`).                     |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`. |
| `p_patch`             | json   | yes      | Only what changes: `name`, `description`.                          |

### `create_sheet_definition_version`

Start a new draft version of a sheet definition

Starts a draft of the next version of a sheet definition. Returns the version.

Scope: `schema:write`. Returns `row:sheet_definition_versions`.

| Parameter                        | Type   | Required | Notes                                                                                                                                 |
| -------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `p_definition_id`                | uuid   | yes      | The sheet definition (`sheet_definitions.id`).                                                                                        |
| `p_expected_definition_revision` | bigint | yes      | The definition’s `revision` you last read.                                                                                            |
| `p_configuration`                | json   | yes      | The sheet layout as JSON: `{ columns, parameters, calculations, … }`, the same shape `sheet_definition_versions.configuration` holds. |

### `update_sheet_definition_draft`

Change a draft version of a sheet definition

Replaces the layout of a draft version. A published version cannot change. Returns the version.

Scope: `schema:write`. Returns `row:sheet_definition_versions`.

| Parameter             | Type   | Required | Notes                                                                                                                                 |
| --------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `p_version_id`        | uuid   | yes      | The sheet definition version (`sheet_definition_versions.id`).                                                                        |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`.                                                                    |
| `p_configuration`     | json   | yes      | The sheet layout as JSON: `{ columns, parameters, calculations, … }`, the same shape `sheet_definition_versions.configuration` holds. |

### `publish_sheet_definition_version`

Publish a draft version of a sheet definition

Makes a draft version available for new sheets and templates. Needs `schema:publish`. Returns the version.

Scope: `schema:publish`. Returns `row:sheet_definition_versions`.

| Parameter             | Type   | Required | Notes                                                              |
| --------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `p_version_id`        | uuid   | yes      | The sheet definition version (`sheet_definition_versions.id`).     |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`. |

Events:

- `sheet.definition.version.published`: A version of a sheet definition was published.
- `sheet.definition.version.retired`: A version of a sheet definition was retired.

### `retire_sheet_definition_version`

Retire a version of a sheet definition

Stops a published version being offered for new sheets. Sheets made from it keep working. Returns the version.

Scope: `schema:write`. Returns `row:sheet_definition_versions`.

| Parameter             | Type   | Required | Notes                                                              |
| --------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `p_version_id`        | uuid   | yes      | The sheet definition version (`sheet_definition_versions.id`).     |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`. |

### `retire_sheet_definition`

Retire a sheet definition

Stops a sheet definition being offered. Sheets made from it keep working, and it can be restored. Returns the definition.

Scope: `schema:write`. Returns `row:sheet_definitions`.

| Parameter             | Type   | Required | Notes                                                              |
| --------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `p_definition_id`     | uuid   | yes      | The sheet definition (`sheet_definitions.id`).                     |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`. |

### `restore_sheet_definition`

Restore a retired sheet definition

Offers a retired sheet definition again. Returns the definition.

Scope: `schema:write`. Returns `row:sheet_definitions`.

| Parameter             | Type   | Required | Notes                                                              |
| --------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `p_definition_id`     | uuid   | yes      | The sheet definition (`sheet_definitions.id`).                     |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`. |

### `preview_sheet_definition_extraction`

Check turning part of a sheet into a reusable definition

Says what a new sheet definition made from the chosen columns of a sheet would hold, without making it. `p_selection` is `{ columnIds }`.

Scope: `sheets:read`. Returns `json`.

| Parameter                      | Type   | Required | Notes                                 |
| ------------------------------ | ------ | -------- | ------------------------------------- |
| `p_instance_id`                | uuid   | yes      | The sheet (`sheet_instances.id`).     |
| `p_expected_instance_revision` | bigint | yes      | The sheet’s `revision` you last read. |
| `p_selection`                  | json   | yes      | The columns, as `{ columnIds }`.      |

### `extract_sheet_definition_draft`

Turn part of a sheet into a reusable definition

Makes a new sheet definition, as a draft, from the chosen columns of a sheet. Returns `{ definition, version }`.

Scope: `schema:write`. Returns `json`.

| Parameter                      | Type   | Required | Notes                                 |
| ------------------------------ | ------ | -------- | ------------------------------------- |
| `p_instance_id`                | uuid   | yes      | The sheet (`sheet_instances.id`).     |
| `p_expected_instance_revision` | bigint | yes      | The sheet’s `revision` you last read. |
| `p_key`                        | text   | yes      | Key of the new definition.            |
| `p_name`                       | text   | yes      |                                       |
| `p_description`                | text   | yes      |                                       |
| `p_selection`                  | json   | yes      | The columns, as `{ columnIds }`.      |

### `preview_local_field_promotion`

Check making a sheet’s own column a shared field

Says what making a column that only one sheet has into a field of a record type (`p_target` `model_field`) or a dataset schema (`dataset_schema`) would do, without doing it.

Scope: `sheets:read`. Returns `json`.

| Parameter                | Type | Required | Notes                               |
| ------------------------ | ---- | -------- | ----------------------------------- |
| `p_instance_id`          | uuid | yes      | The sheet (`sheet_instances.id`).   |
| `p_field_id`             | uuid | yes      | The sheet column.                   |
| `p_target`               | text | yes      | `model_field` or `dataset_schema`.  |
| `p_schema_definition_id` | uuid | no       | For `dataset_schema`, the schema.   |
| `p_model_key`            | text | no       | For `model_field`, the record type. |

### `promote_local_field`

Make a sheet’s own column a shared field

Makes a column that only one sheet has into a field of a record type or a dataset schema, and points the sheet at it. Send the same `p_idempotency_key` to retry safely. Returns what changed.

Scope: `schema:write`. Returns `json`.

| Parameter                | Type   | Required | Notes                                                                                  |
| ------------------------ | ------ | -------- | -------------------------------------------------------------------------------------- |
| `p_instance_id`          | uuid   | yes      | The sheet (`sheet_instances.id`).                                                      |
| `p_field_id`             | uuid   | yes      | The sheet column.                                                                      |
| `p_target`               | text   | yes      | `model_field` or `dataset_schema`.                                                     |
| `p_schema_definition_id` | uuid   | yes      | For `dataset_schema`, the schema; null for `model_field`.                              |
| `p_idempotency_key`      | text   | yes      | Any string unique to this attempt; a retry with the same key returns the first result. |
| `p_model_key`            | text   | no       | For `model_field`, the record type.                                                    |
| `p_schema_version_id`    | uuid   | no       | For `dataset_schema`, the draft version to add it to.                                  |
| `p_expected_revision`    | bigint | no       | The `revision` of that draft version.                                                  |

### `rename_sheet_instance`

Rename a sheet

Gives a sheet a new name. Returns the sheet.

Scope: `sheets:write`. Returns `row:sheet_instances`.

| Parameter             | Type   | Required | Notes                                                              |
| --------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `p_instance_id`       | uuid   | yes      | The sheet (`sheet_instances.id`).                                  |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`. |
| `p_name`              | text   | yes      |                                                                    |

### `insert_sheet_block`

Add a measurement table block to a notebook

Adds a table block for a dataset schema to a notebook, after a block or at the end. Returns the block.

Scope: `projects:write`. Returns `json`.

| Parameter                      | Type | Required | Notes                                             |
| ------------------------------ | ---- | -------- | ------------------------------------------------- |
| `p_record_id`                  | uuid | yes      | The notebook.                                     |
| `p_after_block_id`             | uuid | no       | Put it after this block; leave out for the end.   |
| `p_expected_structure_version` | int  | no       | The notebook’s `structure_version` you last read. |
| `p_dataset_schema_id`          | uuid | no       | The dataset schema the table follows.             |

### `search_sheet_cells`

Search the values inside sheets

Finds sheets whose cells hold the words searched for, with the row, column and a snippet.

Scope: `sheets:read`. Returns `rows:instance_id=uuid,instance_name=text,project_id=uuid,row_key=text,field_label=text,value_text=text,snippet=text,rank=num`.

| Parameter | Type | Required | Notes                          |
| --------- | ---- | -------- | ------------------------------ |
| `p_query` | text | yes      | Words to look for.             |
| `p_limit` | int  | no       | At most this many. Default 20. |

### `sheet_instance_notebook_embeddings`

Which notebooks show a sheet

Lists the notebooks and blocks a sheet is shown in.

Scope: `sheets:read`. Returns `json`.

| Parameter       | Type | Required | Notes                             |
| --------------- | ---- | -------- | --------------------------------- |
| `p_instance_id` | uuid | yes      | The sheet (`sheet_instances.id`). |

### `create_notebook_template`

Add a notebook template

Adds a notebook template with its first draft version. Returns `{ template, version }`.

Scope: `schema:write`. Returns `json`.

| Parameter         | Type | Required | Notes                                                                                                                    |
| ----------------- | ---- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `p_workspace_id`  | uuid | yes      | Your workspace id.                                                                                                       |
| `p_key`           | text | yes      | Key, lower case letters, digits and `_`.                                                                                 |
| `p_name`          | text | yes      |                                                                                                                          |
| `p_description`   | text | yes      |                                                                                                                          |
| `p_configuration` | json | yes      | The template as JSON: `{ blocks, sheetPlacements, … }`, the same shape `notebook_template_versions.configuration` holds. |

### `create_notebook_template_version`

Start a new draft version of a notebook template

Starts a draft of the next version of a notebook template. Returns the version.

Scope: `schema:write`. Returns `row:notebook_template_versions`.

| Parameter                      | Type   | Required | Notes                                                                                                                    |
| ------------------------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `p_template_id`                | uuid   | yes      | The template.                                                                                                            |
| `p_expected_template_revision` | bigint | yes      | The template’s `revision` you last read.                                                                                 |
| `p_configuration`              | json   | yes      | The template as JSON: `{ blocks, sheetPlacements, … }`, the same shape `notebook_template_versions.configuration` holds. |

### `update_notebook_template_version`

Change a draft version of a notebook template

Replaces what a draft version holds. A published version cannot change. Returns the version.

Scope: `schema:write`. Returns `row:notebook_template_versions`.

| Parameter             | Type   | Required | Notes                                                                                                                    |
| --------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `p_version_id`        | uuid   | yes      | The notebook template version (`notebook_template_versions.id`).                                                         |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`.                                                       |
| `p_configuration`     | json   | yes      | The template as JSON: `{ blocks, sheetPlacements, … }`, the same shape `notebook_template_versions.configuration` holds. |

### `retarget_notebook_template_sheet_placement`

Point a sheet in a draft template at another definition version

Changes which sheet definition version a sheet in a draft template is made from. Returns the template version.

Scope: `schema:write`. Returns `row:notebook_template_versions`.

| Parameter                        | Type   | Required | Notes                                                              |
| -------------------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `p_version_id`                   | uuid   | yes      | The notebook template version (`notebook_template_versions.id`).   |
| `p_expected_revision`            | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`. |
| `p_placement_id`                 | uuid   | yes      | The sheet in the template.                                         |
| `p_target_definition_version_id` | uuid   | yes      | The sheet definition version to use.                               |

### `publish_notebook_template_version`

Publish a draft version of a notebook template

Makes a draft version the one new notebooks are made from. Needs `schema:publish`. Returns the version.

Scope: `schema:publish`. Returns `row:notebook_template_versions`.

| Parameter             | Type   | Required | Notes                                                              |
| --------------------- | ------ | -------- | ------------------------------------------------------------------ |
| `p_version_id`        | uuid   | yes      | The notebook template version (`notebook_template_versions.id`).   |
| `p_expected_revision` | bigint | yes      | The `revision` you last read. A stale one is refused with `SB001`. |
| `p_reason`            | text   | yes      |                                                                    |

Events:

- `notebook.template.version.published`: A version of a notebook template was published.
- `notebook.template.version.retired`: A version of a notebook template was retired (signed).
