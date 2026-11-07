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
  p_name: 'Name.',
  p_format:
    'Plate format, such as `96_well` or `384_well`; or a worklist file format.',
  p_wells:
    'JSON array of `{ wellCode, role, sampleId, sampleLabel, concentration, concentrationUnit, volumeUl }`.',
  p_readout: 'JSON object of well to reading, such as `{ "A1": 1204.5 }`.',
  p_config:
    'JSON analysis settings: normalisation, hit rule, QC limits and curve model.',
  p_design_id: 'Plate design the layout came from.',
  p_analysis: 'JSON analysis, as computed from the stored layout and readout.',
  p_plate_run_id: 'Plate run id.',
  p_qc_status: '`pass`, `warn`, `fail` or `not_checked`.',
  p_mode: '`stamp` (well to well) or `cherry_pick`.',
  p_source_plate: 'Name or barcode of the source plate.',
  p_source_format: 'Source plate format.',
  p_dest_plate: 'Name or barcode of the destination plate.',
  p_dest_format: 'Destination plate format.',
  p_transfers:
    'JSON array of `{ sourceWell, destWell, volumeUl, label, sampleId }`.',
  p_options: 'JSON options used to build the worklist.',
  p_worklist_id: 'Worklist id.',
  p_reconciled:
    'JSON array of the planned transfers each with `status` and `movedUl`.',
  p_purpose_record_id: 'The experiment the samples were used for.',
  p_record_withdrawals:
    'Withdraw what moved from the source samples (default true).',
  p_workspace_id: 'Your workspace id.',
  p_series_id: 'Quality control series id.',
  p_source_kind:
    '`manual` (points are sent in) or `plate_metric` (fed by the plate runs of an assay design).',
  p_metric:
    'For a plate series: `z_prime`, `signal_to_background`, `positive_mean`, `negative_mean`, `blank_mean`, `positive_cv` or `negative_cv`.',
  p_mean: 'Centre line of the control limits.',
  p_sd: 'Standard deviation (greater than 0) of the control limits.',
  p_rules:
    'Westgard rules to judge by, from `1-3s`, `2-2s`, `R-4s`, `4-1s` and `10x`. For a data contract, a JSON array of rules: `{ id, kind, field, mode, min, max, units, threshold, maxAgeMinutes }`, where `kind` is `required`, `unique`, `range`, `units`, `completeness`, `row_count` or `freshness` and `mode` is `warn` or `block`.',
  p_enabled: '`false` pauses judging new points.',
  p_capability: 'The feature key, such as `campaigns`.',
  p_settings:
    'A JSON object of settings for the feature (replaces its settings when given).',
  p_first_n:
    'Take the limits from the first N points (mean and SD) instead of entering them.',
  p_at: 'When it was measured (default now).',
  p_point_id: 'Quality control point id.',
  p_exclude: 'Leave the point out of the limits and re-judge the series.',
  p_instrument_run_id: 'The instrument run the value came from.',
  p_document: 'The Allotrope Simple Model document, as JSON (at most 16 MiB).',
  p_converter: 'What made the document, for example `allotropy`.',
  p_converter_version: 'Version of the converter.',
  p_image_digest: 'The immutable image that ran the converter.',
  p_vendor: 'The instrument software the file came from.',
  p_technique: 'Measurement technique, for example `Plate Reader`.',
  p_manifest: 'The Allotrope manifest the document follows.',
  p_measurements: 'Number of measurements in the document.',
  p_device: 'JSON description of the instrument that wrote the file.',
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
  p_unit_id: 'Storage unit (freezer, fridge or incubator) id.',
  p_room_id: 'Storage room id.',
  p_out_of_range_only: 'Only measurements outside their limits.',
  p_low: 'Low alert limit.',
  p_high: 'High alert limit.',
  p_since: 'Start of the window.',
  p_until: 'End of the window (default now).',
  p_buckets: 'Number of time buckets (default 240).',
  p_block_id: 'The protocol step block (a `procedure_step` block).',
  p_series_record_id: 'The experiment that heads the series.',
  p_member_record_id: 'The experiment that is, or is to become, a member.',
  p_position: 'Where it sits in the series. Omit for the end.',
  p_planned_on: 'The day it is planned to run (YYYY-MM-DD). Omit for none.',
  p_done: 'true to finish it (default), false to reopen it.',
  p_label: 'What was measured.',
  p_value: 'The measured value, as a number or text.',
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
  p_run_id: 'Run id: the workflow run, or the instrument run.',
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
  p_results:
    'JSON array. To receive a reagent order: `{ item_id, received, note }`. For a campaign round: `{ trial, results: { objectiveKey: number } }`.',
  p_condition_note: 'Condition on arrival.',
  p_field_name: 'Field name.',
  p_lower: 'Lower specification limit.',
  p_upper: 'Upper specification limit.',
  p_alert_lower: 'Lower alert limit.',
  p_alert_upper: 'Upper alert limit.',
  p_record_ids: 'Record ids.',
  p_hold_id: 'Legal hold id.',
  p_object_kind:
    '`instrument`, `pipeline`, `analysis`, `record` and the other pinnable kinds.',
  p_object_id: 'Id of the object.',
  p_from: 'First day (YYYY-MM-DD).',
  p_to: 'Day to stop before (YYYY-MM-DD).',
  p_part_id: 'The part of the experiment.',
  p_link_id: 'The link between two records.',
  p_day_offset:
    'The day the part falls on, counted from the start of the experiment (0 is the first day).',
  p_after_part_id: 'Put it after this part. Leave out to put it first or last.',
  p_clear_assignee: 'true to clear who does the part.',
  p_move_blocks_to:
    'The part that takes over the blocks of the part being deleted.',
  p_user_id: 'The person (their user id).',
  p_due_at: 'When it is wanted by (an ISO date and time). Optional.',
  p_required: '`true` if each part needs a signature, `false` if not.',
  p_parts:
    'The parts to make, in order: each `{title, first_block_id, day_offset}`. A part runs from its first block to the next part’s.',
  p_conditions:
    'JSON list of the conditions the gate waits on, each with a `kind`: `table_filled` (`blockId`, optional `column` and `minRows`), `step_done` (`blockId`), `part_done` (`partId`), `samples_linked` (optional `min`), `field_set` (`field`), `date_reached` (`date`, YYYY-MM-DD) or `qc_in_control` (optional `seriesId`; unmet while a tracked quality control series has a breach nobody has looked at). All must hold. Leave out or send an empty list to take the rule off.',
  p_gate_mode:
    '`warn` lets people go on past the gate with a reason; `block` refuses the work behind it until the conditions hold.',
  p_steps_in_order: 'true to make the steps of the part be done in order.',
  p_gate_block_id: 'The gate block to go on past.',
  p_gate_part_id: 'The part whose "opens when" rule to go on past.',
  p_favourite: '`true` to pin, `false` to unpin.',
  p_driver:
    '`opentrons` (the robot is on the network) or `file` (its software reads a folder).',
  p_worklist_format:
    'The worklist file the robot reads: `opentrons` for an Opentrons robot; `csv`, `echo`, `tecan_gwl` or `hamilton` for a file robot. Leave out to use the driver’s own.',
  p_labware:
    'JSON labware for the worklist file: `opentronsSourceLabware`, `opentronsDestLabware`, `opentronsPipette`, `opentronsTiprack`, `opentronsMount`, `liquidClass`, `tecanSourceType`, `tecanDestType`, `echoSourceType`.',
  p_job_id: 'Robot job id.',
  p_proposal_id: 'Schedule proposal id.',
  p_hands_on_minutes:
    'Minutes a person is at the bench for the part (0 to 1440).',
  p_wait_after_minutes:
    'Minutes to wait after the part before the next can start, such as an incubation (0 to 525600).',
  p_needs:
    'JSON array of the instruments the part needs: each `{ resourceId, minutes }`, where `resourceId` is the instrument id.',
  p_slipped_part_id: 'For a re-plan: the part that ran late.',
  p_work_start_minute:
    'Minutes after midnight the working day starts (540 is 09:00).',
  p_work_end_minute:
    'Minutes after midnight the working day ends (1020 is 17:00).',
  p_work_days: 'Working days as ISO weekdays: 1 is Monday, 7 is Sunday.',
  p_version_id: 'Dataset version id.',
  p_contract_id: 'Data contract id.',
  p_dataset_schema_id: 'Dataset schema (table model) id the contract sits on.',
  p_record_model_key: 'Key of the record model the contract sits on.',
  p_rule: 'JSON object: one rule, as in `p_rules`.',
  p_rule_id: 'Id of a rule in the contract.',
  p_description: 'A description.',
  p_owner_user_id: 'The member who owns it.',
  p_lifecycle: '`draft`, `active` or `retired`.',
  p_schedule_minutes:
    'Run a check every this many minutes (5 to 525600); 0 turns scheduled checks off.',
  p_odcs:
    'An Open Data Contract Standard (ODCS v3.1) document as JSON. YAML parses to the same thing.',
  p_dataset_id: 'Dataset id.',
  p_rows: 'JSON array of rows about to be committed.',
  p_trigger: '`import` or `pipeline`.',
  p_goal: 'What you want to find out, in a sentence or two.',
  p_plan:
    'JSON plan: `{ summary, rationale, experiment: { title, templateRecordId }, parts: [{ title, dayOffset, handsOnMinutes, waitAfterMinutes, needs: [{ instrumentId, minutes }] }], plate: { name, format, wells }, worklist: { format, mode, sourcePlate, transfers }, samples: [{ recordId, quantity, unit }], schedule, warnings }`. Every id is checked when the plan is saved.',
  p_source: '`page`, `assistant` or `api`: where the plan was drawn up.',
  p_plan_id: 'Plan id.',
  p_factors:
    'JSON array of what the optimiser may change: `{ key, label, kind, min, max, values, unit }`. `kind` is `continuous` (needs `min` and `max`), `discrete` (numbers in `values`) or `categorical` (words in `values`).',
  p_objectives:
    'JSON array of what counts as better: `{ key, label, direction, target, weight, unit }`. `direction` is `maximise`, `minimise` or `target` (needs `target`). Up to four.',
  p_batch_size: 'Conditions asked for in each round.',
  p_max_rounds: 'Most rounds the campaign may use.',
  p_max_runs: 'Most runs in all, or leave out for no limit.',
  p_engine:
    '`auto` (BayBE when the lab’s Python runtime has it, the built-in optimiser otherwise), `baybe` or `builtin`.',
  p_layout:
    'JSON plate layout for each round: `{ plateFormat, replicates, blanks, negatives, positives, volumeUl, worklistFormat, sourcePlate }`. Leave `plateFormat` out to enter results by hand.',
  p_template_record_id:
    'Protocol each round’s experiment starts from, or leave out for a blank experiment.',
  p_auto_propose:
    '`true` to ask for the next round as soon as a round’s results are all in.',
  p_seed: 'Number that makes the optimiser repeatable.',
  p_round_id: 'Campaign round id.',
  p_objective_key:
    'Key of the objective to fill from the round’s plate readings.',
}

