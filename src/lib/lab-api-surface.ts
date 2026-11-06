/**
 * The lab surface of the external API: the tables token holders can read and
 * the RPCs they can call for everything built since the core API (reagent
 * orders, stocktakes, shipments, requests, workflows, legal holds and more).
 *
 * One list feeds every surface, so they cannot drift apart: the token
 * allowlist (`external-token.ts`), the OpenAPI document and docs, MCP
 * (`canonical.read` for tables, `sheetbase.lab.act` for RPCs) and the
 * integration guard test.
 *
 * Tables need `lab:read`, RPCs `lab:write` (or `lab:read` for lookups).
 * Writes act as the person a personal token belongs to; service credentials
 * can read the workspace-wide tables.
 */

/** Column or parameter type. */
export type LabType =
  | 'uuid'
  | 'text'
  | 'int'
  | 'bigint'
  | 'num'
  | 'bool'
  | 'ts'
  | 'date'
  | 'time'
  | 'json'
  | 'text[]'
  | 'int[]'
  | 'uuid[]'

/** name, type, required (not null / no default). */
export type LabField = readonly [name: string, type: LabType, required: 0 | 1]

export interface LabTable {
  readonly summary: string
  /** Personal tokens only: the rows are one person's own, or a view service credentials cannot read. */
  readonly personal?: true
  readonly columns: readonly LabField[]
}

export interface LabRpc {
  readonly summary: string
  readonly description: string
  readonly scope: 'lab:read' | 'lab:write'
  readonly params: readonly LabField[]
  /** `row:<table>`, `rows:<col>=<type>,…`, `list:text`, `json`, `void` or a scalar type. */
  readonly result: string
}

export const LAB_PARAM_NOTES: Readonly<Record<string, string>> = {
  p_order_id: 'Reagent order id.',
  p_reason: 'Why, in a sentence.',
  p_note: 'A note.',
  p_notes: 'Notes.',
  p_material_record_id: 'The material record to reorder.',
  p_quantity: 'Amount.',
  p_unit: 'Unit of the quantity.',
  p_order_reference: "The supplier's order number.",
  p_expected_on: 'Expected delivery date (YYYY-MM-DD).',
  p_supplier: 'Supplier name.',
  p_lot: 'Lot number.',
  p_expiry: 'Expiry date (YYYY-MM-DD).',
  p_kind: 'Kind, as listed in the app.',
  p_title: 'Title.',
  p_frequency: '`daily`, `weekly`, `monthly` or `yearly`.',
  p_starts_on: 'First date (YYYY-MM-DD).',
  p_timezone: 'IANA time zone, such as `Europe/London`.',
  p_interval_count: 'Every N periods (default 1).',
  p_weekdays: 'Days of the week, 1 (Monday) to 7 (Sunday).',
  p_offsets_days: 'Days after the start for each occurrence.',
  p_ends_on: 'Last date (YYYY-MM-DD).',
  p_max_occurrences: 'Stop after this many runs.',
  p_resource_id: 'The instrument to book.',
  p_start_time: 'Start time (HH:MM).',
  p_end_time: 'End time (HH:MM).',
  p_notebook_template_id: 'Template an experiment is made from.',
  p_lead_days: 'Create the experiment this many days ahead (default 0).',
  p_project_id: 'Project id.',
  p_notes_: '',
  p_schedule_id: 'Recurring schedule id.',
  p_paused: '`true` pauses, `false` resumes.',
  p_cancel_upcoming: 'Also cancel the bookings already made.',
  p_instrument_id: 'Instrument id.',
  p_out_of_service: '`true` takes it out of service, `false` returns it.',
  p_expected_back_on: 'When it should be back (YYYY-MM-DD).',
  p_work_done: 'What was done to put it right.',
  p_visited_on: 'Date of the visit (YYYY-MM-DD).',
  p_summary: 'One-line summary.',
  p_details: 'Details.',
  p_performed_by: 'Who did the work.',
  p_required_protocol_ids: 'Training protocols required before booking.',
  p_max_booking_minutes:
    'Longest single booking, in minutes. Omit for no limit.',
  p_max_advance_days: 'How many days ahead people may book. Omit for no limit.',
  p_readings:
    'JSON array of `{ feed, value, at }`; `at` is optional (defaults to now).',
  p_feed_id: 'Instrument feed id.',
  p_low: 'Low alert limit.',
  p_high: 'High alert limit.',
  p_since: 'Start of the window.',
  p_until: 'End of the window (default now).',
  p_buckets: 'Number of time buckets (default 240).',
  p_block_id: 'The protocol step block the timer belongs to.',
  p_seconds: "Duration in seconds. Omit to use the step's own duration.",
  p_timer_id: 'Step timer id.',
  p_record_id: 'Record id.',
  p_pictograms: 'GHS pictogram codes, such as `GHS02`.',
  p_signal_word: '`Danger` or `Warning`.',
  p_hazard_statements: 'Hazard statements, such as `H225`.',
  p_all_lots: 'Apply to every lot of the material (default true).',
  p_reagent_record_id: 'The reagent or material record.',
  p_scope_level:
    '`freezer`, `shelf`, `rack` or `box`, matching the storage level.',
  p_scope_id: 'Storage location id.',
  p_stocktake_id: 'Stocktake id.',
  p_box_id: 'Where the item was found.',
  p_item_id: 'Stocktake item id.',
  p_action: 'How to resolve the mismatch.',
  p_ingredients: 'JSON array of `{ record_id, quantity, unit }`.',
  p_storage: 'Where the solution is stored.',
  p_sources: 'JSON array of `{ record_id, quantity }` to pool.',
  p_purpose_experiment_id: 'The experiment the pool is for.',
  p_new_container: 'JSON describing the new container. Optional.',
  p_workflow_id: 'Sample workflow id. Omit to create a workflow.',
  p_definition:
    'JSON workflow definition: name, description, sample type, stages and transitions.',
  p_status: 'New status.',
  p_run_id: 'Workflow run id.',
  p_to_stage_id: 'Stage to move to.',
  p_entry_id: 'Registry entry id.',
  p_parent_id: 'Parent entry id.',
  p_role: 'How it relates to the entry (default `parent`).',
  p_custom_fields: 'Field values, keyed by field name.',
  p_allow_duplicate: 'Create it even when a similar entry exists.',
  p_exclude_id: 'Ignore this entry when looking for duplicates.',
  p_expected_metadata_version:
    'The `metadata_version` last read; refused if it moved.',
  p_assignee_user_id: 'The person to assign it to.',
  p_model_key: 'Record model key.',
  p_direction: '`inbound` or `outbound`.',
  p_counterparty: 'Who it is going to or coming from.',
  p_items: 'JSON array of items: `{ record_id, title, quantity, unit, note }`.',
  p_carrier: 'Carrier.',
  p_tracking_reference: 'Tracking reference.',
  p_shipment_id: 'Shipment id.',
  p_shipped_on: 'Date shipped (YYYY-MM-DD).',
  p_results: 'JSON array of `{ item_id, received, note }`.',
  p_condition_note: 'Condition on arrival.',
  p_field_name: 'Field name.',
  p_lower: 'Lower specification limit.',
  p_upper: 'Upper specification limit.',
  p_alert_lower: 'Lower alert limit.',
  p_alert_upper: 'Upper alert limit.',
  p_name: 'Name.',
  p_record_ids: 'Record ids.',
  p_hold_id: 'Legal hold id.',
  p_object_kind:
    '`instrument`, `pipeline`, `analysis`, `record` and the other pinnable kinds.',
  p_object_id: 'Id of the object.',
  p_favourite: '`true` to pin, `false` to unpin.',
}

