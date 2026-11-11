/**
 * Models, sheets and templates: record types (models), their fields, field
 * options and rules, sheet definitions and their versions, notebook templates
 * and their versions, and the sheets made from them. One declaration each gives
 * the token API entry, the MCP action, the assistant tool name, the pipeline
 * action and the webhook events (see `docs/development/adding-an-operation.md`).
 *
 * Authoring is open to tokens behind `schema:write`; publishing a version, and
 * moving open experiments onto it, behind `schema:publish`. A personal token
 * acts as its person, so the database's own `schema.edit` / `schema.publish`
 * check still decides; a service credential has no person and is refused.
 *
 * Retiring a notebook template version is a signed act (a signature meaning,
 * from someone with a signing certificate), so it stays with a person in the
 * app and is not here.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (field: OperationInput, description: string): OperationInput => ({
  ...field,
  description,
})

const WORKSPACE = note(input('p_workspace_id', 'uuid'), 'Your workspace id.')

const MODEL_KEY = note(
  input('p_model_key', 'text'),
  'Key of the record type (model), such as `cell_line`.',
)

const FIELD_ID = note(
  input('p_definition_id', 'uuid'),
  'The field (`record_field_definitions.id`).',
)

const OPTION_ID = note(
  input('p_option_id', 'uuid'),
  'The option (`model_field_options.id`).',
)

const RULE_ID = note(input('p_rule_id', 'uuid'), 'The rule id.')

const MODEL_ID = note(
  input('p_model_id', 'uuid'),
  'The record type (`record_models.id`).',
)

const MODEL_VERSION_ID = note(
  input('p_version_id', 'uuid'),
  'The record type version (`record_model_versions.id`).',
)

const SHEET_DEFINITION_ID = note(
  input('p_definition_id', 'uuid'),
  'The sheet definition (`sheet_definitions.id`).',
)

const SHEET_VERSION_ID = note(
  input('p_version_id', 'uuid'),
  'The sheet definition version (`sheet_definition_versions.id`).',
)

const TEMPLATE_VERSION_ID = note(
  input('p_version_id', 'uuid'),
  'The notebook template version (`notebook_template_versions.id`).',
)

const INSTANCE_ID = note(
  input('p_instance_id', 'uuid'),
  'The sheet (`sheet_instances.id`).',
)

const EXPECTED_REVISION = note(
  input('p_expected_revision', 'bigint'),
  'The `revision` you last read. A stale one is refused with `SB001`.',
)

const SHEET_CONFIGURATION = note(
  input('p_configuration', 'json'),
  'The sheet layout as JSON: `{ columns, parameters, calculations, … }`, the same shape `sheet_definition_versions.configuration` holds.',
)

const TEMPLATE_CONFIGURATION = note(
  input('p_configuration', 'json'),
  'The template as JSON: `{ blocks, sheetPlacements, … }`, the same shape `notebook_template_versions.configuration` holds.',
)

const DESCRIPTION = note(
  input('p_description', 'text', false, true),
  'A description.',
)

const SCHEMA_WRITE = 'schema:write' as const
const SCHEMA_PUBLISH = 'schema:publish' as const
const SCHEMA_READ = 'schema:read' as const

const MODEL_FAMILY = 'administration' as const

export const SCHEMA_OPERATIONS = defineOperations([
  // -- Record types (models) ------------------------------------------------
  {
    name: 'create_workspace_model',
    label: 'Add a record type',
    summary: 'Add a record type',
    description:
      'Adds a record type (model) to the workspace, such as Cell line or Supplier, with the prefix its identifiers start with. It starts with a draft version to add fields to. Returns the type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      WORKSPACE,
      note(
        input('p_key', 'text'),
        'Key, lower case letters, digits and `_`, such as `cell_line`.',
      ),
      input('p_name', 'text'),
      note(
        input('p_identifier_prefix', 'text'),
        'What identifiers start with, such as `CL`.',
      ),
      DESCRIPTION,
    ],
    result: 'row:record_models',
    assistant: { tool: 'sheetbase.model.create' },
    pipeline: {},
  },
  {
    name: 'create_model_subtype',
    label: 'Add a kind of a record type',
    summary: 'Add a kind of a record type',
    description:
      'Adds a record type that is a kind of another, such as Antibody under Reagent. It has the parent’s fields and can add its own. Returns the new type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      WORKSPACE,
      note(input('p_parent_key', 'text'), 'Key of the parent record type.'),
      note(input('p_key', 'text'), 'Key of the new type.'),
      input('p_name', 'text'),
      note(
        input('p_identifier_prefix', 'text'),
        'What identifiers start with.',
      ),
      DESCRIPTION,
    ],
    result: 'row:record_models',
    assistant: { tool: 'sheetbase.model.add_subtype' },
    pipeline: {},
  },
  {
    name: 'reparent_record_model',
    label: 'Move a record type under another',
    summary: 'Move a record type under another',
    description:
      'Makes a record type a kind of another one, or a top-level type again when `p_parent_key` is null. Returns the type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      MODEL_ID,
      note(
        input('p_parent_key', 'text', true, true),
        'Key of the new parent, or null for none.',
      ),
    ],
    result: 'row:record_models',
    pipeline: {},
  },
  {
    name: 'create_registry_model',
    label: 'Add a registry',
    summary: 'Add a registry',
    description:
      'Adds a record type that works as a registry (cell lines, constructs): entries get a running number and likely duplicates are refused by the key fields. `p_fields` is a JSON list of `{ name, label, type, required, options }`. Returns the type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      input('p_key', 'text'),
      input('p_name', 'text'),
      note(input('p_prefix', 'text'), 'What identifiers start with.'),
      input('p_description', 'text', true, true),
      note(
        input('p_fields', 'json'),
        'JSON list of `{ name, label, type, required, options }`.',
      ),
      note(
        input('p_key_fields', 'text[]'),
        'Fields that together say two entries are the same thing.',
      ),
      note(
        input('p_sequence_field', 'text', false, true),
        'The field that holds the running number.',
      ),
    ],
    result: 'row:record_models',
    pipeline: {},
  },
  {
    name: 'create_request_model',
    label: 'Add a request form',
    summary: 'Add a request form',
    description:
      'Adds a record type that people send as a request (a sequencing request, a stores order), with an intro shown on the form. `p_fields` is a JSON list of `{ name, label, type, required, options }`. Returns the type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      input('p_key', 'text'),
      input('p_name', 'text'),
      note(input('p_prefix', 'text'), 'What identifiers start with.'),
      input('p_description', 'text', true, true),
      note(
        input('p_fields', 'json'),
        'JSON list of `{ name, label, type, required, options }`.',
      ),
      note(
        input('p_intro', 'text', false, true),
        'Text shown at the top of the form.',
      ),
    ],
    result: 'row:record_models',
    pipeline: {},
  },
  {
    name: 'create_starter_model',
    label: 'Add a record type from a starter',
    summary: 'Add a record type from a starter',
    description:
      'Adds a record type with its fields in one go, optionally used as an incident log. `p_fields` is a JSON list of `{ name, label, type, required, options }`. Returns the type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      input('p_key', 'text'),
      input('p_name', 'text'),
      note(input('p_prefix', 'text'), 'What identifiers start with.'),
      input('p_description', 'text', true, true),
      note(
        input('p_fields', 'json'),
        'JSON list of `{ name, label, type, required, options }`.',
      ),
      note(
        input('p_incident_log', 'bool', false),
        'true to use it as an incident log.',
      ),
    ],
    result: 'row:record_models',
    pipeline: {},
  },
  {
    name: 'set_model_registry',
    label: 'Make a record type a registry',
    summary: 'Make a record type a registry, or not',
    description:
      'Turns a record type into a registry (or back), with the fields that say two entries are the same thing and the field that holds the running number. Returns the type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      MODEL_KEY,
      input('p_is_registry', 'bool'),
      note(
        input('p_key_fields', 'text[]', false),
        'Fields that together say two entries are the same thing.',
      ),
      note(
        input('p_sequence_field', 'text', false, true),
        'The field that holds the running number.',
      ),
    ],
    result: 'row:record_models',
    pipeline: {},
  },
  {
    name: 'set_registry_lot_kind',
    label: 'Choose a registry’s lot type',
    summary: 'Choose the record type a registry’s lots are',
    description:
      'Says which record type the lots of a registry entry are, such as Compound lot. Null takes it off. Returns the registry’s type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      MODEL_KEY,
      note(
        input('p_lot_kind', 'text', false, true),
        'Key of the lot record type, or null.',
      ),
    ],
    result: 'row:record_models',
    pipeline: {},
  },
  {
    name: 'set_registry_sameness_rule',
    label: 'Choose a registry’s same-thing rule',
    summary: 'Choose the plugin rule that spots duplicates in a registry',
    description:
      'Picks the plugin rule that decides when two entries of a registry are the same thing. `p_plugin_item` is `plugin.<plugin>.<rule>`; null goes back to the key fields.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      MODEL_KEY,
      note(
        input('p_plugin_item', 'text', true, true),
        '`plugin.<plugin>.<rule>`, or null.',
      ),
    ],
    result: 'void',
    pipeline: {},
  },
  {
    name: 'set_model_incident_log',
    label: 'Use a record type as an incident log',
    summary: 'Use a record type as an incident log, or not',
    description:
      'Turns incident log behaviour on or off for a record type: entries show in the incident list with their severity and follow-up. Returns whether it is on.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [MODEL_KEY, input('p_enabled', 'bool')],
    result: 'bool',
    pipeline: {},
  },
  {
    name: 'set_request_form',
    label: 'Take requests on a record type',
    summary: 'Take requests on a record type, or stop',
    description:
      'Says whether people can send a record type as a request, the intro on the form, and who handles requests.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      MODEL_KEY,
      input('p_accepts', 'bool'),
      note(
        input('p_intro', 'text', false, true),
        'Text shown at the top of the form.',
      ),
      note(
        input('p_handler_user_ids', 'text[]', false),
        'Who handles requests, as user ids.',
      ),
    ],
    result: 'void',
    pipeline: {},
  },
  {
    name: 'discover_model_dependencies',
    label: 'What uses a record type',
    summary: 'What uses a record type',
    description:
      'Lists what depends on a record type: its records, fields, rules, links from other types, sheets, templates and pipelines. Read it before retiring or changing a type.',
    kind: 'read',
    scope: SCHEMA_READ,
    inputs: [MODEL_KEY],
    assistant: { tool: 'sheetbase.model.dependencies' },
  },

  // -- Fields -----------------------------------------------------------------
  {
    name: 'create_model_field',
    label: 'Add a draft field',
    summary: 'Add a draft field to a record type',
    description:
      'Adds a field to a record type as a draft. It does nothing on records until it is switched on (`activate_model_field`). `p_logical_type` is `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category` or `reference`. Returns the field.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    api: 'lab',
    inputs: [
      WORKSPACE,
      MODEL_KEY,
      note(
        input('p_field_name', 'text'),
        'Field name: lower case letters, digits and `_`.',
      ),
      input('p_label', 'text'),
      note(
        input('p_logical_type', 'text'),
        '`text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category` or `reference`.',
      ),
      note(input('p_nullable', 'bool', false), 'false makes it required.'),
      note(
        input('p_default_value', 'json', false, true),
        'Default value, as JSON.',
      ),
      note(
        input('p_validation', 'json', false),
        'Checks as JSON, such as `{ "min": 0, "max": 100 }`.',
      ),
      note(
        input('p_unit', 'json', false, true),
        'Unit as JSON, such as `{ "symbol": "mL" }`.',
      ),
      DESCRIPTION,
    ],
    result: 'row:record_field_definitions',
    pipeline: {},
  },
  {
    name: 'create_and_activate_model_field',
    label: 'Add a field and switch it on',
    summary: 'Add a field to a record type and switch it on',
    description:
      'Adds a field and switches it on in one go, with the choices of a category field. `p_options` is a JSON list of `{ key, label }`. Returns the field.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      WORKSPACE,
      MODEL_KEY,
      note(
        input('p_field_name', 'text'),
        'Field name: lower case letters, digits and `_`.',
      ),
      input('p_label', 'text'),
      note(
        input('p_logical_type', 'text'),
        '`text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category` or `reference`.',
      ),
      note(input('p_nullable', 'bool'), 'false makes it required.'),
      note(
        input('p_default_value', 'json', true, true),
        'Default value, as JSON, or null.',
      ),
      note(
        input('p_validation', 'json'),
        'Checks as JSON, such as `{}` or `{ "min": 0 }`.',
      ),
      note(
        input('p_options', 'json', false),
        'Choices of a category field, as `[{ key, label }]`.',
      ),
      note(
        input('p_unit', 'json', false, true),
        'Unit as JSON, such as `{ "symbol": "mL" }`.',
      ),
      DESCRIPTION,
    ],
    result: 'row:record_field_definitions',
    pipeline: {},
  },
  {
    name: 'activate_model_field',
    label: 'Switch a field on',
    summary: 'Switch a draft field on',
    description:
      'Switches a draft field on, so records of the type show and keep it. Returns the field.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    api: 'lab',
    inputs: [FIELD_ID],
    result: 'row:record_field_definitions',
    pipeline: {},
  },
  {
    name: 'update_model_field',
    label: 'Change a field',
    summary: 'Change a field',
    description:
      'Changes a field’s label, description, order, section, unit or checks. `p_patch` holds only what changes, such as `{ "label": "Passage", "show_in_list": true }`. A change that would break existing values goes through `apply_model_field_evolution`. Returns the field.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    api: 'lab',
    inputs: [
      FIELD_ID,
      note(input('p_patch', 'json'), 'Only the columns that change.'),
    ],
    result: 'row:record_field_definitions',
    pipeline: {},
  },
  {
    name: 'retire_model_field',
    label: 'Retire a field',
    summary: 'Retire a field',
    description:
      'Takes a field out of use. Values already kept on records stay; new records no longer show it. Returns the field.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [FIELD_ID],
    result: 'row:record_field_definitions',
    assistant: { tool: 'sheetbase.model_field.retire' },
    pipeline: {},
  },
  {
    name: 'configure_model_field_semantics',
    label: 'Say what a draft field measures',
    summary: 'Say what a draft field measures',
    description:
      'Sets what a draft field means: the quantity and unit it measures, one value or many, where a category’s choices come from, or which record type a reference points at. Returns the field.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      FIELD_ID,
      note(
        input('p_quantity', 'json', false, true),
        'The quantity, such as `{ "kind": "volume", "unit": "mL" }`.',
      ),
      note(input('p_cardinality', 'text', false), '`one` or `many`.'),
      note(
        input('p_category_source', 'json', false, true),
        'Where the choices of a category come from.',
      ),
      note(
        input('p_relationship', 'json', false, true),
        'For a reference: `{ "targetModelKey": "…" }`.',
      ),
    ],
    result: 'row:record_field_definitions',
    pipeline: {},
  },
  {
    name: 'preview_model_field_evolution',
    label: 'Check a field change before making it',
    summary: 'Check a field change before making it',
    description:
      'Says what changing or retiring a field in use would do to existing records: how many hold a value, and whether the change is safe, needs confirming or is blocked. `p_action` is `update` or `retire`.',
    kind: 'read',
    scope: SCHEMA_READ,
    inputs: [
      FIELD_ID,
      note(input('p_action', 'text'), '`update` or `retire`.'),
      note(
        input('p_patch', 'json', false),
        'For `update`, the columns that change.',
      ),
    ],
  },
  {
    name: 'apply_model_field_evolution',
    label: 'Change a field in use',
    summary: 'Change or retire a field that records already use',
    description:
      'Makes a change `preview_model_field_evolution` checked. A change that needs confirming is refused with `SB071` unless `p_confirm` is true; one that would lose data is refused with `SB072`.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      FIELD_ID,
      note(input('p_action', 'text'), '`update` or `retire`.'),
      note(
        input('p_patch', 'json', false),
        'For `update`, the columns that change.',
      ),
      note(
        input('p_confirm', 'bool', false),
        'true to go ahead with a change that needs confirming.',
      ),
    ],
    pipeline: {},
  },
  {
    name: 'model_field_usage',
    label: 'How many records use a field',
    summary: 'How many records use a field',
    description: 'Counts the records that hold a value in a field.',
    kind: 'read',
    scope: SCHEMA_READ,
    inputs: [FIELD_ID],
    result: 'bigint',
  },

  // -- Field options ----------------------------------------------------------
  {
    name: 'create_model_field_option',
    label: 'Add a choice to a category field',
    summary: 'Add a choice to a category field',
    description:
      'Adds a choice to a category field, such as `frozen` / Frozen to a Status field. Returns the option.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      FIELD_ID,
      note(input('p_key', 'text'), 'What is stored, such as `frozen`.'),
      note(input('p_label', 'text'), 'What people see, such as Frozen.'),
      note(
        input('p_display_order', 'int', false),
        'Where it sits in the list.',
      ),
    ],
    result: 'row:model_field_options',
    assistant: { tool: 'sheetbase.model_field.add_option' },
    pipeline: {},
    events: [
      {
        name: 'model.field.option.created',
        family: MODEL_FAMILY,
        summary: 'A choice was added to a category field.',
        producer: { entityType: 'model_field_option', operation: 'create' },
        notes:
          'Payload is the option row: id, definition_id, key, label, display_order and lifecycle.',
      },
      {
        name: 'model.field.option.updated',
        family: MODEL_FAMILY,
        summary: 'A choice on a category field was renamed, moved or retired.',
        producer: { entityType: 'model_field_option', operation: 'update' },
        notes:
          'Payload is the option row as it is now; `lifecycle` is `retired` once retired.',
      },
    ],
  },
  {
    name: 'update_model_field_option',
    label: 'Rename or move a choice',
    summary: 'Rename or move a choice on a category field',
    description:
      'Changes the label people see for a choice, or where it sits. What is stored does not change. Returns the option.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      OPTION_ID,
      input('p_label', 'text'),
      note(input('p_display_order', 'int'), 'Where it sits in the list.'),
    ],
    result: 'row:model_field_options',
    assistant: { tool: 'sheetbase.model_field.rename_option' },
    pipeline: {},
  },
  {
    name: 'retire_model_field_option',
    label: 'Retire a choice',
    summary: 'Retire a choice on a category field',
    description:
      'Stops a choice being offered. Records that already have it keep it. Returns the option.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [OPTION_ID],
    result: 'row:model_field_options',
    assistant: { tool: 'sheetbase.model_field.retire_option' },
    pipeline: {},
  },

  // -- Rules ------------------------------------------------------------------
  {
    name: 'list_model_rules',
    label: 'List a record type’s rules',
    summary: 'List the rules on record types',
    description:
      'The rules that check records of a type, or of every type when `p_model_key` is left out: which fields each looks at, its condition, and whether it warns or blocks.',
    kind: 'read',
    scope: SCHEMA_READ,
    inputs: [
      WORKSPACE,
      note(
        input('p_model_key', 'text', false, true),
        'One record type, or leave out for all.',
      ),
    ],
    result:
      'rows:id=uuid,model_key=text,name=text,field_keys=text[],condition=json,effect=text,message=text,created_at=ts,updated_at=ts',
  },
  {
    name: 'create_model_rule',
    label: 'Add a rule to a record type',
    summary: 'Add a rule to a record type',
    description:
      'Adds a check on records of a type, such as “Passage must be under 30”. `p_effect` is `warn` (shown, not enforced), `block` (refuses the save) or `flag_block_submit` (can be saved, cannot be submitted). Returns the rule.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      WORKSPACE,
      MODEL_KEY,
      input('p_name', 'text'),
      note(input('p_field_keys', 'text[]'), 'The fields the rule looks at.'),
      note(
        input('p_condition', 'json'),
        'When the rule fails, as JSON, such as `{ "field": "passage", "op": "gt", "value": 30 }`.',
      ),
      note(
        input('p_effect', 'text'),
        '`warn`, `block` or `flag_block_submit`.',
      ),
      note(input('p_message', 'text'), 'What people see when it fails.'),
    ],
    result: 'row:model_rules',
    assistant: { tool: 'sheetbase.model_rule.add' },
    pipeline: {},
    events: [
      {
        name: 'model.rule.created',
        family: MODEL_FAMILY,
        summary: 'A rule was added to a record type.',
        producer: { entityType: 'model_rule', operation: 'create' },
        notes: 'Payload carries modelKey, name, effect and fieldKeys.',
      },
      {
        name: 'model.rule.updated',
        family: MODEL_FAMILY,
        summary: 'A rule on a record type was changed.',
        producer: { entityType: 'model_rule', operation: 'update' },
        notes:
          'Payload carries modelKey, name, effect and `changes` ({ column: { from, to } }).',
      },
      {
        name: 'model.rule.removed',
        family: MODEL_FAMILY,
        summary: 'A rule was taken off a record type.',
        producer: { entityType: 'model_rule', operation: 'delete' },
      },
    ],
  },
  {
    name: 'update_model_rule',
    label: 'Change a rule',
    summary: 'Change a rule on a record type',
    description:
      'Changes a rule’s name, fields, condition, effect or message. `p_patch` holds only what changes. Returns the rule.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      RULE_ID,
      note(
        input('p_patch', 'json'),
        'Only what changes: `name`, `field_keys`, `condition`, `effect`, `message`.',
      ),
    ],
    result: 'row:model_rules',
    assistant: { tool: 'sheetbase.model_rule.update' },
    pipeline: {},
  },
  {
    name: 'remove_model_rule',
    label: 'Remove a rule',
    summary: 'Remove a rule from a record type',
    description: 'Takes a rule off a record type.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [RULE_ID],
    result: 'void',
    assistant: { tool: 'sheetbase.model_rule.remove' },
    pipeline: {},
  },
  {
    name: 'configure_model_relationship_rule',
    label: 'Set how record types link',
    summary: 'Set how records of one type link to another',
    description:
      'Says how many links of a kind a record must or may have to records of another type, such as “every Lot links to exactly one Compound” (`p_min_links` 1, `p_max_links` 1). Setting it again for the same pair changes it. Returns the rule.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      WORKSPACE,
      note(input('p_source_model_key', 'text'), 'The type the link is from.'),
      note(
        input('p_link_type', 'text'),
        'The kind of link, such as `derived_from`.',
      ),
      note(input('p_target_model_key', 'text'), 'The type the link is to.'),
      note(
        input('p_min_links', 'int', false),
        'At least this many. 0 or more.',
      ),
      note(
        input('p_max_links', 'int', false, true),
        'At most this many, or null for no limit.',
      ),
      note(
        input('p_label', 'text', false, true),
        'What people see for the link.',
      ),
    ],
    result: 'row:model_relationship_rules',
    assistant: { tool: 'sheetbase.model_link_rule.set' },
    pipeline: {},
    events: [
      {
        name: 'model.link_rule.set',
        family: MODEL_FAMILY,
        summary: 'A rule for how two record types link was set or changed.',
        producer: {
          entityType: 'model_relationship_rule',
          operation: 'update',
        },
        notes:
          'Payload carries sourceModelKey, linkType, targetModelKey, minLinks and maxLinks.',
      },
      {
        name: 'model.link_rule.removed',
        family: MODEL_FAMILY,
        summary: 'A rule for how two record types link was removed.',
        producer: {
          entityType: 'model_relationship_rule',
          operation: 'delete',
        },
      },
    ],
  },
  {
    name: 'remove_model_relationship_rule',
    label: 'Remove a link rule',
    summary: 'Remove a rule for how record types link',
    description: 'Takes off a rule for how records of two types link.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [RULE_ID],
    result: 'void',
    assistant: { tool: 'sheetbase.model_link_rule.remove' },
    pipeline: {},
  },

  // -- Versions of a record type --------------------------------------------
  {
    name: 'create_record_model_version',
    label: 'Start a new version of a record type',
    summary: 'Start a new draft version of a record type',
    description:
      'Starts a draft of the next version of a record type from the current one. Records stay on their version until it is published and they are moved onto it. Returns the version.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [MODEL_ID, input('p_reason', 'text')],
    result: 'row:record_model_versions',
    assistant: { tool: 'sheetbase.model_version.start' },
    pipeline: {},
    events: [
      {
        name: 'model.version.discarded',
        family: MODEL_FAMILY,
        summary: 'A draft version of a record type was thrown away.',
        producer: { entityType: 'record_model_version', operation: 'delete' },
      },
    ],
  },
  {
    name: 'replace_record_model_version_definition',
    label: 'Change a draft version of a record type',
    summary: 'Change a draft version of a record type',
    description:
      'Replaces what a draft version holds (its fields, sections and layout) with `p_definition`. Returns the version.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      MODEL_VERSION_ID,
      EXPECTED_REVISION,
      note(
        input('p_definition', 'json'),
        'The whole definition, the same shape `record_model_versions.definition` holds.',
      ),
      input('p_reason', 'text'),
    ],
    result: 'row:record_model_versions',
    pipeline: {},
  },
  {
    name: 'discard_record_model_version',
    label: 'Throw away a draft version of a record type',
    summary: 'Throw away a draft version of a record type',
    description:
      'Deletes a draft version that was never published. A published version cannot be thrown away.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [MODEL_VERSION_ID],
    result: 'void',
    pipeline: {},
  },
  {
    name: 'publish_record_model_version',
    label: 'Publish a version of a record type',
    summary: 'Publish a draft version of a record type',
    description:
      'Makes a draft version the current one. New records use it; existing ones stay on their version until moved. Needs `schema:publish`. Returns the version.',
    kind: 'write',
    scope: SCHEMA_PUBLISH,
    inputs: [MODEL_VERSION_ID],
    result: 'row:record_model_versions',
    assistant: { tool: 'sheetbase.model_version.publish' },
    pipeline: {},
  },
  {
    name: 'record_model_version_usage',
    label: 'Which records are on each version',
    summary: 'How many records are on each version of a record type',
    description:
      'For each version of a record type: how many records are on it, how many were made on it or moved onto it, and how many open ones could be moved.',
    kind: 'read',
    scope: SCHEMA_READ,
    inputs: [MODEL_ID],
    result:
      'rows:version_id=uuid,record_count=int,created_record_count=int,upgraded_record_count=int,migratable_record_count=int',
  },
  {
    name: 'migrate_open_experiments_to_model_version',
    label: 'Move open experiments onto a version',
    summary: 'Move open experiments onto a published version',
    description:
      'Moves every experiment of the type that is not finished (draft, planned, in progress, on hold or in review) onto a published version. Signed records stay where they are. Needs `schema:publish`. Returns how many moved.',
    kind: 'write',
    scope: SCHEMA_PUBLISH,
    inputs: [MODEL_ID, MODEL_VERSION_ID, input('p_reason', 'text')],
    pipeline: {},
  },
  {
    name: 'upgrade_record_model_record',
    label: 'Move a record onto a newer version',
    summary: 'Move one record onto a newer version of its type',
    description:
      'Moves one record onto a published version of its type. Returns the record.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      note(input('p_record_id', 'uuid'), 'The record.'),
      MODEL_VERSION_ID,
      note(
        input('p_expected_metadata_version', 'bigint'),
        'The record’s `metadata_version` you last read.',
      ),
      input('p_reason', 'text'),
    ],
    result: 'row:records',
    pipeline: {},
  },

  // -- Records of a type ------------------------------------------------------
  {
    name: 'model_record_validation',
    label: 'Check a record against its type',
    summary: 'Check a record against its type’s fields and rules',
    description:
      'Says what is missing or wrong on a record: required fields with no value and rules that fail, each with whether it warns or blocks.',
    kind: 'read',
    scope: 'projects:read',
    inputs: [note(input('p_record_id', 'uuid'), 'The record.')],
  },
  {
    name: 'set_model_type',
    label: 'Change what type a record is',
    summary:
      'Change a record, project or instrument to another type in its family',
    description:
      'Moves a record, project or instrument to another type of the same family, such as Reagent to Antibody, with the new type’s field values. `p_host` is `records`, `project` or `instrument`. A signed record keeps its type.',
    kind: 'write',
    scope: 'models:write',
    inputs: [
      note(input('p_host', 'text'), '`records`, `project` or `instrument`.'),
      note(input('p_id', 'uuid'), 'The record, project or instrument.'),
      note(input('p_model_key', 'text'), 'Key of the new type.'),
      note(
        input('p_custom_fields', 'json'),
        'Field values, keyed by field name.',
      ),
    ],
    pipeline: {},
  },
  {
    name: 'set_experiment_fields',
    label: 'Set an experiment’s reviewer and end date',
    summary: 'Set an experiment’s reviewer and planned end date',
    description:
      'Sets who reviews an experiment and when it is planned to end. Returns the record.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      note(input('p_record_id', 'uuid'), 'The experiment.'),
      note(
        input('p_reviewer_user_id', 'text', false, true),
        'The reviewer, as a user id.',
      ),
      note(
        input('p_planned_end', 'date', false, true),
        'Planned end, YYYY-MM-DD.',
      ),
    ],
    result: 'row:records',
    pipeline: {},
  },

  // -- Sheet definitions --------------------------------------------------------
  {
    name: 'create_sheet_definition',
    label: 'Add a sheet definition',
    summary: 'Add a reusable sheet definition',
    description:
      'Adds a reusable sheet layout (columns, parameters, calculations) with its first draft version. Returns `{ definition, version }`.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      WORKSPACE,
      note(input('p_key', 'text'), 'Key, lower case letters, digits and `_`.'),
      input('p_name', 'text'),
      input('p_description', 'text', true, true),
      SHEET_CONFIGURATION,
    ],
    pipeline: {},
  },
  {
    name: 'update_sheet_definition',
    label: 'Rename a sheet definition',
    summary: 'Rename or describe a sheet definition',
    description:
      'Changes a sheet definition’s name or description. `p_patch` holds only what changes. Returns the definition.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      SHEET_DEFINITION_ID,
      EXPECTED_REVISION,
      note(
        input('p_patch', 'json'),
        'Only what changes: `name`, `description`.',
      ),
    ],
    result: 'row:sheet_definitions',
    pipeline: {},
  },
  {
    name: 'create_sheet_definition_version',
    label: 'Start a new version of a sheet definition',
    summary: 'Start a new draft version of a sheet definition',
    description:
      'Starts a draft of the next version of a sheet definition. Returns the version.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      SHEET_DEFINITION_ID,
      note(
        input('p_expected_definition_revision', 'bigint'),
        'The definition’s `revision` you last read.',
      ),
      SHEET_CONFIGURATION,
    ],
    result: 'row:sheet_definition_versions',
    pipeline: {},
  },
  {
    name: 'update_sheet_definition_draft',
    label: 'Change a draft sheet definition',
    summary: 'Change a draft version of a sheet definition',
    description:
      'Replaces the layout of a draft version. A published version cannot change. Returns the version.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [SHEET_VERSION_ID, EXPECTED_REVISION, SHEET_CONFIGURATION],
    result: 'row:sheet_definition_versions',
    pipeline: {},
  },
  {
    name: 'publish_sheet_definition_version',
    label: 'Publish a sheet definition',
    summary: 'Publish a draft version of a sheet definition',
    description:
      'Makes a draft version available for new sheets and templates. Needs `schema:publish`. Returns the version.',
    kind: 'write',
    scope: SCHEMA_PUBLISH,
    inputs: [SHEET_VERSION_ID, EXPECTED_REVISION],
    result: 'row:sheet_definition_versions',
    assistant: { tool: 'sheetbase.sheet_definition.publish' },
    pipeline: {},
    events: [
      {
        name: 'sheet.definition.version.published',
        family: 'sheet',
        summary: 'A version of a sheet definition was published.',
        producer: {
          entityType: 'sheet_definition_version',
          operation: 'update',
          when: { key: 'lifecycle', equals: 'published' },
        },
        notes: 'Payload carries definitionId, version and lifecycle.',
      },
      {
        name: 'sheet.definition.version.retired',
        family: 'sheet',
        summary: 'A version of a sheet definition was retired.',
        producer: {
          entityType: 'sheet_definition_version',
          operation: 'update',
          when: { key: 'lifecycle', equals: 'retired' },
        },
        notes: 'Payload carries definitionId, version and lifecycle.',
      },
    ],
  },
  {
    name: 'retire_sheet_definition_version',
    label: 'Retire a version of a sheet definition',
    summary: 'Retire a version of a sheet definition',
    description:
      'Stops a published version being offered for new sheets. Sheets made from it keep working. Returns the version.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [SHEET_VERSION_ID, EXPECTED_REVISION],
    result: 'row:sheet_definition_versions',
    pipeline: {},
  },
  {
    name: 'retire_sheet_definition',
    label: 'Retire a sheet definition',
    summary: 'Retire a sheet definition',
    description:
      'Stops a sheet definition being offered. Sheets made from it keep working, and it can be restored. Returns the definition.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [SHEET_DEFINITION_ID, EXPECTED_REVISION],
    result: 'row:sheet_definitions',
    assistant: { tool: 'sheetbase.sheet_definition.retire' },
    pipeline: {},
  },
  {
    name: 'restore_sheet_definition',
    label: 'Restore a sheet definition',
    summary: 'Restore a retired sheet definition',
    description:
      'Offers a retired sheet definition again. Returns the definition.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [SHEET_DEFINITION_ID, EXPECTED_REVISION],
    result: 'row:sheet_definitions',
    assistant: { tool: 'sheetbase.sheet_definition.restore' },
    pipeline: {},
  },
  {
    name: 'preview_sheet_definition_extraction',
    label: 'Check turning a sheet into a definition',
    summary: 'Check turning part of a sheet into a reusable definition',
    description:
      'Says what a new sheet definition made from the chosen columns of a sheet would hold, without making it. `p_selection` is `{ columnIds }`.',
    kind: 'read',
    scope: 'sheets:read',
    inputs: [
      INSTANCE_ID,
      note(
        input('p_expected_instance_revision', 'bigint'),
        'The sheet’s `revision` you last read.',
      ),
      note(input('p_selection', 'json'), 'The columns, as `{ columnIds }`.'),
    ],
  },
  {
    name: 'extract_sheet_definition_draft',
    label: 'Turn a sheet into a definition',
    summary: 'Turn part of a sheet into a reusable definition',
    description:
      'Makes a new sheet definition, as a draft, from the chosen columns of a sheet. Returns `{ definition, version }`.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      INSTANCE_ID,
      note(
        input('p_expected_instance_revision', 'bigint'),
        'The sheet’s `revision` you last read.',
      ),
      note(input('p_key', 'text'), 'Key of the new definition.'),
      input('p_name', 'text'),
      input('p_description', 'text', true, true),
      note(input('p_selection', 'json'), 'The columns, as `{ columnIds }`.'),
    ],
    pipeline: {},
  },
  {
    name: 'preview_local_field_promotion',
    label: 'Check making a sheet column a shared field',
    summary: 'Check making a sheet’s own column a shared field',
    description:
      'Says what making a column that only one sheet has into a field of a record type (`p_target` `model_field`) or a dataset schema (`dataset_schema`) would do, without doing it.',
    kind: 'read',
    scope: 'sheets:read',
    inputs: [
      INSTANCE_ID,
      note(input('p_field_id', 'uuid'), 'The sheet column.'),
      note(input('p_target', 'text'), '`model_field` or `dataset_schema`.'),
      note(
        input('p_schema_definition_id', 'uuid', false, true),
        'For `dataset_schema`, the schema.',
      ),
      note(
        input('p_model_key', 'text', false, true),
        'For `model_field`, the record type.',
      ),
    ],
  },
  {
    name: 'promote_local_field',
    label: 'Make a sheet column a shared field',
    summary: 'Make a sheet’s own column a shared field',
    description:
      'Makes a column that only one sheet has into a field of a record type or a dataset schema, and points the sheet at it. Send the same `p_idempotency_key` to retry safely. Returns what changed.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      INSTANCE_ID,
      note(input('p_field_id', 'uuid'), 'The sheet column.'),
      note(input('p_target', 'text'), '`model_field` or `dataset_schema`.'),
      note(
        input('p_schema_definition_id', 'uuid', true, true),
        'For `dataset_schema`, the schema; null for `model_field`.',
      ),
      note(
        input('p_idempotency_key', 'text'),
        'Any string unique to this attempt; a retry with the same key returns the first result.',
      ),
      note(
        input('p_model_key', 'text', false, true),
        'For `model_field`, the record type.',
      ),
      note(
        input('p_schema_version_id', 'uuid', false, true),
        'For `dataset_schema`, the draft version to add it to.',
      ),
      note(
        input('p_expected_revision', 'bigint', false, true),
        'The `revision` of that draft version.',
      ),
    ],
    pipeline: {},
  },

  // -- Sheets -------------------------------------------------------------------
  {
    name: 'rename_sheet_instance',
    label: 'Rename a sheet',
    summary: 'Rename a sheet',
    description: 'Gives a sheet a new name. Returns the sheet.',
    kind: 'write',
    scope: 'sheets:write',
    inputs: [INSTANCE_ID, EXPECTED_REVISION, input('p_name', 'text')],
    result: 'row:sheet_instances',
    assistant: { tool: 'sheetbase.sheet.rename' },
    pipeline: {},
  },
  {
    name: 'insert_sheet_block',
    label: 'Add a measurement table to a notebook',
    summary: 'Add a measurement table block to a notebook',
    description:
      'Adds a table block for a dataset schema to a notebook, after a block or at the end. Returns the block.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      note(input('p_record_id', 'uuid'), 'The notebook.'),
      note(
        input('p_after_block_id', 'uuid', false, true),
        'Put it after this block; leave out for the end.',
      ),
      note(
        input('p_expected_structure_version', 'int', false, true),
        'The notebook’s `structure_version` you last read.',
      ),
      note(
        input('p_dataset_schema_id', 'uuid', false, true),
        'The dataset schema the table follows.',
      ),
    ],
    pipeline: {},
  },
  {
    name: 'search_sheet_cells',
    label: 'Search inside sheets',
    summary: 'Search the values inside sheets',
    description:
      'Finds sheets whose cells hold the words searched for, with the row, column and a snippet.',
    kind: 'read',
    scope: 'sheets:read',
    inputs: [
      note(input('p_query', 'text'), 'Words to look for.'),
      note(input('p_limit', 'int', false), 'At most this many. Default 20.'),
    ],
    result:
      'rows:instance_id=uuid,instance_name=text,project_id=uuid,row_key=text,field_label=text,value_text=text,snippet=text,rank=num',
  },
  {
    name: 'sheet_instance_notebook_embeddings',
    label: 'Which notebooks show a sheet',
    summary: 'Which notebooks show a sheet',
    description: 'Lists the notebooks and blocks a sheet is shown in.',
    kind: 'read',
    scope: 'sheets:read',
    inputs: [INSTANCE_ID],
  },
  {
    name: 'sheet_cell_history',
    label: 'What changed in a sheet',
    summary: 'Changes to the cells of a sheet',
    description:
      'Lists the changes to a sheet’s cells, newest first: who, when, the value before and after, and the reason when one was given. Covers the sheet’s own columns and the dataset columns it shows.',
    kind: 'read',
    scope: 'sheets:read',
    inputs: [
      INSTANCE_ID,
      note(
        input('p_limit', 'int', false),
        'At most this many changes. Default 200, at most 500.',
      ),
    ],
  },

  // -- Notebook templates -------------------------------------------------------
  {
    name: 'create_notebook_template',
    label: 'Add a notebook template',
    summary: 'Add a notebook template',
    description:
      'Adds a notebook template with its first draft version. Returns `{ template, version }`.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      WORKSPACE,
      note(input('p_key', 'text'), 'Key, lower case letters, digits and `_`.'),
      input('p_name', 'text'),
      input('p_description', 'text', true, true),
      TEMPLATE_CONFIGURATION,
    ],
    pipeline: {},
  },
  {
    name: 'create_notebook_template_version',
    label: 'Start a new version of a template',
    summary: 'Start a new draft version of a notebook template',
    description:
      'Starts a draft of the next version of a notebook template. Returns the version.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      note(input('p_template_id', 'uuid'), 'The template.'),
      note(
        input('p_expected_template_revision', 'bigint'),
        'The template’s `revision` you last read.',
      ),
      TEMPLATE_CONFIGURATION,
    ],
    result: 'row:notebook_template_versions',
    pipeline: {},
  },
  {
    name: 'update_notebook_template_version',
    label: 'Change a draft template',
    summary: 'Change a draft version of a notebook template',
    description:
      'Replaces what a draft version holds. A published version cannot change. Returns the version.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [TEMPLATE_VERSION_ID, EXPECTED_REVISION, TEMPLATE_CONFIGURATION],
    result: 'row:notebook_template_versions',
    pipeline: {},
  },
  {
    name: 'retarget_notebook_template_sheet_placement',
    label: 'Point a template’s sheet at another version',
    summary: 'Point a sheet in a draft template at another definition version',
    description:
      'Changes which sheet definition version a sheet in a draft template is made from. Returns the template version.',
    kind: 'write',
    scope: SCHEMA_WRITE,
    inputs: [
      TEMPLATE_VERSION_ID,
      EXPECTED_REVISION,
      note(input('p_placement_id', 'uuid'), 'The sheet in the template.'),
      note(
        input('p_target_definition_version_id', 'uuid'),
        'The sheet definition version to use.',
      ),
    ],
    result: 'row:notebook_template_versions',
    pipeline: {},
  },
  {
    name: 'publish_notebook_template_version',
    label: 'Publish a template',
    summary: 'Publish a draft version of a notebook template',
    description:
      'Makes a draft version the one new notebooks are made from. Needs `schema:publish`. Returns the version.',
    kind: 'write',
    scope: SCHEMA_PUBLISH,
    inputs: [TEMPLATE_VERSION_ID, EXPECTED_REVISION, input('p_reason', 'text')],
    result: 'row:notebook_template_versions',
    assistant: { tool: 'sheetbase.template.publish' },
    pipeline: {},
    events: [
      {
        name: 'notebook.template.version.published',
        family: 'notebook',
        summary: 'A version of a notebook template was published.',
        producer: {
          entityType: 'notebook_template_version',
          operation: 'update',
          when: { key: 'lifecycle', equals: 'published' },
        },
        notes: 'Payload carries templateId, version and lifecycle.',
      },
      {
        name: 'notebook.template.version.retired',
        family: 'notebook',
        summary: 'A version of a notebook template was retired (signed).',
        producer: {
          entityType: 'notebook_template_version',
          operation: 'update',
          when: { key: 'lifecycle', equals: 'retired' },
        },
        notes: 'Payload carries templateId, version and lifecycle.',
      },
    ],
  },
])