export const LAB_TABLES: Readonly<Record<string, LabTable>> = {
  experiment_parts: {
    summary:
      'A part of an experiment that runs over several days: its own page of the notebook, on a day counted from the start of the experiment. Parts run in `position` order. A part is done when all its steps are, or when it was marked done by hand.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['position', 'num', 1],
      ['title', 'text', 1],
      ['day_offset', 'int', 1],
      ['assignee_user_id', 'text', 0],
      ['opened_at', 'ts', 0],
      ['completed_at', 'ts', 0],
      ['completed_by_user_id', 'text', 0],
      ['opens_when', 'json', 0],
      ['gate_mode', 'text', 1],
      ['steps_in_order', 'bool', 1],
      ['gate_from_template', 'bool', 1],
      ['requires_sign_off', 'bool', 1],
      ['signed_off_at', 'ts', 0],
      ['signed_off_by_user_id', 'text', 0],
      ['signoff_id', 'uuid', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  gate_overrides: {
    summary:
      'Someone went on past a gate that warns, with a reason: who, when, what the gate was and what was still missing. The reviewer sees these.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['block_id', 'uuid', 0],
      ['part_id', 'uuid', 0],
      ['label', 'text', 1],
      ['missing', 'text[]', 1],
      ['reason', 'text', 1],
      ['created_at', 'ts', 1],
      ['created_by_user_id', 'text', 0],
    ],
  },
  experiment_part_signoffs: {
    summary:
      'A signature on a part of an experiment. `meaning` is `signed` (the person who did the part) or `witnessed` (a countersign of that signature, named in `countersigns_id`). `snapshot` is the part as it was frozen when signed, and `snapshot_digest` its SHA-256. Rows are never changed or removed.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['part_id', 'uuid', 1],
      ['part_number', 'int', 1],
      ['part_title', 'text', 1],
      ['meaning', 'text', 1],
      ['countersigns_id', 'uuid', 0],
      ['snapshot', 'json', 1],
      ['snapshot_digest', 'text', 1],
      ['signer_user_id', 'text', 1],
      ['signer_name', 'text', 1],
      ['auth_method', 'text', 1],
      ['signed_at', 'ts', 1],
    ],
  },
  experiment_part_requests: {
    summary:
      'A request to sign a finished part (`kind` is `sign`) or to countersign a signed one (`countersign`). `fulfilled_at` is set when it was done or no longer applies.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['part_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['signoff_id', 'uuid', 0],
      ['requested_user_id', 'text', 1],
      ['requested_by_user_id', 'text', 1],
      ['note', 'text', 0],
      ['due_at', 'ts', 0],
      ['created_at', 'ts', 1],
      ['fulfilled_at', 'ts', 0],
    ],
  },
  experiment_part_amendments: {
    summary:
      'A signed part was reopened to amend it. `signoff_id` is the signature set aside, which stays on record. Rows are never changed or removed.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['part_id', 'uuid', 1],
      ['signoff_id', 'uuid', 1],
      ['reason', 'text', 1],
      ['amended_by_user_id', 'text', 1],
      ['amended_at', 'ts', 1],
    ],
  },
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
  experiment_series: {
    summary:
      'An experiment that heads a series: it groups other experiments that run as separate pieces of one piece of work.',
    columns: [
      ['record_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['created_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
    ],
  },
  experiment_series_members: {
    summary:
      'An experiment in a series, with where it sits and the day it is planned. An experiment is in one series at most.',
    columns: [
      ['id', 'uuid', 1],
      ['series_record_id', 'uuid', 1],
      ['member_record_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['position', 'num', 1],
      ['planned_on', 'date', 0],
      ['created_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
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
      ['instrument_id', 'uuid', 0],
      ['storage_unit_id', 'uuid', 0],
      ['storage_room_id', 'uuid', 0],
      ['name', 'text', 1],
      ['unit', 'text', 0],
      ['low_limit', 'num', 0],
      ['high_limit', 'num', 0],
      ['limit_state', 'text', 1],
      ['out_of_range_since', 'ts', 0],
      ['last_value', 'num', 0],
      ['last_at', 'ts', 0],
      ['reading_count', 'bigint', 1],
      ['created_at', 'ts', 1],
    ],
  },
  record_structures: {
    summary:
      'The structure of a compound in a registry that takes structures: its parent (salts and solvents set aside), formula and mass. The drawing itself is in the entry’s structure field.',
    columns: [
      ['record_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['parent_code', 'text', 1],
      ['drawn_code', 'text', 1],
      ['formula', 'text', 0],
      ['mass', 'num', 0],
      ['salts', 'text[]', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
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
  data_contracts: {
    summary:
      'A data contract: rules for what good data looks like on a dataset schema or a record model. `last_status` is `pass`, `warning` or `fail`; `rules` is the list of rules.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['dataset_schema_id', 'uuid', 0],
      ['record_model_key', 'text', 0],
      ['name', 'text', 1],
      ['description', 'text', 0],
      ['owner_user_id', 'text', 0],
      ['version', 'int', 1],
      ['lifecycle', 'text', 1],
      ['rules', 'json', 1],
      ['schedule_minutes', 'int', 0],
      ['next_check_at', 'ts', 0],
      ['last_status', 'text', 0],
      ['last_checked_at', 'ts', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  data_contract_runs: {
    summary:
      'One check of a data contract. `status` is `pass`, `warning` or `fail`; `trigger` is `import`, `pipeline`, `manual` or `schedule`; `blocked` means an import or pipeline commit was refused. `results` says what each rule found.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['contract_id', 'uuid', 1],
      ['contract_version', 'int', 1],
      ['dataset_id', 'uuid', 0],
      ['trigger', 'text', 1],
      ['scope', 'text', 1],
      ['status', 'text', 1],
      ['rows_checked', 'bigint', 1],
      ['failed_rules', 'int', 1],
      ['blocked', 'bool', 1],
      ['results', 'json', 1],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  data_contract_dataset_status: {
    summary:
      "Where each dataset stands under its schema's contract: the latest full check.",
    columns: [
      ['contract_id', 'uuid', 1],
      ['dataset_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['status', 'text', 1],
      ['failed_rules', 'int', 1],
      ['run_id', 'uuid', 1],
      ['checked_at', 'ts', 1],
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
  plate_runs: {
    summary:
      'Plate runs: one plate read on an instrument, with its layout, readout, analysis settings and the last analysis (normalised values, Z-prime, hits and curves).',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['name', 'text', 1],
      ['project_id', 'uuid', 0],
      ['record_id', 'uuid', 0],
      ['design_id', 'uuid', 0],
      ['format', 'text', 1],
      ['rows', 'int', 1],
      ['cols', 'int', 1],
      ['wells', 'json', 1],
      ['readout', 'json', 1],
      ['config', 'json', 1],
      ['results', 'json', 0],
      ['qc_status', 'text', 0],
      ['status', 'text', 1],
      ['analysed_at', 'ts', 0],
      ['analysed_by', 'text', 0],
      ['metadata_version', 'int', 1],
      ['created_by', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  plate_worklists: {
    summary:
      'Liquid handler worklists: the transfers from a source plate to a destination plate, and what the robot log said was moved.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['name', 'text', 1],
      ['run_id', 'uuid', 0],
      ['record_id', 'uuid', 0],
      ['format', 'text', 1],
      ['mode', 'text', 1],
      ['source_plate', 'text', 1],
      ['source_format', 'text', 1],
      ['dest_plate', 'text', 1],
      ['dest_format', 'text', 1],
      ['transfers', 'json', 1],
      ['options', 'json', 1],
      ['status', 'text', 1],
      ['reconciled', 'json', 0],
      ['withdrawals', 'json', 0],
      ['completed_at', 'ts', 0],
      ['completed_by', 'text', 0],
      ['created_by', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  agent_action_requests: {
    summary:
      'An action an agent asked to take. `level` is what the workspace had set for it (auto, ask or never); `status` is pending (waiting for a person), approved, rejected, succeeded, failed or refused. A token sees only its own requests.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['action_key', 'text', 1],
      ['arguments', 'json', 1],
      ['summary', 'text', 1],
      ['level', 'text', 1],
      ['status', 'text', 1],
      ['requested_by_user_id', 'text', 0],
      ['requested_by_credential_id', 'uuid', 0],
      ['decided_by_user_id', 'text', 0],
      ['decided_at', 'ts', 0],
      ['decision_reason', 'text', 0],
      ['executed_at', 'ts', 0],
      ['result', 'json', 0],
      ['error', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  lab_watchers: {
    summary:
      'A scheduled review the lab turned on. `kind` is stock_expiring, stock_low, work_overdue, data_missing or results_off; `schedule` is hourly, daily or weekly.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['enabled', 'bool', 1],
      ['project_id', 'uuid', 0],
      ['schedule', 'text', 1],
      ['params', 'json', 1],
      ['owner_user_id', 'text', 1],
      ['last_run_at', 'ts', 0],
      ['last_found', 'int', 0],
      ['next_run_at', 'ts', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  pipeline_reproductions: {
    summary:
      'A finished pipeline run run again from its pinned version, parameters and inputs, and compared with the original. `status` is matches, differs or failed; `compared` says what it was compared against (the output dataset version, the stored preview, or the content digest); `summary` has the counts and `changes` the first differences.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['source_run_id', 'uuid', 1],
      ['definition_version_id', 'uuid', 1],
      ['status', 'text', 1],
      ['tolerance', 'num', 1],
      ['compared', 'text', 0],
      ['summary', 'json', 1],
      ['changes', 'json', 1],
      ['error_code', 'text', 0],
      ['error_message', 'text', 0],
      ['duration_ms', 'int', 0],
      ['requested_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  lineage_targets: {
    summary:
      'A place lineage events (OpenLineage) are sent: its address, namespace, the name of the header it signs with (the value is never shown) and whether it is switched on. Only people who manage integrations see these.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['name', 'text', 1],
      ['endpoint_url', 'text', 1],
      ['namespace', 'text', 1],
      ['auth_header_name', 'text', 1],
      ['has_secret', 'bool', 1],
      ['enabled', 'bool', 1],
      ['last_sequence', 'bigint', 1],
      ['last_test_at', 'ts', 0],
      ['last_test_ok', 'bool', 0],
      ['last_test_message', 'text', 0],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  lab_watcher_findings: {
    summary:
      'Something a watcher found, with the record it is about and, where one makes sense, a suggested action. `status` is open, snoozed, dismissed or resolved (no longer true).',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['watcher_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['object_kind', 'text', 1],
      ['object_id', 'uuid', 0],
      ['project_id', 'uuid', 0],
      ['title', 'text', 1],
      ['summary', 'text', 1],
      ['suggested_action', 'json', 0],
      ['status', 'text', 1],
      ['snoozed_until', 'ts', 0],
      ['resolved_at', 'ts', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  instrument_run_documents: {
    summary:
      'Instrument files converted to the Allotrope Simple Model (ASM): one vendor-neutral document per instrument run, with the converter, its version and the image that ran it.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['run_id', 'uuid', 1],
      ['instrument_id', 'uuid', 0],
      ['format', 'text', 1],
      ['technique', 'text', 0],
      ['manifest', 'text', 0],
      ['vendor', 'text', 0],
      ['converter', 'text', 1],
      ['converter_version', 'text', 0],
      ['image_digest', 'text', 0],
      ['measurements', 'int', 1],
      ['device', 'json', 1],
      ['document', 'json', 1],
      ['created_at', 'ts', 1],
      ['created_by_user_id', 'text', 0],
    ],
  },
  qc_series: {
    summary:
      'Quality control series: a value tracked across runs (a plate assay metric, or any value sent in), with its limits, the Westgard rules and whether it is in control.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['name', 'text', 1],
      ['source_kind', 'text', 1],
      ['design_id', 'uuid', 0],
      ['metric', 'text', 0],
      ['instrument_id', 'uuid', 0],
      ['unit', 'text', 0],
      ['mean', 'num', 0],
      ['sd', 'num', 0],
      ['baseline_n', 'int', 0],
      ['baseline_from', 'ts', 0],
      ['baseline_to', 'ts', 0],
      ['rules', 'text[]', 1],
      ['enabled', 'bool', 1],
      ['state', 'text', 1],
      ['state_changed_at', 'ts', 1],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  qc_points: {
    summary:
      'Quality control points: each value of a series with its distance from the mean in SD, the Westgard rules it broke and whether someone has acknowledged it.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['series_id', 'uuid', 1],
      ['plate_run_id', 'uuid', 0],
      ['instrument_run_id', 'uuid', 0],
      ['value', 'num', 1],
      ['at', 'ts', 1],
      ['label', 'text', 0],
      ['z', 'num', 0],
      ['violations', 'text[]', 1],
      ['excluded', 'bool', 1],
      ['acknowledged_at', 'ts', 0],
      ['acknowledged_by_user_id', 'text', 0],
      ['note', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  lineage_deliveries: {
    summary:
      'Each lineage event waiting to go to, or sent to, an endpoint. `status` is pending, delivered or failed; a failed one can be tried again with `retry_lineage_deliveries`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['target_id', 'uuid', 1],
      ['change_event_id', 'uuid', 1],
      ['event_type', 'text', 1],
      ['job_name', 'text', 1],
      ['run_id', 'uuid', 1],
      ['body', 'json', 1],
      ['status', 'text', 1],
      ['attempts', 'int', 1],
      ['next_attempt_at', 'ts', 1],
      ['http_status', 'int', 0],
      ['last_error', 'text', 0],
      ['delivered_at', 'ts', 0],
      ['created_at', 'ts', 1],
    ],
  },
  instrument_robot_settings: {
    summary:
      'An instrument that is a robot: how it is reached (`driver` is opentrons or file), the worklist file format it reads and the labware that file names.',
    columns: [
      ['instrument_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['driver', 'text', 1],
      ['worklist_format', 'text', 1],
      ['labware', 'json', 1],
      ['updated_at', 'ts', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  instrument_jobs: {
    summary:
      'A worklist sent to a robot. `status` goes queued, staged (on the robot, waiting for a person to press Start), starting, running, then complete, failed or cancelled. `log` is what happened, and `result` the transfers the robot reported; completing a job completes the worklist and records the stock it used.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['instrument_id', 'uuid', 1],
      ['worklist_id', 'uuid', 1],
      ['record_id', 'uuid', 0],
      ['driver', 'text', 1],
      ['worklist_format', 'text', 1],
      ['labware', 'json', 1],
      ['status', 'text', 1],
      ['cancel_requested', 'bool', 1],
      ['note', 'text', 0],
      ['remote_ref', 'text', 0],
      ['log', 'json', 1],
      ['error_message', 'text', 0],
      ['result', 'json', 0],
      ['agent_seen_at', 'ts', 0],
      ['queued_by_user_id', 'text', 1],
      ['started_by_user_id', 'text', 0],
      ['started_at', 'ts', 0],
      ['finished_at', 'ts', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  scheduler_settings: {
    summary:
      'The lab’s working day for the scheduler: time zone, the minutes after midnight it starts and ends, and the ISO weekdays that are worked.',
    columns: [
      ['workspace_id', 'uuid', 1],
      ['timezone', 'text', 1],
      ['work_start_minute', 'int', 1],
      ['work_end_minute', 'int', 1],
      ['work_days', 'int[]', 1],
      ['updated_at', 'ts', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  part_plans: {
    summary:
      'How long a part of an experiment takes: the hands-on minutes and the wait after it before the next part can start.',
    columns: [
      ['part_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['hands_on_minutes', 'int', 1],
      ['wait_after_minutes', 'int', 1],
      ['updated_at', 'ts', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  part_resource_needs: {
    summary:
      'An instrument a part needs and for how many minutes. `resource_id` is the instrument id.',
    columns: [
      ['id', 'uuid', 1],
      ['part_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['resource_id', 'uuid', 1],
      ['minutes', 'int', 1],
      ['position', 'int', 1],
    ],
  },
  schedule_proposals: {
    summary:
      'A proposed schedule for an experiment’s parts. `status` is requested, planning, proposed, accepted, dismissed, superseded or failed. `items` lists each slot with its instrument, person, times and what stands in its way. Nothing is booked until `accept_schedule_proposal`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['record_id', 'uuid', 1],
      ['status', 'text', 1],
      ['reason', 'text', 1],
      ['slipped_part_id', 'uuid', 0],
      ['anchor_on', 'date', 1],
      ['items', 'json', 1],
      ['conflict_count', 'int', 1],
      ['error_message', 'text', 0],
      ['requested_by_user_id', 'text', 1],
      ['decided_by_user_id', 'text', 0],
      ['decided_at', 'ts', 0],
      ['created_at', 'ts', 1],
      ['planned_at', 'ts', 0],
    ],
  },
  code_cell_runs: {
    summary:
      'Every run of a notebook code cell, kept with its code, the digests of the dataset versions it read, the first rows of the output and its digest, and the runtime it ran in (an image digest for Python). A run that reproduces another has `reproduces_run_id` and says whether the output `matches`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['block_id', 'uuid', 0],
      ['record_id', 'uuid', 1],
      ['language', 'text', 1],
      ['source', 'text', 1],
      ['source_sha256', 'text', 1],
      ['inputs', 'json', 1],
      ['parameters', 'json', 1],
      ['status', 'text', 1],
      ['output', 'json', 0],
      ['output_digest', 'text', 0],
      ['runtime', 'text', 0],
      ['environment', 'json', 0],
      ['logs', 'json', 1],
      ['error_message', 'text', 0],
      ['duration_ms', 'int', 0],
      ['reproduces_run_id', 'uuid', 0],
      ['matches', 'bool', 0],
      ['diff', 'json', 0],
      ['ran_by_user_id', 'text', 1],
      ['ran_at', 'ts', 1],
    ],
  },
  experiment_plans: {
    summary:
      'An experiment drawn up from a goal, ready to read and apply. `status` is proposed (waiting for a person), applied, dismissed or superseded. `plan` holds the protocol, parts, plate, worklist, samples and schedule request; `result` says what applying created. Nothing exists until `apply_experiment_plan`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['number', 'int', 1],
      ['project_id', 'uuid', 1],
      ['goal', 'text', 1],
      ['summary', 'text', 1],
      ['status', 'text', 1],
      ['source', 'text', 1],
      ['plan', 'json', 1],
      ['result', 'json', 0],
      ['created_by_user_id', 'text', 1],
      ['decided_by_user_id', 'text', 0],
      ['decided_at', 'ts', 0],
      ['created_at', 'ts', 1],
    ],
  },
  model_capabilities: {
    summary:
      'The features switched on for each record model, such as `campaigns` (records of the model can be optimised round by round). One row per model and feature; `settings` holds what the feature keeps for that model.',
    columns: [
      ['workspace_id', 'uuid', 1],
      ['model_key', 'text', 1],
      ['capability', 'text', 1],
      ['settings', 'json', 1],
      ['created_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
    ],
  },
  campaigns: {
    summary:
      'An optimisation campaign: what it varies (`factors`), what counts as better (`objectives`), its budget and how each round is laid out on a plate. `status` is draft, active, paused or finished. Each round’s experiment joins the series headed by `series_record_id`.',
    columns: [
      ['record_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['factors', 'json', 1],
      ['objectives', 'json', 1],
      ['batch_size', 'int', 1],
      ['max_rounds', 'int', 1],
      ['max_runs', 'int', 0],
      ['engine', 'text', 1],
      ['layout', 'json', 1],
      ['template_record_id', 'uuid', 0],
      ['auto_propose', 'bool', 1],
      ['seed', 'int', 1],
      ['status', 'text', 1],
      ['series_record_id', 'uuid', 0],
      ['created_by_user_id', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  campaign_rounds: {
    summary:
      'One round of a campaign. `status` is requested, proposing, proposed (waiting for a person to approve), approved (waiting for results), completed, rejected or failed. `trials` lists each condition with its wells and results; `engine`, `engine_version` and `image_digest` say what chose them and `rationale` why.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['campaign_record_id', 'uuid', 1],
      ['number', 'int', 1],
      ['status', 'text', 1],
      ['batch_size', 'int', 1],
      ['engine', 'text', 0],
      ['engine_version', 'text', 0],
      ['image_digest', 'text', 0],
      ['trials', 'json', 1],
      ['rationale', 'json', 1],
      ['plate', 'json', 0],
      ['experiment_record_id', 'uuid', 0],
      ['plate_run_id', 'uuid', 0],
      ['worklist_id', 'uuid', 0],
      ['error_message', 'text', 0],
      ['requested_by_user_id', 'text', 1],
      ['decided_by_user_id', 'text', 0],
      ['decided_at', 'ts', 0],
      ['created_at', 'ts', 1],
      ['proposed_at', 'ts', 0],
      ['completed_at', 'ts', 0],
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
  query_storage_readings: {
    summary: 'Read freezer and room readings',
    description:
      'Returns the readings kept for freezers, fridges, incubators and rooms: each measurement with its latest value, alarm limits and whether it is inside them (`state` is `ok`, `low` or `high`). Name a unit or a room, or leave both out for all of them.',
    scope: 'lab:read',
    params: [
      ['p_unit_id', 'uuid', 0],
      ['p_room_id', 'uuid', 0],
      ['p_out_of_range_only', 'bool', 0],
      ['p_limit', 'int', 0],
    ],
    result: 'json',
  },
  record_storage_readings: {
    summary: 'Record freezer or room readings',
    description:
      "Adds readings to one storage unit or room (name exactly one), creating a measurement for a new name. A temperature starts with that place's own range as its limits. Going outside the limits, or coming back, tells the people who manage storage and sends `storage.alarm.raised` or `storage.alarm.cleared` to webhooks. Returns how many were stored.",
    scope: 'lab:write',
    params: [
      ['p_unit_id', 'uuid', 0],
      ['p_room_id', 'uuid', 0],
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
  set_step_done: {
    summary: 'Finish or reopen a protocol step',
    description:
      'Ticks a protocol step as done, or reopens it, with an optional note. The step records who finished it and when. Returns the step.',
    scope: 'lab:write',
    params: [
      ['p_block_id', 'uuid', 1],
      ['p_done', 'bool', 0],
      ['p_note', 'text', 0],
    ],
    result: 'json',
  },
  add_step_result: {
    summary: 'Record a result on a protocol step',
    description:
      'Adds a measurement to the notebook straight after the step, so it reads in order and goes to review with the record. Returns the new block.',
    scope: 'lab:write',
    params: [
      ['p_block_id', 'uuid', 1],
      ['p_label', 'text', 1],
      ['p_value', 'text', 1],
      ['p_unit', 'text', 0],
    ],
    result: 'json',
  },
  record_parts: {
    summary: 'List the parts of an experiment with where each stands',
    description:
      'Every part in order, with `due_on` (the day it falls on) and its steps. `status` is `done`, `now` (the first part that is not done) or `later`. Empty for an experiment with no parts.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result:
      'rows:part_id=uuid,part_number=int,title=text,day_offset=int,due_on=date,assignee_user_id=text,status=text,is_current=bool,opened_at=ts,completed_at=ts,completed_by_user_id=text,step_count=int,steps_done=int,block_count=int,result_count=int',
  },
  parts_in_range: {
    summary:
      'List the parts of running experiments that fall in a range of days',
    description:
      'Parts of experiments that are in progress or returned, whose day falls from `p_from` up to (not including) `p_to`, in date order. `due_on` is the day. `status` is `done`, `now` or `later`. At most 500 rows.',
    scope: 'lab:read',
    params: [
      ['p_from', 'date', 1],
      ['p_to', 'date', 1],
    ],
    result:
      'rows:part_id=uuid,record_id=uuid,identifier=text,record_title=text,part_number=int,title=text,day_offset=int,due_on=date,assignee_user_id=text,status=text',
  },
  create_experiment_part: {
    summary: 'Add a part to an experiment',
    description:
      'Adds a part after `p_after_part_id`, or at the end. The first part takes the blocks already on the page. Returns the part.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_title', 'text', 1],
      ['p_day_offset', 'int', 0],
      ['p_after_part_id', 'uuid', 0],
    ],
    result: 'row:experiment_parts',
  },
  update_experiment_part: {
    summary: 'Change a part of an experiment',
    description:
      'Changes the title, the day or who does it. Pass `p_clear_assignee` to clear the person. Returns the part.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_title', 'text', 0],
      ['p_day_offset', 'int', 0],
      ['p_assignee_user_id', 'text', 0],
      ['p_clear_assignee', 'bool', 0],
    ],
    result: 'row:experiment_parts',
  },
  move_experiment_part: {
    summary: 'Reorder the parts of an experiment',
    description:
      'Moves a part to sit after `p_after_part_id`, or first when that is left out. Its blocks move with it. Returns the part.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_after_part_id', 'uuid', 0],
    ],
    result: 'row:experiment_parts',
  },
  delete_experiment_part: {
    summary: 'Delete a part of an experiment',
    description:
      'Deletes the part. A part that still has blocks needs `p_move_blocks_to`, the part that takes them. Returns how many blocks moved.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_move_blocks_to', 'uuid', 0],
    ],
    result: 'json',
  },
  set_part_done: {
    summary: 'Mark a part of an experiment done or open',
    description:
      'For a part with no steps. A part with steps is done when its steps are. Finishing the current part opens the next. Returns the part.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_done', 'bool', 1],
    ],
    result: 'row:experiment_parts',
  },
  pin_protocol_reference: {
    summary: 'Pin a protocol to an experiment and copy its steps and gates',
    description:
      "Pins the exact protocol version into the experiment's empty protocol block and copies its procedure steps in, with the protocol's gate blocks in their place. Gates from the protocol cannot be changed or removed on the experiment. Returns the block, the pinned revision, `copied_steps` and `copied_gates`.",
    scope: 'lab:write',
    params: [
      ['p_block_id', 'uuid', 1],
      ['p_protocol_record_id', 'uuid', 1],
      ['p_expected_block_version', 'int', 1],
      ['p_expected_structure_version', 'int', 1],
    ],
    result: 'json',
  },
  record_gates: {
    summary: 'List the gates of an experiment and what each still waits on',
    description:
      'Every gate in page order: the "opens when" rule of each part, then the gate blocks. `met` is true when every condition holds. `blocking` is true when the gate holds work back now: it is unmet, set to `block`, and not only waiting on a date. `missing` says what is still to do, in words, and `conditions` has the answer for each condition. `overridden` is true when someone went on past a gate that warns.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result:
      'rows:gate_id=text,gate_kind=text,block_id=uuid,part_id=uuid,part_number=int,label=text,mode=text,met=bool,blocking=bool,overridden=bool,overridden_at=ts,overridden_by_user_id=text,override_reason=text,missing=text[],conditions=json,from_template=bool',
  },
  set_part_gate: {
    summary: 'Set the rule that opens a part of an experiment',
    description:
      'Sets, changes or clears the conditions that open a part, whether the gate warns or blocks, and whether the steps of the part are done in order. A gate that came from a template cannot be changed. Returns the part. A gate that blocks is enforced by the database: writes in the part, and finishing it, are refused with error code `SB150` until the conditions hold.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_conditions', 'json', 0],
      ['p_gate_mode', 'text', 0],
      ['p_steps_in_order', 'bool', 0],
    ],
    result: 'row:experiment_parts',
  },
  override_gate: {
    summary: 'Go on past a gate that warns, with a reason',
    description:
      'Name the gate block or the part. The reason (1 to 2000 characters) is kept with the experiment and shown to the reviewer. A gate that blocks cannot be gone past (`SB155`), and one that is already open needs no going past (`SB156`). Returns the override. Sends `experiment.gate_overridden`.',
    scope: 'lab:write',
    params: [
      ['p_gate_block_id', 'uuid', 0],
      ['p_gate_part_id', 'uuid', 0],
      ['p_reason', 'text', 1],
    ],
    result: 'row:gate_overrides',
  },
  part_signoff_preview: {
    summary: 'Show what signing a part would cover',
    description:
      'The SHA-256 digest of the part as it is now, how many blocks and steps it holds, whether it needs a signature, is finished and is signed. A signature is bound to this digest. Signing itself is done by a person in the app with a fresh password, never over the API.',
    scope: 'lab:read',
    params: [['p_part_id', 'uuid', 1]],
    result: 'json',
  },
  record_part_signoffs: {
    summary: 'List where each part of an experiment stands on signatures',
    description:
      'Every part in order: whether it needs a signature, is finished and waiting (`awaiting_sign_off`), who signed and when, who has countersigned or been asked to, and how often it was amended (with the last reason). Empty for an experiment with no parts.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result:
      'rows:part_id=uuid,part_number=int,title=text,requires_sign_off=bool,work_done=bool,awaiting_sign_off=bool,signed=bool,signoff_id=uuid,signed_at=ts,signed_by_user_id=text,signer_name=text,snapshot_digest=text,countersigned_by=text[],countersign_requested_from=text[],sign_requested_from=text[],amendment_count=int,last_amended_at=ts,last_amendment_reason=text',
  },
  set_parts_sign_off: {
    summary:
      'Require a signature on the parts of an experiment, or stop requiring it',
    description:
      'Applies to the parts that are not signed yet, and to parts added later. When a part needs a signature it counts as finished only once it is signed, and the parts after it cannot be worked until then. Returns how many parts changed.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_required', 'bool', 1],
    ],
    result: 'json',
  },
  request_part_signoff: {
    summary: 'Ask someone to sign or countersign a part of an experiment',
    description:
      'For a finished part that is waiting, asks the person to sign it; for a signed part, asks them to countersign. They get a notification. Nothing is signed on their behalf: signing needs the person, in the app, with a fresh password.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_user_id', 'text', 1],
      ['p_note', 'text', 0],
      ['p_due_at', 'ts', 0],
    ],
    result: 'json',
  },
  amend_experiment_part: {
    summary: 'Reopen a signed part of an experiment to amend it',
    description:
      'Needs a reason. Only that part is reopened; the signature stays on record and the part has to be signed again before the parts after it can go on. Returns the amendment.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_reason', 'text', 1],
    ],
    result: 'json',
  },
  set_block_part: {
    summary: 'Move a block to another part',
    description:
      'Puts the block at the end of that part of the notebook. Returns the block, its part and its new order.',
    scope: 'lab:write',
    params: [
      ['p_block_id', 'uuid', 1],
      ['p_part_id', 'uuid', 1],
    ],
    result: 'json',
  },
  set_link_part: {
    summary: 'Move a sample, dataset or other link to another part',
    description:
      'Links made from an experiment that has parts land in the part being worked on. This moves one to another part of the same experiment. Returns the link and its part.',
    scope: 'lab:write',
    params: [
      ['p_link_id', 'uuid', 1],
      ['p_part_id', 'uuid', 1],
    ],
    result: 'json',
  },
  split_record_into_parts: {
    summary: 'Split an experiment into parts',
    description:
      'Divides a notebook that has no parts at the blocks you name. Returns the parts.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_parts', 'json', 1],
    ],
    result: 'rows:id=uuid,title=text,day_offset=int',
  },
  record_steps: {
    summary: 'List the steps of an experiment with their status',
    description:
      'Every protocol step in order. `status` comes from the evidence on the notebook: `done` when ticked, `in_progress` when it has a note, a result or a running timer of yours, otherwise `not_started`. `is_current` marks the first step that is not done. In an experiment with parts, `step_number` is the place in the part.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result:
      'rows:block_id=uuid,step_number=int,step_text=text,status=text,is_current=bool,completed_at=ts,completed_by_user_id=text,note=text,result_count=int,duration_seconds=int,timer_ends_at=ts,instrument_id=uuid,part_id=uuid,part_number=int,part_title=text,part_step_number=int,part_step_count=int',
  },
  start_experiment_series: {
    summary: 'Make an experiment a series',
    description:
      'Marks an experiment as the head of a series so members can be added. Adding the first member does this by itself. Safe to repeat.',
    scope: 'lab:write',
    params: [['p_record_id', 'uuid', 1]],
    result: 'json',
  },
  add_series_member: {
    summary: 'Add an experiment to a series',
    description:
      'Puts an experiment in a series, at the end unless a position is given, and makes the series if it is not one yet. The experiment keeps its own owner, review and signature and is not changed, even when approved. An experiment is in one series at most and a series cannot sit inside another. Returns the membership.',
    scope: 'lab:write',
    params: [
      ['p_series_record_id', 'uuid', 1],
      ['p_member_record_id', 'uuid', 1],
      ['p_position', 'num', 0],
      ['p_planned_on', 'date', 0],
    ],
    result: 'json',
  },
  remove_series_member: {
    summary: 'Take an experiment out of its series',
    description:
      'Removes an experiment from the series it is in. The experiment is not changed.',
    scope: 'lab:write',
    params: [['p_member_record_id', 'uuid', 1]],
    result: 'json',
  },
  move_series_member: {
    summary: 'Move an experiment within its series',
    description:
      'Changes where a member sits. Positions are numbers and members are ordered by them; use a number between two neighbours to go between them.',
    scope: 'lab:write',
    params: [
      ['p_member_record_id', 'uuid', 1],
      ['p_position', 'num', 1],
    ],
    result: 'json',
  },
  set_series_member_day: {
    summary: 'Plan the day a series member runs',
    description:
      'Sets the day a member of a series is planned for, or clears it when `p_planned_on` is left out. The series counts its days from the earliest planned day.',
    scope: 'lab:write',
    params: [
      ['p_member_record_id', 'uuid', 1],
      ['p_planned_on', 'date', 0],
    ],
    result: 'json',
  },
  dissolve_experiment_series: {
    summary: 'Stop treating an experiment as a series',
    description:
      'Removes the series, which frees its members. Neither the head nor the members are changed otherwise. Sends `experiment.series_member_removed` for each member.',
    scope: 'lab:write',
    params: [['p_record_id', 'uuid', 1]],
    result: 'json',
  },
  series_members: {
    summary: 'List the experiments in a series',
    description:
      'The members of a series in order, as you may see them: an experiment you cannot read is left out. Each row has the experiment, its status, owner, reviewer, planned day, steps done out of total and how many samples it links.',
    scope: 'lab:read',
    params: [['p_series_record_id', 'uuid', 1]],
    result:
      'rows:member_record_id=uuid,member_number=int,position=num,identifier=text,title=text,status=text,owner_user_id=text,reviewer_user_id=text,assignee_user_id=text,planned_on=date,planned_end=date,day_offset=int,locked_at=ts,steps_total=int,steps_done=int,sample_count=int',
  },
  series_rollup: {
    summary: 'What a series adds up to',
    description:
      'How many experiments the series has and how many are approved, in review and in progress, the next one due, the samples across all of them and the first and last planned days.',
    scope: 'lab:read',
    params: [['p_series_record_id', 'uuid', 1]],
    result: 'json',
  },
  record_series: {
    summary: 'Which series an experiment is in',
    description:
      'The series an experiment belongs to, where it sits ("3 of 5") and the experiments either side of it. No row when it is in no series.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result:
      'rows:series_record_id=uuid,series_identifier=text,series_title=text,member_number=int,member_total=int,previous_record_id=uuid,previous_identifier=text,previous_title=text,next_record_id=uuid,next_identifier=text,next_title=text',
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
  register_compound: {
    summary: 'Register a compound by its structure',
    description:
      'Adds an entry to a registry that takes structures and checks it against the compounds already there. Two structures with the same parent (salts and solvents set aside) are the same compound, and a repeat is refused unless `p_allow_duplicate` is true. `p_structure` is the description of the drawing: get it from `POST /api/structures/describe` (or pass `{"smiles": "…"}` through MCP). Returns the new entry.',
    scope: 'lab:write',
    params: [
      ['p_project_id', 'uuid', 1],
      ['p_kind', 'text', 1],
      ['p_title', 'text', 1],
      ['p_custom_fields', 'json', 0],
      ['p_structure', 'json', 1],
      ['p_allow_duplicate', 'bool', 0],
    ],
    result: 'row:records',
  },
  set_record_structure: {
    summary: 'Change the structure of a compound',
    description:
      'Replaces the drawn structure of an entry. The entry must be at the `metadata_version` you read, and the new parent must not already be registered. `p_structure` is described as for `register_compound`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_structure', 'json', 1],
      ['p_allow_duplicate', 'bool', 0],
    ],
    result: 'row:records',
  },
  find_structure_duplicates: {
    summary: 'Check whether a compound is registered',
    description:
      'Lists the entries of a registry with the same parent structure as the one described. `same_form` is false when the entry is the same compound as a different salt or solvate, which belongs in as a lot. Takes `parentCode` and `drawnCode` from `POST /api/structures/describe`.',
    scope: 'lab:read',
    params: [
      ['p_kind', 'text', 1],
      ['p_parent_code', 'text', 1],
      ['p_drawn_code', 'text', 0],
      ['p_exclude_id', 'uuid', 0],
    ],
    result:
      'rows:id=uuid,identifier=text,title=text,archived=bool,same_form=bool',
  },
  query_structures: {
    summary: 'Find compounds by fingerprint',
    description:
      'Narrows compounds by a 512-bit structure fingerprint. `p_mode` `substructure` keeps those whose fingerprint includes the query’s (candidates only: confirm them atom by atom), `similarity` keeps those at least `p_min_similarity` alike (0 to 1). Most callers want `POST /api/structures/search`, which does both steps from a SMILES line.',
    scope: 'lab:read',
    params: [
      ['p_fingerprint', 'text', 1],
      ['p_mode', 'text', 0],
      ['p_kind', 'text', 0],
      ['p_min_similarity', 'num', 0],
      ['p_include_archived', 'bool', 0],
      ['p_limit', 'int', 0],
    ],
    result:
      'rows:record_id=uuid,identifier=text,title=text,kind=text,parent_code=text,formula=text,mass=num,salts=text[],archived=bool,similarity=num',
  },
  add_compound_lot: {
    summary: 'Add a lot to a compound',
    description:
      'Makes a record of the registry’s lot model, linked to the compound, in the compound’s project unless `p_project_id` names another. Sends `compound.lot_added` to webhooks. Returns the lot.',
    scope: 'lab:write',
    params: [
      ['p_compound_id', 'uuid', 1],
      ['p_project_id', 'uuid', 0],
      ['p_title', 'text', 0],
      ['p_custom_fields', 'json', 0],
    ],
    result: 'row:records',
  },
  list_compound_lots: {
    summary: 'List the lots of a compound',
    description: 'The lots made for a compound, oldest first.',
    scope: 'lab:read',
    params: [['p_compound_id', 'uuid', 1]],
    result:
      'rows:id=uuid,identifier=text,title=text,kind=text,custom_fields=json,created_at=ts,archived=bool',
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
  save_data_contract: {
    summary: 'Make or change a data contract',
    description:
      'Makes the contract on a dataset schema or a record model, or changes it. Anything left out keeps its value. A change of rules makes a new version. Needs an owner, admin or steward.',
    scope: 'lab:write',
    params: [
      ['p_dataset_schema_id', 'uuid', 0],
      ['p_record_model_key', 'text', 0],
      ['p_rules', 'json', 0],
      ['p_name', 'text', 0],
      ['p_description', 'text', 0],
      ['p_owner_user_id', 'text', 0],
      ['p_lifecycle', 'text', 0],
      ['p_schedule_minutes', 'int', 0],
    ],
    result: 'row:data_contracts',
  },
  add_contract_rule: {
    summary: 'Add a rule to a data contract',
    description:
      'Adds one rule, such as a required field or a range. An id is made if you leave it out. Needs an owner, admin or steward.',
    scope: 'lab:write',
    params: [
      ['p_contract_id', 'uuid', 1],
      ['p_rule', 'json', 1],
    ],
    result: 'row:data_contracts',
  },
  remove_contract_rule: {
    summary: 'Remove a rule from a data contract',
    description:
      'Removes one rule by its id. Needs an owner, admin or steward.',
    scope: 'lab:write',
    params: [
      ['p_contract_id', 'uuid', 1],
      ['p_rule_id', 'text', 1],
    ],
    result: 'row:data_contracts',
  },
  delete_data_contract: {
    summary: 'Delete a data contract',
    description:
      'Deletes the contract and its run history. Needs an owner, admin or steward.',
    scope: 'lab:write',
    params: [['p_contract_id', 'uuid', 1]],
    result: 'void',
  },
  run_contract_check: {
    summary: 'Check a data contract now',
    description:
      'Checks the stored data against the contract and keeps the result as a run: every active dataset under a dataset schema contract (or the one named), or the records of a model. Returns the standing and the runs.',
    scope: 'lab:write',
    params: [
      ['p_contract_id', 'uuid', 1],
      ['p_dataset_id', 'uuid', 0],
    ],
    result: 'json',
  },
  preview_contract_rules: {
    summary: 'See what a change of rules would find',
    description:
      'Checks the data as it stands against rules you are thinking of, without saving them or recording a run. Needs an owner, admin or steward.',
    scope: 'lab:read',
    params: [
      ['p_contract_id', 'uuid', 1],
      ['p_rules', 'json', 1],
      ['p_dataset_id', 'uuid', 0],
    ],
    result: 'json',
  },
  check_dataset_contract: {
    summary: 'Check rows against a dataset’s contract before committing them',
    description:
      'Checks a batch of rows, in the shape of `commit_dataset_row_batch`, against the contract on the dataset’s schema and records a run. If `blocked` is true a block-mode rule found a problem and the rows should not be committed. Imports do this themselves; call it before committing from a pipeline or script.',
    scope: 'lab:write',
    params: [
      ['p_dataset_id', 'uuid', 1],
      ['p_rows', 'json', 1],
      ['p_trigger', 'text', 0],
    ],
    result: 'json',
  },
  check_record_contract: {
    summary: 'Does a record meet its model’s contract?',
    description:
      'Advisory: lists the rules a record breaks. Nothing is recorded and nothing is blocked.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result: 'json',
  },
  check_record_batch_contract: {
    summary: 'Check records about to be created against their model’s contract',
    description:
      'Advisory: rows are `{ values: { field_name: value } }`. Nothing is recorded.',
    scope: 'lab:read',
    params: [
      ['p_record_model_key', 'text', 1],
      ['p_rows', 'json', 1],
    ],
    result: 'json',
  },
  export_data_contract_odcs: {
    summary: 'Export a data contract as ODCS',
    description:
      'Returns the contract as an Open Data Contract Standard (v3.1) document, as JSON. Save it as YAML to keep it in git.',
    scope: 'lab:read',
    params: [['p_contract_id', 'uuid', 1]],
    result: 'json',
  },
  import_data_contract_odcs: {
    summary: 'Import a data contract from ODCS',
    description:
      'Reads an ODCS v3.1 document and makes or replaces the contract it describes. The target is the dataset schema or record model named by the document unless you give one. Returns the contract and a list of what was left out. Needs an owner, admin or steward.',
    scope: 'lab:write',
    params: [
      ['p_odcs', 'json', 1],
      ['p_dataset_schema_id', 'uuid', 0],
      ['p_record_model_key', 'text', 0],
    ],
    result: 'json',
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
  create_plate_run: {
    summary: 'Create a plate run',
    description:
      'Stores a plate: its format (`6_well` to `1536_well`), layout, readout and analysis settings. Returns the run. Sends `plate_run.created`.',
    scope: 'lab:write',
    params: [
      ['p_name', 'text', 1],
      ['p_format', 'text', 1],
      ['p_wells', 'json', 0],
      ['p_readout', 'json', 0],
      ['p_config', 'json', 0],
      ['p_project_id', 'uuid', 0],
      ['p_record_id', 'uuid', 0],
      ['p_design_id', 'uuid', 0],
    ],
    result: 'row:plate_runs',
  },
  update_plate_run: {
    summary: 'Change a plate run',
    description:
      'Renames a run or replaces its layout, readout or settings. Changing the layout, readout or settings clears the saved analysis. Returns the run.',
    scope: 'lab:write',
    params: [
      ['p_plate_run_id', 'uuid', 1],
      ['p_name', 'text', 0],
      ['p_wells', 'json', 0],
      ['p_readout', 'json', 0],
      ['p_config', 'json', 0],
      ['p_expected_metadata_version', 'int', 0],
    ],
    result: 'row:plate_runs',
  },
  save_plate_run_analysis: {
    summary: 'Save the analysis of a plate run',
    description:
      'Keeps an analysis beside the run it was computed from, with the plate QC verdict (`pass`, `warn`, `fail` or `not_checked`). Returns the run. Sends `plate_run.analysed`.',
    scope: 'lab:write',
    params: [
      ['p_plate_run_id', 'uuid', 1],
      ['p_analysis', 'json', 1],
      ['p_qc_status', 'text', 1],
      ['p_expected_metadata_version', 'int', 0],
    ],
    result: 'row:plate_runs',
  },
  archive_plate_run: {
    summary: 'Archive a plate run',
    description:
      'Archives a run so it no longer shows in lists. Returns the run. Sends `plate_run.archived`.',
    scope: 'lab:write',
    params: [['p_plate_run_id', 'uuid', 1]],
    result: 'row:plate_runs',
  },
  create_plate_worklist: {
    summary: 'Create a liquid handler worklist',
    description:
      'Stores the transfers for a robot: `p_format` is `csv`, `echo`, `tecan_gwl`, `hamilton` or `opentrons`; `p_mode` is `stamp` or `cherry_pick`. `p_transfers` is a JSON array of `{ sourceWell, destWell, volumeUl, label, sampleId }`. Returns the worklist. Sends `plate_worklist.created`.',
    scope: 'lab:write',
    params: [
      ['p_name', 'text', 1],
      ['p_format', 'text', 1],
      ['p_mode', 'text', 1],
      ['p_source_plate', 'text', 1],
      ['p_source_format', 'text', 1],
      ['p_dest_plate', 'text', 1],
      ['p_dest_format', 'text', 1],
      ['p_transfers', 'json', 1],
      ['p_plate_run_id', 'uuid', 0],
      ['p_record_id', 'uuid', 0],
      ['p_options', 'json', 0],
    ],
    result: 'row:plate_worklists',
  },
  complete_plate_worklist: {
    summary: 'Complete a worklist from the robot log',
    description:
      'Records what the robot did: `p_reconciled` is the planned transfers each with a `status` and `movedUl`. By default the volumes moved are withdrawn from the source samples for the experiment, which also links them to it; samples that cannot be withdrawn from are listed in `withdrawals`. Returns the worklist. Sends `plate_worklist.completed`.',
    scope: 'lab:write',
    params: [
      ['p_worklist_id', 'uuid', 1],
      ['p_reconciled', 'json', 1],
      ['p_purpose_record_id', 'uuid', 0],
      ['p_record_withdrawals', 'bool', 0],
    ],
    result: 'row:plate_worklists',
  },
  cancel_plate_worklist: {
    summary: 'Cancel a worklist',
    description:
      'Cancels a worklist that has not been completed. Returns the worklist.',
    scope: 'lab:write',
    params: [['p_worklist_id', 'uuid', 1]],
    result: 'row:plate_worklists',
  },
  request_agent_action: {
    summary: 'Ask to take an action',
    description:
      'Records an action an agent wants to take and returns the request. What happens next depends on the workspace setting for that action: `refused` (Never), `pending` (Ask: a person approves it in the Inbox) or `approved` (Auto: the caller runs it now). Signing, submitting for review, amending, locking and deleting are always refused.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_action_key', 'text', 1],
      ['p_arguments', 'json', 1],
      ['p_summary', 'text', 1],
      ['p_provenance', 'json', 1],
      ['p_idempotency_key', 'text', 1],
    ],
    result: 'row:agent_action_requests',
  },
  set_lab_watcher: {
    summary: 'Turn a lab watcher on or off',
    description:
      'Sets a watcher: `p_kind` is `stock_expiring`, `stock_low`, `work_overdue`, `data_missing` or `results_off`; `p_schedule` is `hourly`, `daily` or `weekly`; `p_project_id` limits it to one project; `p_params` can set `days` (how soon counts as soon) or `sigma` (how far off a result must be). Returns the watcher.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_kind', 'text', 1],
      ['p_enabled', 'bool', 1],
      ['p_schedule', 'text', 0],
      ['p_project_id', 'uuid', 0],
      ['p_params', 'json', 0],
    ],
    result: 'row:lab_watchers',
  },
  run_lab_watcher: {
    summary: 'Run a lab watcher now',
    description:
      'Looks straight away instead of waiting for the schedule. Returns how many new findings were made. Sends `watcher.finding.created` for each.',
    scope: 'lab:write',
    params: [['p_watcher_id', 'uuid', 1]],
    result: 'int',
  },
  set_watcher_finding_status: {
    summary: 'Dismiss or snooze a watcher finding',
    description:
      '`p_action` is `dismiss`, `snooze` (with `p_until`, a time in the future) or `reopen`. Returns the finding.',
    scope: 'lab:write',
    params: [
      ['p_finding_id', 'uuid', 1],
      ['p_action', 'text', 1],
      ['p_until', 'ts', 0],
    ],
    result: 'row:lab_watcher_findings',
  },
  resolve_agent_action_level: {
    summary: 'What an agent may do with an action',
    description:
      'Returns `auto`, `ask` or `never` for an action, for the caller: a setting for this credential beats one for the caller’s role, which beats the one for everyone, and with none the answer is `ask`. Signing, submitting for review, amending, locking and deleting are always `never`.',
    scope: 'lab:read',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_action_key', 'text', 1],
      ['p_credential_id', 'uuid', 0],
    ],
    result: 'text',
  },
  finish_agent_action: {
    summary: 'Record how an agent action ended',
    description:
      'Marks an approved request as succeeded or failed once the action has been run. Only the person who approved it, or the requester when the action was Auto, can call it.',
    scope: 'lab:write',
    params: [
      ['p_request_id', 'uuid', 1],
      ['p_ok', 'bool', 1],
      ['p_result', 'json', 0],
      ['p_error', 'text', 0],
    ],
    result: 'row:agent_action_requests',
  },
  record_instrument_run_document: {
    summary: 'Keep an Allotrope document with an instrument run',
    description:
      'Stores the ASM document an instrument file was converted to, beside the run it came from. One per run; sending it again replaces it. Returns the document. Sends `instrument.run.converted`.',
    scope: 'lab:write',
    params: [
      ['p_run_id', 'uuid', 1],
      ['p_document', 'json', 1],
      ['p_converter', 'text', 1],
      ['p_converter_version', 'text', 0],
      ['p_image_digest', 'text', 0],
      ['p_vendor', 'text', 0],
      ['p_technique', 'text', 0],
      ['p_manifest', 'text', 0],
      ['p_measurements', 'int', 0],
      ['p_device', 'json', 0],
    ],
    result: 'row:instrument_run_documents',
  },
  create_qc_series: {
    summary: 'Track a value for quality control',
    description:
      'Starts a series. For a value you send in, use `manual` and add points with `record_qc_point`; for a plate assay use `plate_metric` with a `p_design_id` and `p_metric`. Give `p_mean` and `p_sd`, or set a baseline later. Returns the series.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_name', 'text', 1],
      ['p_source_kind', 'text', 0],
      ['p_metric', 'text', 0],
      ['p_design_id', 'uuid', 0],
      ['p_instrument_id', 'uuid', 0],
      ['p_unit', 'text', 0],
      ['p_mean', 'num', 0],
      ['p_sd', 'num', 0],
      ['p_rules', 'text[]', 0],
    ],
    result: 'row:qc_series',
  },
  track_plate_assay_qc: {
    summary: 'Track the controls of a plate assay',
    description:
      'Starts a series for each plate quality metric (Z-prime, signal to background, control means) of an assay design, and backfills them from its analysed runs. Returns the series.',
    scope: 'lab:write',
    params: [
      ['p_design_id', 'uuid', 1],
      ['p_instrument_id', 'uuid', 0],
    ],
    result: 'json',
  },
  update_qc_series: {
    summary: 'Change a quality control series',
    description:
      'Renames a series, changes its rules or unit, or pauses and resumes it. Changing the rules re-judges every point. Returns the series.',
    scope: 'lab:write',
    params: [
      ['p_series_id', 'uuid', 1],
      ['p_name', 'text', 0],
      ['p_rules', 'text[]', 0],
      ['p_enabled', 'bool', 0],
      ['p_unit', 'text', 0],
    ],
    result: 'row:qc_series',
  },
  delete_qc_series: {
    summary: 'Stop tracking a series',
    description: 'Deletes a series and all of its points.',
    scope: 'lab:write',
    params: [['p_series_id', 'uuid', 1]],
    result: 'void',
  },
  set_qc_baseline: {
    summary: 'Set the control limits of a series',
    description:
      'Enter `p_mean` and `p_sd`, or give `p_first_n` to take them from the first N points. Every point is judged again. Returns the series. Sends `qc.violation` or `qc.back_in_control` if the state changes.',
    scope: 'lab:write',
    params: [
      ['p_series_id', 'uuid', 1],
      ['p_mean', 'num', 0],
      ['p_sd', 'num', 0],
      ['p_first_n', 'int', 0],
    ],
    result: 'row:qc_series',
  },
  record_qc_point: {
    summary: 'Add a value to a series',
    description:
      'Adds a measurement and judges it against the limits and the series rules. Returns the point, with its `z` and any `violations`. Sends `qc.violation` when a rule is broken, and `qc.back_in_control` when the series recovers.',
    scope: 'lab:write',
    params: [
      ['p_series_id', 'uuid', 1],
      ['p_value', 'num', 1],
      ['p_at', 'ts', 0],
      ['p_label', 'text', 0],
      ['p_instrument_run_id', 'uuid', 0],
    ],
    result: 'row:qc_points',
  },
  acknowledge_qc_point: {
    summary: 'Acknowledge a quality control breach',
    description:
      'Marks a broken point as seen, with a note, and optionally leaves it out of the limits so the series is judged again. Returns the point.',
    scope: 'lab:write',
    params: [
      ['p_point_id', 'uuid', 1],
      ['p_note', 'text', 0],
      ['p_exclude', 'bool', 0],
    ],
    result: 'row:qc_points',
  },
  save_lineage_target: {
    summary: 'Add or change a lineage endpoint',
    description:
      'Adds an endpoint for OpenLineage events (or changes one when `p_id` is set). New endpoints start switched off and send only what happens after they are switched on. The header value is set in Settings, Integrations, because it is stored sealed. Needs permission to manage integrations. Sends `lineage.endpoint.created` or `lineage.endpoint.updated`.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_id', 'uuid', 0],
      ['p_name', 'text', 1],
      ['p_endpoint_url', 'text', 1],
      ['p_namespace', 'text', 0],
      ['p_auth_header_name', 'text', 0],
      ['p_enabled', 'bool', 0],
    ],
    result: 'row:lineage_targets',
  },
  delete_lineage_target: {
    summary: 'Remove a lineage endpoint',
    description:
      'Removes the endpoint and anything not yet sent to it. Needs permission to manage integrations.',
    scope: 'lab:write',
    params: [['p_id', 'uuid', 1]],
    result: 'void',
  },
  retry_lineage_deliveries: {
    summary: 'Try failed lineage events again',
    description:
      'Puts the failed events for an endpoint back in the queue and returns how many. Needs permission to manage integrations.',
    scope: 'lab:write',
    params: [['p_target_id', 'uuid', 1]],
    result: 'int',
  },
  set_event_stream_retention: {
    summary: 'Set how long the event stream keeps events',
    description:
      'Days of history `GET /api/events/stream` can replay, from 1 to 3650 (default 30). Returns the new value. Needs permission to manage integrations.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_days', 'int', 1],
    ],
    result: 'int',
  },
  set_instrument_robot: {
    summary: 'Make an instrument a robot, or change how it is reached',
    description:
      'Sets how worklists reach the instrument: `opentrons` (the robot is on the network) or `file` (its own software reads a folder), the worklist file it reads and the labware that file names. The folder agent on the lab computer does the rest. Needs permission to manage instruments. Returns the settings.',
    scope: 'lab:write',
    params: [
      ['p_instrument_id', 'uuid', 1],
      ['p_driver', 'text', 1],
      ['p_worklist_format', 'text', 0],
      ['p_labware', 'json', 0],
    ],
    result: 'row:instrument_robot_settings',
  },
  clear_instrument_robot: {
    summary: 'Stop treating an instrument as a robot',
    description:
      'Removes the robot settings. Jobs already sent stay on record. Needs permission to manage instruments.',
    scope: 'lab:write',
    params: [['p_instrument_id', 'uuid', 1]],
    result: 'void',
  },
  queue_instrument_job: {
    summary: 'Send a worklist to a robot',
    description:
      'Queues a planned worklist for a robot. The folder agent puts it on the robot and the job waits, staged, until a person starts it. A worklist has one open job at a time. Sends `instrument.job.queued`.',
    scope: 'lab:write',
    params: [
      ['p_instrument_id', 'uuid', 1],
      ['p_worklist_id', 'uuid', 1],
      ['p_note', 'text', 0],
    ],
    result: 'row:instrument_jobs',
  },
  start_instrument_job: {
    summary: 'Start a staged robot job',
    description:
      'A person starts the job once it is on the robot and the deck is ready. Only a staged job can be started; a script or an assistant cannot start one for you, because the person starting it is at the robot. Sends `instrument.job.started`.',
    scope: 'lab:write',
    params: [['p_job_id', 'uuid', 1]],
    result: 'row:instrument_jobs',
  },
  cancel_instrument_job: {
    summary: 'Stop a robot job',
    description:
      'Cancels a queued or staged job at once, and asks the agent to stop a running one. Sends `instrument.job.cancelled` when it has stopped.',
    scope: 'lab:write',
    params: [['p_job_id', 'uuid', 1]],
    result: 'row:instrument_jobs',
  },
  set_scheduler_settings: {
    summary: 'Set the lab’s working hours',
    description:
      'The working day the scheduler places hands-on work in: time zone, start and end (minutes after midnight) and the days worked. Needs access to manage General settings.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_timezone', 'text', 1],
      ['p_work_start_minute', 'int', 1],
      ['p_work_end_minute', 'int', 1],
      ['p_work_days', 'int[]', 1],
    ],
    result: 'row:scheduler_settings',
  },
  set_part_plan: {
    summary: 'Say how long a part takes and what it needs',
    description:
      'Sets a part’s hands-on time, the wait after it, and the instruments it needs (each with minutes). The list replaces the part’s earlier one. The scheduler plans from this.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_hands_on_minutes', 'int', 0],
      ['p_wait_after_minutes', 'int', 0],
      ['p_needs', 'json', 0],
    ],
    result: 'row:part_plans',
  },
  request_schedule_proposal: {
    summary: 'Ask for a proposed schedule for an experiment',
    description:
      'Asks the planner to lay the experiment’s parts out on instruments and people, respecting working hours, absences, each instrument’s booking rules and the waits between parts. Returns a proposal in `requested`; read it again until it is `proposed` (or `failed`). Nothing is booked. Sends `schedule.proposed` when the plan is ready.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_reason', 'text', 0],
      ['p_slipped_part_id', 'uuid', 0],
    ],
    result: 'row:schedule_proposals',
  },
  accept_schedule_proposal: {
    summary: 'Accept a proposed schedule and book it',
    description:
      'Books each instrument slot (as the person accepting), replaces the bookings of an earlier accepted plan and moves the parts to the days planned. A slot that cannot be booked is listed in `skipped` with the reason, not hidden. Returns `{ proposalId, booked, skipped }`. Sends `schedule.accepted`.',
    scope: 'lab:write',
    params: [['p_proposal_id', 'uuid', 1]],
    result: 'json',
  },
  dismiss_schedule_proposal: {
    summary: 'Dismiss a proposed schedule',
    description: 'Leaves the schedule as it is. Sends `schedule.dismissed`.',
    scope: 'lab:write',
    params: [['p_proposal_id', 'uuid', 1]],
    result: 'row:schedule_proposals',
  },
  slip_experiment_part: {
    summary: 'A part ran late: re-plan the rest',
    description:
      'Moves the part and the parts after it later by a number of days and asks for a new proposal; nothing is booked until it is accepted.',
    scope: 'lab:write',
    params: [
      ['p_part_id', 'uuid', 1],
      ['p_days', 'int', 1],
    ],
    result: 'row:schedule_proposals',
  },
  dataset_version_rows_json: {
    summary: 'Read a dataset version as rows',
    description:
      'The columns and up to `p_limit` rows (default 50000) of one dataset version, as JSON: `{ versionId, datasetId, label, columns, rowCount, truncated, rows }`. Code cells read their inputs this way.',
    scope: 'lab:read',
    params: [
      ['p_version_id', 'uuid', 1],
      ['p_limit', 'int', 0],
    ],
    result: 'json',
  },
  create_experiment_plan: {
    summary: 'Save a plan drawn up from a goal',
    description:
      'Checks every id in the plan (protocol, instruments, samples) and the plate and worklist, then saves it as a plan waiting for a person. Nothing is created until `apply_experiment_plan`. Needs permission to create records and access to the project. Returns the plan.',
    scope: 'lab:write',
    params: [
      ['p_project_id', 'uuid', 1],
      ['p_goal', 'text', 1],
      ['p_plan', 'json', 1],
      ['p_source', 'text', 0],
    ],
    result: 'row:experiment_plans',
  },
  apply_experiment_plan: {
    summary: 'Create everything a plan describes in one step',
    description:
      'Creates the experiment (from the protocol when the plan names one) with its parts, the plate and worklist, the sample reservations and, when the plan asks for it, a schedule proposal. All of it happens together or none of it does. Needs permission to create records. Returns `{ recordId, identifier, plateRunId, worklistId, proposalId, parts, reservations }`.',
    scope: 'lab:write',
    params: [['p_plan_id', 'uuid', 1]],
    result: 'json',
  },
  dismiss_experiment_plan: {
    summary: 'Set a plan aside',
    description:
      'Marks a plan waiting for a person as dismissed. Nothing was created, so nothing is undone. Returns the plan.',
    scope: 'lab:write',
    params: [['p_plan_id', 'uuid', 1]],
    result: 'row:experiment_plans',
  },
  set_model_capability: {
    summary: 'Switch a feature on or off for a record model',
    description:
      'Turns a feature of a record model on or off; `p_capability` is the feature key, such as `campaigns`, whose records can then be set up as campaigns. `p_settings` replaces the feature’s settings when given. Needs permission to edit models. Returns whether the feature is now on.',
    scope: 'lab:write',
    params: [
      ['p_model_key', 'text', 1],
      ['p_capability', 'text', 1],
      ['p_enabled', 'bool', 1],
      ['p_settings', 'json', 0],
    ],
    result: 'bool',
  },
  configure_campaign: {
    summary: 'Set up or change a campaign’s design, budget and plate',
    description:
      'Saves the factors, objectives, budget and plate layout for a record of a campaign model. The factors and objectives are fixed once a round has been asked for; the budget, layout and the rest can still change. Returns the campaign.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_factors', 'json', 1],
      ['p_objectives', 'json', 1],
      ['p_batch_size', 'int', 0],
      ['p_max_rounds', 'int', 0],
      ['p_max_runs', 'int', 0],
      ['p_engine', 'text', 0],
      ['p_layout', 'json', 0],
      ['p_template_record_id', 'uuid', 0],
      ['p_auto_propose', 'bool', 0],
      ['p_seed', 'int', 0],
    ],
    result: 'row:campaigns',
  },
  start_campaign: {
    summary: 'Start or resume a campaign',
    description:
      'Makes the campaign active and asks for its first round, or for the next one when it is resumed. The optimiser works the round out in the background; a person approves it. Returns the campaign.',
    scope: 'lab:write',
    params: [['p_record_id', 'uuid', 1]],
    result: 'row:campaigns',
  },
  set_campaign_status: {
    summary: 'Pause or finish a campaign',
    description:
      '`p_status` is `paused` or `finished`. Finishing sets aside a round that is waiting for a person; results already in are kept. Returns the campaign.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_status', 'text', 1],
    ],
    result: 'row:campaigns',
  },
  request_campaign_round: {
    summary: 'Ask for the next round',
    description:
      'Queues the next round when none is waiting and budget is left. The optimiser works it out in the background and the round waits for a person to approve it. Returns the round.',
    scope: 'lab:write',
    params: [['p_record_id', 'uuid', 1]],
    result: 'row:campaign_rounds',
  },
  approve_campaign_round: {
    summary: 'Approve a proposed round',
    description:
      'Makes the round’s experiment (joined to the campaign’s series), its plate and, when the campaign has a liquid handler, its worklist. Only a person decides this. Returns the round.',
    scope: 'lab:write',
    params: [['p_round_id', 'uuid', 1]],
    result: 'row:campaign_rounds',
  },
  reject_campaign_round: {
    summary: 'Reject a proposed round',
    description:
      'Sets the round’s conditions aside so the optimiser can propose another. A rejected round does not use up the budget. Returns the round.',
    scope: 'lab:write',
    params: [
      ['p_round_id', 'uuid', 1],
      ['p_reason', 'text', 0],
    ],
    result: 'row:campaign_rounds',
  },
  record_campaign_results: {
    summary: 'Enter the results of a round',
    description:
      'Takes each condition’s result for each objective. The round is complete when every condition has every result, and the next round is asked for when the campaign does that automatically. Returns the round.',
    scope: 'lab:write',
    params: [
      ['p_round_id', 'uuid', 1],
      ['p_results', 'json', 1],
    ],
    result: 'row:campaign_rounds',
  },
  pull_campaign_round_results: {
    summary: 'Read an objective from the round’s plate',
    description:
      'Fills one objective for each condition from the readings on the round’s plate: the mean of the condition’s wells. Returns the round.',
    scope: 'lab:write',
    params: [
      ['p_round_id', 'uuid', 1],
      ['p_objective_key', 'text', 1],
    ],
    result: 'row:campaign_rounds',
  },
}