export const LAB_TABLES: Readonly<Record<string, LabTable>> = {
  reagent_orders: {
    summary:
      'A reagent order: requested from a material that is running low, placed with the supplier, then received as a new lot. `status` is requested, ordered, received or cancelled.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['material_record_id', 'uuid', 0],
      ['project_id', 'uuid', 0],
      ['material_title', 'text', 1],
      ['supplier', 'text', 0],
      ['catalog_no', 'text', 0],
      ['quantity', 'num', 1],
      ['unit', 'text', 0],
      ['status', 'text', 1],
      ['note', 'text', 0],
      ['order_reference', 'text', 0],
      ['expected_on', 'date', 0],
      ['cancel_reason', 'text', 0],
      ['received_record_id', 'uuid', 0],
      ['received_lot', 'text', 0],
      ['requested_by', 'text', 0],
      ['requested_at', 'ts', 1],
      ['ordered_by', 'text', 0],
      ['ordered_at', 'ts', 0],
      ['received_by', 'text', 0],
      ['received_at', 'ts', 0],
      ['cancelled_by', 'text', 0],
      ['cancelled_at', 'ts', 0],
      ['updated_at', 'ts', 1],
    ],
  },
  recurring_schedules: {
    summary:
      'A recurring experiment or booking. `kind` is `booking` or `experiment`; `status` is active, paused or ended.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['title', 'text', 1],
      ['status', 'text', 1],
      ['frequency', 'text', 1],
      ['interval_count', 'int', 1],
      ['weekdays', 'int[]', 0],
      ['offsets_days', 'int[]', 0],
      ['starts_on', 'date', 1],
      ['ends_on', 'date', 0],
      ['max_occurrences', 'int', 0],
      ['timezone', 'text', 1],
      ['resource_id', 'uuid', 0],
      ['start_time', 'time', 0],
      ['end_time', 'time', 0],
      ['notebook_template_id', 'uuid', 0],
      ['lead_days', 'int', 1],
      ['project_id', 'uuid', 0],
      ['notes', 'text', 0],
      ['created_by_user_id', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['ended_at', 'ts', 0],
    ],
  },
  recurring_occurrences: {
    summary:
      'One planned run of a recurring schedule and what became of it (`outcome`).',
    columns: [
      ['id', 'uuid', 1],
      ['schedule_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['occurrence_on', 'date', 1],
      ['outcome', 'text', 1],
      ['booking_id', 'uuid', 0],
      ['record_id', 'uuid', 0],
      ['message', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  instrument_service_log: {
    summary:
      'A service, repair, calibration or other visit logged against an instrument.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['instrument_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['visited_on', 'date', 1],
      ['summary', 'text', 1],
      ['details', 'text', 0],
      ['performed_by', 'text', 0],
      ['logged_by', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  step_timers: {
    summary:
      'A timer started on a protocol step. Personal tokens only: you see your own timers.',
    personal: true,
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['user_id', 'text', 1],
      ['record_id', 'uuid', 1],
      ['block_id', 'uuid', 1],
      ['label', 'text', 1],
      ['duration_seconds', 'int', 1],
      ['started_at', 'ts', 1],
      ['ends_at', 'ts', 1],
      ['status', 'text', 1],
      ['notified_at', 'ts', 0],
      ['closed_at', 'ts', 0],
    ],
  },
  material_safety: {
    summary:
      'Chemical safety information for a material: hazard pictograms, signal word, hazard statements and the safety data sheet file.',
    columns: [
      ['record_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['pictograms', 'text[]', 1],
      ['signal_word', 'text', 0],
      ['hazard_statements', 'text[]', 1],
      ['sds_file_object_id', 'uuid', 0],
      ['updated_by', 'text', 0],
      ['updated_at', 'ts', 1],
    ],
  },
  material_ingredients: {
    summary:
      'What went into a prepared solution: one row per ingredient lot, with quantity and unit.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['product_record_id', 'uuid', 1],
      ['ingredient_record_id', 'uuid', 0],
      ['quantity', 'num', 1],
      ['unit', 'text', 0],
      ['ingredient_identifier', 'text', 1],
      ['ingredient_title', 'text', 1],
      ['ingredient_lot', 'text', 0],
      ['ingredient_expiry', 'date', 0],
      ['position', 'int', 1],
      ['created_by', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  stocktakes: {
    summary:
      'A stocktake of a freezer, shelf or box. `status` is in_progress, completed or cancelled.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['scope_level', 'text', 1],
      ['scope_id', 'uuid', 1],
      ['scope_name', 'text', 1],
      ['scope_path', 'text', 1],
      ['status', 'text', 1],
      ['note', 'text', 0],
      ['started_by', 'text', 0],
      ['started_at', 'ts', 1],
      ['completed_by', 'text', 0],
      ['completed_at', 'ts', 0],
      ['cancelled_by', 'text', 0],
      ['cancelled_at', 'ts', 0],
      ['updated_at', 'ts', 1],
    ],
  },
  stocktake_items: {
    summary:
      'One item expected in or found during a stocktake, with where it should be, where it was found and how a mismatch was resolved.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['stocktake_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['identifier', 'text', 1],
      ['title', 'text', 0],
      ['record_kind', 'text', 1],
      ['expected', 'bool', 1],
      ['state', 'text', 1],
      ['expected_box_id', 'uuid', 0],
      ['expected_path', 'text', 0],
      ['found_box_id', 'uuid', 0],
      ['found_path', 'text', 0],
      ['scanned_by', 'text', 0],
      ['scanned_at', 'ts', 0],
      ['resolution', 'text', 0],
      ['resolution_note', 'text', 0],
      ['resolved_by', 'text', 0],
      ['resolved_at', 'ts', 0],
    ],
  },
  instrument_feeds: {
    summary:
      'A live measurement series on an instrument (temperature, pressure and so on), with its alert limits and last value.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['instrument_id', 'uuid', 1],
      ['name', 'text', 1],
      ['unit', 'text', 0],
      ['low_limit', 'num', 0],
      ['high_limit', 'num', 0],
      ['limit_state', 'text', 1],
      ['last_value', 'num', 0],
      ['last_at', 'ts', 0],
      ['reading_count', 'bigint', 1],
      ['created_at', 'ts', 1],
    ],
  },
  instrument_readings: {
    summary:
      'One reading in an instrument feed. Large; filter by `feed_id` and `taken_at`, or use `list_instrument_feed_series` for charts.',
    columns: [
      ['id', 'bigint', 1],
      ['workspace_id', 'uuid', 1],
      ['instrument_id', 'uuid', 1],
      ['feed_id', 'uuid', 1],
      ['taken_at', 'ts', 1],
      ['value', 'num', 1],
    ],
  },
  sample_workflows: {
    summary:
      'A sample workflow: the stages a sample moves through. `status` is draft, active or archived.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['name', 'text', 1],
      ['description', 'text', 0],
      ['sample_type', 'text', 0],
      ['auto_enrol', 'bool', 1],
      ['status', 'text', 1],
      ['created_by_user_id', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  sample_workflow_stages: {
    summary:
      'A stage in a sample workflow, with its turnaround time, required fields and actions.',
    columns: [
      ['id', 'uuid', 1],
      ['workflow_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['position', 'int', 1],
      ['name', 'text', 1],
      ['description', 'text', 0],
      ['turnaround_days', 'int', 0],
      ['is_final', 'bool', 1],
      ['required_fields', 'text[]', 1],
      ['actions', 'json', 1],
    ],
  },
  sample_workflow_transitions: {
    summary: 'Which stage a sample may move to from another stage.',
    columns: [
      ['workflow_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['from_stage_id', 'uuid', 1],
      ['to_stage_id', 'uuid', 1],
    ],
  },
  sample_workflow_runs: {
    summary:
      "A sample's journey through a workflow: its current stage, when it entered and when it is due.",
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['workflow_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['stage_id', 'uuid', 1],
      ['entered_at', 'ts', 1],
      ['due_at', 'ts', 0],
      ['started_by_user_id', 'text', 0],
      ['completed_at', 'ts', 0],
    ],
  },
  sample_workflow_events: {
    summary: 'The history of moves a sample made through a workflow.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['run_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['from_stage_name', 'text', 0],
      ['to_stage_name', 'text', 0],
      ['notes', 'text', 0],
      ['automation', 'json', 1],
      ['actor_user_id', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  request_forms: {
    summary:
      'Which record models accept requests, their intro text and who handles them.',
    columns: [
      ['workspace_id', 'uuid', 1],
      ['model_key', 'text', 1],
      ['intro', 'text', 0],
      ['handler_user_ids', 'text[]', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  shipments: {
    summary:
      'A sample shipment in or out. `direction` is inbound or outbound; `status` is draft, in_transit, received or cancelled.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['direction', 'text', 1],
      ['status', 'text', 1],
      ['project_id', 'uuid', 0],
      ['counterparty', 'text', 1],
      ['carrier', 'text', 0],
      ['tracking_reference', 'text', 0],
      ['shipped_on', 'date', 0],
      ['expected_on', 'date', 0],
      ['received_at', 'ts', 0],
      ['received_by', 'text', 0],
      ['condition_note', 'text', 0],
      ['notes', 'text', 0],
      ['cancel_reason', 'text', 0],
      ['cancelled_at', 'ts', 0],
      ['created_by', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  shipment_items: {
    summary:
      'An item on a shipment, with whether it arrived and in what condition.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['shipment_id', 'uuid', 1],
      ['position', 'int', 1],
      ['record_id', 'uuid', 0],
      ['identifier', 'text', 0],
      ['title', 'text', 1],
      ['kind', 'text', 0],
      ['quantity', 'num', 0],
      ['unit', 'text', 0],
      ['note', 'text', 0],
      ['received', 'bool', 0],
      ['received_note', 'text', 0],
    ],
  },
  instrument_booking_rules: {
    summary:
      'Booking limits on an instrument: longest booking and how far ahead people may book.',
    columns: [
      ['instrument_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['max_booking_minutes', 'int', 0],
      ['max_advance_days', 'int', 0],
      ['updated_at', 'ts', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  instrument_required_training: {
    summary:
      'Training protocols a person must hold before booking an instrument.',
    columns: [
      ['instrument_id', 'uuid', 1],
      ['protocol_record_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
    ],
  },
  field_spec_limits: {
    summary:
      'Specification and alert limits for a numeric field on a record kind.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['field_name', 'text', 1],
      ['lower_limit', 'num', 0],
      ['upper_limit', 'num', 0],
      ['alert_lower', 'num', 0],
      ['alert_upper', 'num', 0],
      ['note', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  model_incident_logs: {
    summary: 'Record models that are used as incident logs.',
    columns: [
      ['workspace_id', 'uuid', 1],
      ['model_key', 'text', 1],
      ['created_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
    ],
  },
  legal_holds: {
    summary:
      'A legal hold keeping records from deletion or archiving until it is released.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['name', 'text', 1],
      ['reason', 'text', 0],
      ['project_id', 'uuid', 0],
      ['kind', 'text', 0],
      ['created_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
      ['released_at', 'ts', 0],
      ['released_by_user_id', 'text', 0],
      ['release_note', 'text', 0],
    ],
  },
  legal_hold_records: {
    summary: 'A record placed on a legal hold.',
    columns: [
      ['hold_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['added_at', 'ts', 1],
      ['added_by_user_id', 'text', 1],
    ],
  },
  retention_rules: {
    summary:
      'How many months each kind of record is kept before it comes up for archiving.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['keep_months', 'int', 1],
      ['note', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  request_details: {
    summary: 'What was asked and how it was decided, for each request record.',
    columns: [
      ['record_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['note', 'text', 0],
      ['decided_by', 'text', 0],
      ['decided_at', 'ts', 0],
      ['decision_note', 'text', 0],
    ],
  },
  record_spec_results: {
    summary:
      "Each record's value for a field with result limits, and whether it is within spec, in the alert band or out. Personal tokens only.",
    personal: true,
    columns: [
      ['record_id', 'uuid', 0],
      ['workspace_id', 'uuid', 0],
      ['kind', 'text', 0],
      ['identifier', 'text', 0],
      ['title', 'text', 0],
      ['project_id', 'uuid', 0],
      ['archived_at', 'ts', 0],
      ['field_name', 'text', 0],
      ['value', 'num', 0],
      ['lower_limit', 'num', 0],
      ['upper_limit', 'num', 0],
      ['alert_lower', 'num', 0],
      ['alert_upper', 'num', 0],
      ['verdict', 'text', 0],
    ],
  },
  my_work_items: {
    summary:
      'What is waiting on the person: reviews, tasks, assigned records and so on. Personal tokens only.',
    personal: true,
    columns: [
      ['kind', 'text', 0],
      ['record_id', 'uuid', 0],
      ['identifier', 'text', 0],
      ['title', 'text', 0],
      ['project_id', 'uuid', 0],
      ['reason', 'text', 0],
      ['due_at', 'ts', 0],
      ['state', 'text', 0],
      ['created_at', 'ts', 0],
      ['source_type', 'text', 0],
      ['source_id', 'uuid', 0],
      ['parser_version_id', 'uuid', 0],
      ['connector_id', 'uuid', 0],
      ['revision_id', 'uuid', 0],
      ['dataset_id', 'uuid', 0],
      ['row_id', 'uuid', 0],
      ['field_id', 'uuid', 0],
    ],
  },
  inbox_work_items: {
    summary:
      "The person's Inbox items with tab and type. Personal tokens only.",
    personal: true,
    columns: [
      ['kind', 'text', 0],
      ['record_id', 'uuid', 0],
      ['identifier', 'text', 0],
      ['title', 'text', 0],
      ['project_id', 'uuid', 0],
      ['reason', 'text', 0],
      ['due_at', 'ts', 0],
      ['state', 'text', 0],
      ['created_at', 'ts', 0],
      ['source_type', 'text', 0],
      ['source_id', 'uuid', 0],
      ['parser_version_id', 'uuid', 0],
      ['connector_id', 'uuid', 0],
      ['revision_id', 'uuid', 0],
      ['dataset_id', 'uuid', 0],
      ['row_id', 'uuid', 0],
      ['field_id', 'uuid', 0],
      ['item_key', 'text', 0],
      ['inbox_tab', 'text', 0],
      ['inbox_type', 'text', 0],
    ],
  },
  project_follows: {
    summary:
      'Projects a person follows. Personal tokens only: you see your own follows.',
    personal: true,
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['user_id', 'text', 1],
      ['project_id', 'uuid', 1],
      ['created_at', 'ts', 1],
    ],
  },
}

export const LAB_RPCS: Readonly<Record<string, LabRpc>> = {
  request_reagent_order: {
    summary: 'Request a reagent order',
    description:
      'Asks for more of a material that is running low. A steward places the order.',
    scope: 'lab:write',
    params: [
      ['p_material_record_id', 'uuid', 1],
      ['p_quantity', 'num', 1],
      ['p_unit', 'text', 0],
      ['p_note', 'text', 0],
    ],
    result: 'row:reagent_orders',
  },
  mark_reagent_ordered: {
    summary: 'Mark a reagent order as placed',
    description:
      'Records that the order was placed with the supplier. Needs an owner, admin or steward.',
    scope: 'lab:write',
    params: [
      ['p_order_id', 'uuid', 1],
      ['p_order_reference', 'text', 0],
      ['p_expected_on', 'date', 0],
      ['p_supplier', 'text', 0],
    ],
    result: 'row:reagent_orders',
  },
  receive_reagent_order: {
    summary: 'Receive a reagent order',
    description:
      'Registers the delivery as a new lot of the material and closes the order. `p_quantity` defaults to the quantity ordered.',
    scope: 'lab:write',
    params: [
      ['p_order_id', 'uuid', 1],
      ['p_lot', 'text', 1],
      ['p_expiry', 'date', 1],
      ['p_quantity', 'num', 0],
    ],
    result: 'row:reagent_orders',
  },
  cancel_reagent_order: {
    summary: 'Cancel a reagent order',
    description: 'Cancels an order that has not been received.',
    scope: 'lab:write',
    params: [
      ['p_order_id', 'uuid', 1],
      ['p_reason', 'text', 0],
    ],
    result: 'row:reagent_orders',
  },
  create_recurring_schedule: {
    summary: 'Create a recurring booking or experiment',
    description:
      'Plans repeating bookings or experiments. Returns the schedule and what was created.',
    scope: 'lab:write',
    params: [
      ['p_kind', 'text', 1],
      ['p_title', 'text', 1],
      ['p_frequency', 'text', 1],
      ['p_starts_on', 'date', 1],
      ['p_timezone', 'text', 1],
      ['p_interval_count', 'int', 0],
      ['p_weekdays', 'int[]', 0],
      ['p_offsets_days', 'int[]', 0],
      ['p_ends_on', 'date', 0],
      ['p_max_occurrences', 'int', 0],
      ['p_resource_id', 'uuid', 0],
      ['p_start_time', 'time', 0],
      ['p_end_time', 'time', 0],
      ['p_notebook_template_id', 'uuid', 0],
      ['p_lead_days', 'int', 0],
      ['p_project_id', 'uuid', 0],
      ['p_notes', 'text', 0],
    ],
    result: 'json',
  },
  set_recurring_schedule_paused: {
    summary: 'Pause or resume a recurring schedule',
    description: 'Stops or restarts new runs without losing the schedule.',
    scope: 'lab:write',
    params: [
      ['p_schedule_id', 'uuid', 1],
      ['p_paused', 'bool', 1],
    ],
    result: 'row:recurring_schedules',
  },
  end_recurring_schedule: {
    summary: 'End a recurring schedule',
    description: 'Ends the schedule; optionally cancels bookings already made.',
    scope: 'lab:write',
    params: [
      ['p_schedule_id', 'uuid', 1],
      ['p_cancel_upcoming', 'bool', 0],
    ],
    result: 'json',
  },
  materialise_recurring_schedule: {
    summary: 'Create the next runs of a schedule now',
    description:
      "Makes the bookings or experiments that are due within the schedule's lead time.",
    scope: 'lab:write',
    params: [['p_schedule_id', 'uuid', 1]],
    result: 'json',
  },
  set_instrument_out_of_service: {
    summary: 'Take an instrument out of service, or return it',
    description:
      'Takes it out of service with a reason, or returns it to service with the work done. Needs an owner, admin or steward.',
    scope: 'lab:write',
    params: [
      ['p_instrument_id', 'uuid', 1],
      ['p_out_of_service', 'bool', 1],
      ['p_reason', 'text', 0],
      ['p_expected_back_on', 'date', 0],
      ['p_work_done', 'text', 0],
    ],
    result: 'row:instruments',
  },
  log_instrument_service: {
    summary: 'Log a service visit',
    description:
      "Adds a service, repair or calibration visit to the instrument's log.",
    scope: 'lab:write',
    params: [
      ['p_instrument_id', 'uuid', 1],
      ['p_kind', 'text', 1],
      ['p_visited_on', 'date', 1],
      ['p_summary', 'text', 1],
      ['p_details', 'text', 0],
      ['p_performed_by', 'text', 0],
    ],
    result: 'row:instrument_service_log',
  },
  set_instrument_booking_rules: {
    summary: 'Set booking rules and required training for an instrument',
    description:
      "Replaces the instrument's booking limits and required training. Needs an owner, admin or steward.",
    scope: 'lab:write',
    params: [
      ['p_instrument_id', 'uuid', 1],
      ['p_required_protocol_ids', 'uuid[]', 0],
      ['p_max_booking_minutes', 'int', 0],
      ['p_max_advance_days', 'int', 0],
    ],
    result: 'void',
  },
  record_instrument_readings: {
    summary: 'Record instrument readings',
    description:
      "Adds readings to the instrument's feeds, creating a feed for a new name. Returns how many were stored and any alerts raised.",
    scope: 'lab:write',
    params: [
      ['p_instrument_id', 'uuid', 1],
      ['p_readings', 'json', 1],
    ],
    result: 'json',
  },
  set_instrument_feed_limits: {
    summary: "Set a feed's alert limits",
    description: 'Sets the low and high limits that raise alerts for a feed.',
    scope: 'lab:write',
    params: [
      ['p_feed_id', 'uuid', 1],
      ['p_low', 'num', 1],
      ['p_high', 'num', 1],
      ['p_unit', 'text', 0],
    ],
    result: 'row:instrument_feeds',
  },
  remove_instrument_feed: {
    summary: 'Remove an instrument feed',
    description: 'Deletes a feed and its readings.',
    scope: 'lab:write',
    params: [['p_feed_id', 'uuid', 1]],
    result: 'void',
  },
  list_instrument_feed_series: {
    summary: 'Chart data for an instrument feed',
    description:
      'Returns min, average and max per time bucket, ready to chart.',
    scope: 'lab:read',
    params: [
      ['p_feed_id', 'uuid', 1],
      ['p_since', 'ts', 1],
      ['p_until', 'ts', 0],
      ['p_buckets', 'int', 0],
    ],
    result:
      'rows:bucket_at=ts,min_value=num,avg_value=num,max_value=num,readings=bigint',
  },
  my_instrument_training_gaps: {
    summary: 'Training the caller still needs for an instrument',
    description:
      'Lists required protocols the person has not yet been trained on.',
    scope: 'lab:read',
    params: [['p_instrument_id', 'uuid', 1]],
    result: 'rows:protocol_record_id=uuid,identifier=text,title=text',
  },
  start_step_timer: {
    summary: 'Start a step timer',
    description:
      'Starts a countdown on a protocol step for the person the token belongs to (needs a personal token).',
    scope: 'lab:write',
    params: [
      ['p_block_id', 'uuid', 1],
      ['p_seconds', 'int', 0],
    ],
    result: 'row:step_timers',
  },
  end_step_timer: {
    summary: 'End a step timer',
    description: 'Stops a running timer.',
    scope: 'lab:write',
    params: [['p_timer_id', 'uuid', 1]],
    result: 'row:step_timers',
  },
  set_material_safety: {
    summary: 'Set chemical safety information',
    description:
      'Sets pictograms, signal word and hazard statements for a material, on every lot unless `p_all_lots` is false. Returns how many records changed.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_pictograms', 'text[]', 1],
      ['p_signal_word', 'text', 1],
      ['p_hazard_statements', 'text[]', 1],
      ['p_all_lots', 'bool', 0],
    ],
    result: 'int',
  },
  register_replacement_lot: {
    summary: 'Register a replacement lot',
    description:
      'Adds a new lot of a reagent that replaces the one in use. Returns the new lot.',
    scope: 'lab:write',
    params: [
      ['p_reagent_record_id', 'uuid', 1],
      ['p_lot', 'text', 1],
      ['p_expiry', 'date', 1],
      ['p_quantity', 'num', 1],
      ['p_unit', 'text', 0],
      ['p_reason', 'text', 0],
    ],
    result: 'json',
  },
  start_stocktake: {
    summary: 'Start a stocktake',
    description:
      'Starts a stocktake of a freezer, shelf, rack or box and lists what should be there.',
    scope: 'lab:write',
    params: [
      ['p_scope_level', 'text', 1],
      ['p_scope_id', 'uuid', 1],
      ['p_note', 'text', 0],
    ],
    result: 'row:stocktakes',
  },
  record_stocktake_scan: {
    summary: 'Record a scanned item',
    description:
      'Marks an item as found, in the box given or where it was expected.',
    scope: 'lab:write',
    params: [
      ['p_stocktake_id', 'uuid', 1],
      ['p_record_id', 'uuid', 1],
      ['p_box_id', 'uuid', 0],
    ],
    result: 'row:stocktake_items',
  },
  resolve_stocktake_item: {
    summary: 'Resolve a stocktake mismatch',
    description:
      'Closes a missing or misplaced item with an action and a note.',
    scope: 'lab:write',
    params: [
      ['p_item_id', 'uuid', 1],
      ['p_action', 'text', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:stocktake_items',
  },
  complete_stocktake: {
    summary: 'Complete a stocktake',
    description: 'Finishes the stocktake; items not found stay flagged.',
    scope: 'lab:write',
    params: [['p_stocktake_id', 'uuid', 1]],
    result: 'row:stocktakes',
  },
  cancel_stocktake: {
    summary: 'Cancel a stocktake',
    description: 'Cancels a stocktake that is in progress.',
    scope: 'lab:write',
    params: [['p_stocktake_id', 'uuid', 1]],
    result: 'row:stocktakes',
  },
  prepare_solution: {
    summary: 'Prepare a solution from lots',
    description:
      'Makes a new solution record from ingredient lots and takes the quantities from stock. Returns the new record and what was used.',
    scope: 'lab:write',
    params: [
      ['p_project_id', 'uuid', 1],
      ['p_title', 'text', 1],
      ['p_lot', 'text', 1],
      ['p_quantity', 'num', 1],
      ['p_unit', 'text', 1],
      ['p_ingredients', 'json', 1],
      ['p_expiry', 'date', 0],
      ['p_storage', 'text', 0],
      ['p_note', 'text', 0],
    ],
    result: 'json',
  },
  pool_samples: {
    summary: 'Pool samples',
    description:
      'Combines samples into a new pooled sample for an experiment and records where each part came from.',
    scope: 'lab:write',
    params: [
      ['p_sources', 'json', 1],
      ['p_purpose_experiment_id', 'uuid', 1],
      ['p_unit', 'text', 0],
      ['p_notes', 'text', 0],
      ['p_new_container', 'json', 0],
    ],
    result: 'json',
  },
  save_sample_workflow: {
    summary: 'Create or update a sample workflow',
    description:
      'Saves a workflow definition (stages and transitions). Omit `p_workflow_id` to create. Returns the workflow id.',
    scope: 'lab:write',
    params: [
      ['p_workflow_id', 'uuid', 1],
      ['p_definition', 'json', 1],
    ],
    result: 'uuid',
  },
  set_sample_workflow_status: {
    summary: 'Publish or archive a sample workflow',
    description: 'Sets a workflow to draft, active or archived.',
    scope: 'lab:write',
    params: [
      ['p_workflow_id', 'uuid', 1],
      ['p_status', 'text', 1],
    ],
    result: 'void',
  },
  enrol_sample_in_workflow: {
    summary: 'Put a sample into a workflow',
    description: "Starts a run for the sample at the workflow's first stage.",
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_workflow_id', 'uuid', 1],
    ],
    result: 'row:sample_workflow_runs',
  },
  advance_sample_workflow: {
    summary: 'Move a sample to another stage',
    description:
      "Moves the sample along an allowed transition; checks required fields and runs the stage's actions.",
    scope: 'lab:write',
    params: [
      ['p_run_id', 'uuid', 1],
      ['p_to_stage_id', 'uuid', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'json',
  },
  leave_sample_workflow: {
    summary: 'Take a sample out of its workflow',
    description: 'Ends the run without finishing the workflow.',
    scope: 'lab:write',
    params: [
      ['p_run_id', 'uuid', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:sample_workflow_runs',
  },
  create_registry_entry: {
    summary: 'Add a registry entry',
    description:
      'Creates an entry of a registry model (such as a cell line or construct). Refuses a likely duplicate unless `p_allow_duplicate` is true.',
    scope: 'lab:write',
    params: [
      ['p_project_id', 'uuid', 1],
      ['p_kind', 'text', 1],
      ['p_title', 'text', 1],
      ['p_custom_fields', 'json', 0],
      ['p_allow_duplicate', 'bool', 0],
    ],
    result: 'row:records',
  },
  add_registry_parent: {
    summary: 'Link a registry entry to a parent',
    description: 'Records lineage, such as a cell line derived from another.',
    scope: 'lab:write',
    params: [
      ['p_entry_id', 'uuid', 1],
      ['p_parent_id', 'uuid', 1],
      ['p_role', 'text', 0],
    ],
    result: 'void',
  },
  remove_registry_parent: {
    summary: 'Remove a registry parent link',
    description: 'Removes the lineage link.',
    scope: 'lab:write',
    params: [
      ['p_entry_id', 'uuid', 1],
      ['p_parent_id', 'uuid', 1],
    ],
    result: 'void',
  },
  registry_find_duplicates: {
    summary: 'Find similar registry entries',
    description: 'Lists entries that look like the one described.',
    scope: 'lab:read',
    params: [
      ['p_kind', 'text', 1],
      ['p_title', 'text', 1],
      ['p_custom_fields', 'json', 0],
      ['p_exclude_id', 'uuid', 0],
    ],
    result: 'rows:id=uuid,identifier=text,title=text,archived=bool,match=text',
  },
  assign_record: {
    summary: 'Assign a record to a person',
    description:
      'Hands the record to a person. The record must be at the `metadata_version` you read.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_assignee_user_id', 'text', 1],
    ],
    result: 'row:records',
  },
  submit_request: {
    summary: 'Send a request to the lab',
    description:
      'Creates a request from a request form. Deciding it stays with the people who handle requests, in the app.',
    scope: 'lab:write',
    params: [
      ['p_model_key', 'text', 1],
      ['p_title', 'text', 1],
      ['p_custom_fields', 'json', 0],
      ['p_project_id', 'uuid', 0],
      ['p_note', 'text', 0],
    ],
    result: 'row:records',
  },
  create_shipment: {
    summary: 'Create a shipment',
    description: 'Starts a draft inbound or outbound shipment with its items.',
    scope: 'lab:write',
    params: [
      ['p_direction', 'text', 1],
      ['p_counterparty', 'text', 1],
      ['p_items', 'json', 0],
      ['p_carrier', 'text', 0],
      ['p_tracking_reference', 'text', 0],
      ['p_expected_on', 'date', 0],
      ['p_notes', 'text', 0],
      ['p_project_id', 'uuid', 0],
    ],
    result: 'row:shipments',
  },
  update_shipment: {
    summary: 'Edit a shipment',
    description:
      'Changes details or items while it is not yet delivered. Omit a field to keep it.',
    scope: 'lab:write',
    params: [
      ['p_shipment_id', 'uuid', 1],
      ['p_counterparty', 'text', 0],
      ['p_carrier', 'text', 0],
      ['p_tracking_reference', 'text', 0],
      ['p_expected_on', 'date', 0],
      ['p_notes', 'text', 0],
      ['p_items', 'json', 0],
    ],
    result: 'row:shipments',
  },
  mark_shipment_in_transit: {
    summary: 'Mark a shipment as sent',
    description: 'Records that it left, with carrier and tracking.',
    scope: 'lab:write',
    params: [
      ['p_shipment_id', 'uuid', 1],
      ['p_shipped_on', 'date', 0],
      ['p_carrier', 'text', 0],
      ['p_tracking_reference', 'text', 0],
      ['p_expected_on', 'date', 0],
    ],
    result: 'row:shipments',
  },
  receive_shipment: {
    summary: 'Receive a shipment',
    description: 'Records what arrived and its condition.',
    scope: 'lab:write',
    params: [
      ['p_shipment_id', 'uuid', 1],
      ['p_results', 'json', 0],
      ['p_condition_note', 'text', 0],
    ],
    result: 'row:shipments',
  },
  cancel_shipment: {
    summary: 'Cancel a shipment',
    description: 'Cancels a shipment that has not been received.',
    scope: 'lab:write',
    params: [
      ['p_shipment_id', 'uuid', 1],
      ['p_reason', 'text', 0],
    ],
    result: 'row:shipments',
  },
  set_field_spec_limits: {
    summary: 'Set result limits on a field',
    description:
      'Sets specification and alert limits for a numeric field on a record kind. Needs an owner, admin or steward.',
    scope: 'lab:write',
    params: [
      ['p_kind', 'text', 1],
      ['p_field_name', 'text', 1],
      ['p_lower', 'num', 0],
      ['p_upper', 'num', 0],
      ['p_alert_lower', 'num', 0],
      ['p_alert_upper', 'num', 0],
      ['p_note', 'text', 0],
    ],
    result: 'row:field_spec_limits',
  },
  create_legal_hold: {
    summary: 'Place a legal hold',
    description:
      'Creates a hold on a project, a record kind or listed records. Held records cannot be deleted or archived.',
    scope: 'lab:write',
    params: [
      ['p_name', 'text', 1],
      ['p_reason', 'text', 0],
      ['p_project_id', 'uuid', 0],
      ['p_kind', 'text', 0],
      ['p_record_ids', 'uuid[]', 0],
    ],
    result: 'row:legal_holds',
  },
  add_records_to_legal_hold: {
    summary: 'Add records to a legal hold',
    description: 'Adds records to an open hold. Returns how many were added.',
    scope: 'lab:write',
    params: [
      ['p_hold_id', 'uuid', 1],
      ['p_record_ids', 'uuid[]', 1],
    ],
    result: 'int',
  },
  is_record_on_hold: {
    summary: 'Is a record on legal hold',
    description: 'Returns true when any open hold covers the record.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result: 'bool',
  },
  retention_due: {
    summary: 'Records past their retention time',
    description:
      'Lists records kept longer than their retention rule, optionally for one kind. It only lists; archiving stays with people in the app.',
    scope: 'lab:read',
    params: [['p_kind', 'text', 0]],
    result:
      'rows:record_id=uuid,identifier=text,title=text,kind=text,project_id=uuid,last_changed=ts,keep_months=int,due_since=ts',
  },
  follow_project: {
    summary: 'Follow a project',
    description:
      'Follows a project for the person the token belongs to (needs a personal token). Returns when.',
    scope: 'lab:write',
    params: [['p_project_id', 'uuid', 1]],
    result: 'ts',
  },
  unfollow_project: {
    summary: 'Stop following a project',
    description: 'Needs a personal token.',
    scope: 'lab:write',
    params: [['p_project_id', 'uuid', 1]],
    result: 'void',
  },
  set_record_favourite: {
    summary: 'Pin or unpin something',
    description:
      "Pins an instrument, pipeline, analysis, material or record to the person's sidebar (needs a personal token). Returns when it was pinned.",
    scope: 'lab:write',
    params: [
      ['p_object_kind', 'text', 1],
      ['p_object_id', 'uuid', 1],
      ['p_favourite', 'bool', 1],
    ],
    result: 'ts',
  },
}
