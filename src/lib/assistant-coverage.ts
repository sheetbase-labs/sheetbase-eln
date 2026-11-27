/**
 * Which assistant tool does what the app's write actions do (Gareth,
 * 2026-11-26): anything a person can change in the app, the assistant can
 * propose as a confirm card.
 *
 * `assistant-coverage.test.ts` takes every write the API exposes (an RPC with
 * a write scope, or an operation that is a write) and requires it to have one
 * of four things:
 *
 * - an assistant tool declared on its operation (`assistant: { tool }`);
 * - a line in `ASSISTANT_COVERED` naming the hand-written card tool that runs it;
 * - a line in `ASSISTANT_EXEMPT` with the reason no person would ask for it;
 * - a line in `ASSISTANT_GAPS` naming the area it still needs a card in.
 *
 * Nothing new goes in `ASSISTANT_GAPS`: a new write ships with its card in
 * the same PR. The list only gets shorter. The test fails when a gap is
 * closed and its line is left behind.
 */

/** A write the assistant already proposes, and the card tool that does it. */
export const ASSISTANT_COVERED = {
  replace_record_model_version_definition: 'sheetbase.model_field.edit',
  add_records_to_legal_hold: 'sheetbase.legal_hold.add_records',
  amend_experiment_part: 'sheetbase.part.amend',
  create_qc_series: 'sheetbase.qc.create_series',
  create_record: 'sheetbase.experiment.start_from_template',
  create_record_with_blocks: 'sheetbase.experiment.start_from_template',
  delete_block: 'sheetbase.block.delete',
  delete_experiment_part: 'sheetbase.part.delete',
  delete_qc_series: 'sheetbase.qc.delete_series',
  discard_record_model_version: 'sheetbase.model_version.discard',
  dissolve_experiment_series: 'sheetbase.series.dissolve',
  import_protocol: 'sheetbase.protocol.import',
  insert_block: 'sheetbase.notebook_block.insert',
  migrate_open_experiments_to_model_version:
    'sheetbase.model_version.migrate_open',
  move_block: 'sheetbase.block.move',
  move_experiment_part: 'sheetbase.part.move',
  move_series_member: 'sheetbase.series.move_member',
  record_qc_point: 'sheetbase.qc.add_point',
  reparent_record_model: 'sheetbase.model.reparent',
  set_block_part: 'sheetbase.part.set_block',
  set_experiment_fields: 'sheetbase.experiment.set_fields',
  set_link_part: 'sheetbase.part.set_link',
  set_part_gate: 'sheetbase.part.set_gate',
  set_part_plan: 'sheetbase.part.set_plan',
  set_parts_sign_off: 'sheetbase.parts.set_sign_off',
  set_record_favourite: 'sheetbase.record.favourite',
  set_series_member_day: 'sheetbase.series.set_member_day',
  slip_experiment_part: 'sheetbase.part.slip',
  split_record_into_parts: 'sheetbase.part.split',
  start_experiment_series: 'sheetbase.series.start',
  transition_record_status: 'sheetbase.record.transition',
  update_block_payload: 'sheetbase.notebook_block.update',
  update_qc_series: 'sheetbase.qc.update_series',
  upgrade_record_model_record: 'sheetbase.model_version.upgrade_record',
  register_samples: 'sheetbase.sample.log',
  remove_sample_from_position: 'sheetbase.storage.place',
  withdraw_sample: 'sheetbase.sample.withdraw',
  record_sample_label_print: 'sheetbase.sample.label_printed',
  match_sample_locations: 'sheetbase.sample.match_locations',
  set_position_status: 'sheetbase.storage.position_status',
  record_stocktake_scan: 'sheetbase.stocktake.scan',
  resolve_stocktake_item: 'sheetbase.stocktake.resolve',
  cancel_stocktake: 'sheetbase.stocktake.cancel',
  mark_shipment_in_transit: 'sheetbase.shipment.dispatch',
  update_shipment: 'sheetbase.shipment.update',
  set_material_safety: 'sheetbase.material.safety',
  save_sample_workflow: 'sheetbase.sample_workflow.save',
  set_sample_workflow_status: 'sheetbase.sample_workflow.set_status',
  set_sample_release_rules: 'sheetbase.release_rules.set',
  add_step_plate_run: 'sheetbase.plate.add_to_experiment',
  link_plate_run: 'sheetbase.plate.add_to_experiment',
  save_plate_run_analysis: 'sheetbase.plate.analyse',
  archive_plate_run: 'sheetbase.plate_run.archive',
  create_plate_run: 'sheetbase.plate_run.create',
  update_plate_run: 'sheetbase.plate_run.update',
  create_plate_design: 'sheetbase.plate_design.create',
  save_plate_design: 'sheetbase.plate_design.fill',
  save_plate_layout_template: 'sheetbase.plate_layout.save',
  track_plate_assay_qc: 'sheetbase.plate_design.track_qc',
  cancel_plate_worklist: 'sheetbase.worklist.cancel',
  complete_plate_worklist: 'sheetbase.worklist.complete',
  create_notebook_template_version: 'sheetbase.template.update',
  instantiate_notebook_template_version: 'sheetbase.template.use',
  apply_notebook_template_upgrade: 'sheetbase.template.upgrade_notebook',
  save_scheduled_report: 'sheetbase.report.schedule_save',
  set_scheduled_report_active: 'sheetbase.report.schedule_active',
  delete_scheduled_report: 'sheetbase.report.schedule_delete',
  send_scheduled_report_now: 'sheetbase.report.schedule_send',
  create_supplier_model: 'sheetbase.model.supplier_create',
  set_model_supplier_list: 'sheetbase.model.supplier_list_set',
  set_field_plugin_type: 'sheetbase.model_field.plugin_type',
  remove_registry_parent: 'sheetbase.registry.remove_parent',
  adopt_group_roles: 'sheetbase.group_role.adopt',
  create_comment: 'sheetbase.comment.add',
  delete_publication_target: 'sheetbase.publication.delete_target',
  disable_extension: 'sheetbase.plugin.switch',
  discard_publication: 'sheetbase.publication.discard',
  hand_over_member_work: 'sheetbase.handover.start',
  link_ontology_term: 'sheetbase.ontology.link',
  post_client_portal_message: 'sheetbase.client.post_message',
  reissue_invitation: 'sheetbase.invitation.reissue',
  remove_idp_group_mapping: 'sheetbase.group_role.remove',
  remove_project_access_rule: 'sheetbase.project.remove_access_rule',
  remove_project_member: 'sheetbase.project.remove_member',
  rename_client: 'sheetbase.client.rename',
  reopen_comment_thread: 'sheetbase.comment.resolve',
  request_lake_refresh: 'sheetbase.open_tables.refresh',
  request_project_edit_access: 'sheetbase.project.request_edit_access',
  request_signature_timestamp: 'sheetbase.timestamps.retry',
  retry_publication: 'sheetbase.publication.retry',
  revoke_lake_credential: 'sheetbase.open_tables.revoke_login',
  revoke_user_session: 'sheetbase.session.revoke',
  save_publication_target: 'sheetbase.publication.save_target',
  set_client_archived: 'sheetbase.client.set_archived',
  set_extension_point_enabled: 'sheetbase.plugin.set_point',
  set_idp_group_mapping: 'sheetbase.group_role.set',
  set_lake_settings: 'sheetbase.open_tables.set',
  set_member_username: 'sheetbase.member.set_username',
  set_ontology_settings: 'sheetbase.ontology.set_lookup',
  set_project_access_defaults: 'sheetbase.project.set_access_defaults',
  set_project_access_rule: 'sheetbase.project.set_access_rule',
  set_project_member: 'sheetbase.project.set_member',
  set_scheduler_settings: 'sheetbase.scheduler.set_hours',
  set_settings_access: 'sheetbase.settings_access.set',
  unfollow_project: 'sheetbase.follow',
  unlink_ontology_term: 'sheetbase.ontology.unlink',
  update_project_settings: 'sheetbase.project.set_review_rules',
  update_workspace_ai_feature_flags: 'sheetbase.ai_features.set',
  update_workspace_ai_settings: 'sheetbase.workspace.set_ai',
  update_workspace_data_access_roles: 'sheetbase.workspace.set_data_access',
  update_workspace_id_prefixes: 'sheetbase.workspace.set_id_prefixes',
  update_workspace_publication_policy: 'sheetbase.workspace.set_publishing',
  update_workspace_settings: 'sheetbase.workspace.set_rules',
  record_reagent_movement: 'sheetbase.material.stock',
  edit_sample: 'sheetbase.sample.edit',
  restore_sample: 'sheetbase.sample.restore',
  update_storage_location: 'sheetbase.storage.update_location',
  set_storage_location_archived: 'sheetbase.storage.archive_location',
  archive_dataset: 'sheetbase.dataset.archive',
  restore_dataset: 'sheetbase.dataset.restore',
  archive_sheet_instance: 'sheetbase.sheet.archive',
  restore_sheet_instance: 'sheetbase.sheet.restore',
  duplicate_sheet_instance: 'sheetbase.sheet.duplicate',
  materialize_sheet_instance: 'sheetbase.sheet.materialize',
  apply_sheet_instance_composition_adoption:
    'sheetbase.sheet.adopt_layout_version',
  accept_schedule_proposal: 'sheetbase.schedule.accept',
  acknowledge_qc_point: 'sheetbase.qc.acknowledge',
  add_compound_lot: 'sheetbase.compound.add_lot',
  add_contract_rule: 'sheetbase.contract.add_rule',
  add_registry_parent: 'sheetbase.registry.add',
  add_series_member: 'sheetbase.series.add_member',
  add_step_result: 'sheetbase.step.result',
  advance_sample_workflow: 'sheetbase.sample.advance',
  aliquot_sample: 'sheetbase.sample.split',
  archive_sample: 'sheetbase.sample.archive',
  assign_record: 'sheetbase.record.assign',
  cancel_booking: 'sheetbase.booking.cancel',
  cancel_member_absence: 'sheetbase.absence.cancel',
  cancel_reagent_order: 'sheetbase.reagent.update',
  cancel_sample_reservation: 'sheetbase.sample.reservation_cancel',
  cancel_shipment: 'sheetbase.shipment.cancel',
  check_dataset_contract: 'sheetbase.contract.check',
  complete_stocktake: 'sheetbase.stocktake.complete',
  consume_sample: 'sheetbase.sample.use',
  create_booking: 'sheetbase.booking.create',
  create_experiment_part: 'sheetbase.part.add',
  create_instrument: 'sheetbase.instrument.add',
  create_instrument_run: 'sheetbase.run.create',
  create_legal_hold: 'sheetbase.legal_hold.create',
  create_planned_experiment: 'sheetbase.planner.plan_experiment',
  create_plate_worklist: 'sheetbase.worklist.create',
  create_project: 'sheetbase.project.create',
  create_registry_entry: 'sheetbase.registry.add',
  create_sample_reservation: 'sheetbase.sample.reserve',
  create_shipment: 'sheetbase.shipment.send',
  create_storage_box: 'sheetbase.storage.add_location',
  create_storage_location: 'sheetbase.storage.add_location',
  dispose_sample: 'sheetbase.sample.dispose',
  edit_booking: 'sheetbase.booking.move',
  end_recurring_schedule: 'sheetbase.recurring.end',
  end_step_timer: 'sheetbase.timer.end',
  enrol_sample_in_workflow: 'sheetbase.workflow.enrol',
  follow_project: 'sheetbase.follow',
  instantiate_template: 'sheetbase.experiment.start_from_template',
  leave_sample_workflow: 'sheetbase.workflow.leave',
  log_instrument_service: 'sheetbase.instrument.log_service',
  mark_notifications_read: 'sheetbase.inbox.mark_read',
  mark_reagent_ordered: 'sheetbase.reagent.mark_ordered',
  move_sample_to_position: 'sheetbase.sample.move',
  override_gate: 'sheetbase.gate.go_on',
  pin_protocol_reference: 'sheetbase.pin',
  pool_samples: 'sheetbase.sample.pool',
  prepare_solution: 'sheetbase.solution.prepare',
  quarantine_sample: 'sheetbase.sample.quarantine',
  receive_reagent_order: 'sheetbase.reagent.receive',
  receive_sample: 'sheetbase.sample.receive',
  receive_shipment: 'sheetbase.shipment.receive',
  record_instrument_calibration: 'sheetbase.instrument.calibrate',
  record_sample_measurement: 'sheetbase.sample.log',
  record_storage_readings: 'sheetbase.storage.log_reading',
  register_replacement_lot: 'sheetbase.material.add_lot',
  remove_series_member: 'sheetbase.series.remove_member',
  request_part_signoff: 'sheetbase.part.request_signoff',
  request_publication: 'sheetbase.publication.request',
  request_reagent_order: 'sheetbase.reagent.order',
  request_pipeline_reproduction: 'sheetbase.pipeline.reproduce',
  request_repeat: 'sheetbase.booking.repeat',
  revoke_scim_token: 'sheetbase.scim_token.revoke',
  run_contract_check: 'sheetbase.contract.check',
  run_pipeline: 'sheetbase.pipeline.run',
  save_search: 'sheetbase.search.save',
  set_field_spec_limits: 'sheetbase.spec_limits.set',
  set_instrument_booking_rules: 'sheetbase.booking_rules.set',
  set_instrument_out_of_service: 'sheetbase.instrument.out_of_service',
  set_instrument_qualification: 'sheetbase.instrument.qualify',
  set_instrument_rate: 'sheetbase.instrument.set_rate',
  set_instrument_retired: 'sheetbase.instrument.retire',
  set_lab_watcher: 'sheetbase.watcher.set',
  set_member_absence: 'sheetbase.absence.set',
  set_part_done: 'sheetbase.part.complete',
  set_qc_baseline: 'sheetbase.qc.set_baseline',
  set_reagent_order_price: 'sheetbase.reagent.mark_ordered',
  set_recurring_schedule_paused: 'sheetbase.recurring.pause',
  set_step_done: 'sheetbase.step.complete',
  set_timestamp_settings: 'sheetbase.timestamps.set',
  set_watcher_finding_status: 'sheetbase.watcher.finding',
  snapshot_dataset: 'sheetbase.dataset.keep_snapshot',
  start_step_timer: 'sheetbase.timer.start',
  start_stocktake: 'sheetbase.stocktake.start',
  submit_request: 'sheetbase.request.send',
  transfer_sample: 'sheetbase.sample.move',
  update_experiment_part: 'sheetbase.part.update',
  update_record_custom_fields: 'sheetbase.record.custom_fields.update',
  update_sheet_instance: 'sheetbase.sheet_instance.update',
  create_dataset_schema_subtype: 'sheetbase.measurement_table.create',
  create_next_dataset_schema_version: 'sheetbase.measurement_table.edit',
  cancel_instrument_job: 'sheetbase.instrument.cancel_job',
  clear_instrument_robot: 'sheetbase.instrument.clear_robot',
  complete_instrument_run: 'sheetbase.run.update',
  create_calendar_resource: 'sheetbase.resource.create',
  create_converter_parser: 'sheetbase.parser.create_converter',
  create_parser_version: 'sheetbase.parser.create_version',
  create_pipeline_definition: 'sheetbase.pipeline_definition.draft',
  create_pipeline_definition_version:
    'sheetbase.pipeline_definition.update_draft',
  create_recurring_schedule: 'sheetbase.recurring.create',
  create_webhook_parser: 'sheetbase.parser.create_webhook',
  delete_saved_search: 'sheetbase.search.delete',
  delete_webhook_subscription: 'sheetbase.webhook.delete',
  dismiss_instrument_qualification_request:
    'sheetbase.instrument.dismiss_qualification_request',
  dismiss_schedule_proposal: 'sheetbase.schedule.dismiss',
  duplicate_booking: 'sheetbase.booking.duplicate',
  fail_instrument_run: 'sheetbase.run.update',
  queue_instrument_job: 'sheetbase.instrument.queue_job',
  register_connector: 'sheetbase.connector.register',
  remind_pipeline_run: 'sheetbase.pipeline.remind_run',
  remove_instrument_feed: 'sheetbase.instrument.remove_feed',
  replay_webhook_deliveries: 'sheetbase.webhook.replay_deliveries',
  replay_webhook_delivery: 'sheetbase.webhook.replay_delivery',
  request_instrument_qualification:
    'sheetbase.instrument.request_qualification',
  request_parser_update: 'sheetbase.parser.request_update',
  request_schedule_proposal: 'sheetbase.schedule.request',
  retire_pipeline_definition_version: 'sheetbase.pipeline.retire_version',
  revoke_instrument_qualification: 'sheetbase.instrument.qualify',
  run_lab_watcher: 'sheetbase.watcher.run',
  save_parser_mapping: 'sheetbase.parser.save_mapping',
  set_event_stream_retention: 'sheetbase.events.set_retention',
  set_instrument_feed_limits: 'sheetbase.instrument.set_feed_limits',
  set_instrument_gate_mode: 'sheetbase.instrument.set_gate_mode',
  set_instrument_intake_method: 'sheetbase.instrument.set_intake_method',
  set_instrument_robot: 'sheetbase.instrument.set_robot',
  start_instrument_job: 'sheetbase.instrument.start_job',
  start_instrument_run: 'sheetbase.run.update',
  update_connector: 'sheetbase.connector.update',
  update_instrument_connection: 'sheetbase.instrument.set_connection',
  update_pipeline_definition_version_draft:
    'sheetbase.pipeline_definition.update_draft',
  update_saved_search: 'sheetbase.search.update',
  update_webhook_subscription: 'sheetbase.webhook.update',
} as const satisfies Readonly<Record<string, string>>

/** A write no person asks the assistant for, with why. */
export const ASSISTANT_EXEMPT = {
  link_run_record:
    'Called by an instrument, connector or file watcher as a run’s files arrive, not by a person; the assistant can read the run and its linked records with its own tools.',
  record_qc_check:
    'Called by an instrument, connector or file watcher as a run finishes, not by a person; the assistant can read the check results of a run with its own tools.',
  save_trail_evidence:
    'Saves the pages a person actually clicked through as evidence; the trail only exists in their own browser session, so the assistant has nothing to save.',
  add_dataset_import_file:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  advance_agent_workflow:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  append_connector_run_log:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  approve_approval_request:
    'A decision on someone else’s work is an attestation: app-only by the integration rules.',
  approve_review:
    'A decision on someone else’s work is an attestation: app-only by the integration rules.',
  attach_instrument_raw_file:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  begin_ai_change_set:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  cancel_agent_workflow:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  complete_connector_run:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  complete_workspace_setup:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  create_agent_workflow:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  create_calendar_feed:
    'Returns a one-time secret that must reach a person, so it is app-only by the integration rules.',
  create_webhook_subscription:
    'Returns a one-time secret that must reach a person, so it is app-only by the integration rules.',
  delete_assistant_conversation:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  fail_connector_run:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  finish_agent_action:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  finish_ai_change_set:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  ingest_observation:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  link_intake_dataset:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  mark_work_items_seen:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  materialise_recurring_schedule:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  propose_agent_operation:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  recompute_dataset_system_flags:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  record_instrument_readings:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  record_instrument_run_document:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  record_intake_failure:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  record_pipeline_version_push:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  record_recent_view:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  record_run_sample_results:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  reject_review:
    'A decision on someone else’s work is an attestation: app-only by the integration rules.',
  rename_assistant_conversation:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  report_agent_workflow_usage:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  request_agent_action:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  request_changes_on_review:
    'A decision on someone else’s work is an attestation: app-only by the integration rules.',
  resolve_intake_failures_for_file:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  return_approval_request:
    'A decision on someone else’s work is an attestation: app-only by the integration rules.',
  rotate_webhook_secret:
    'Returns a one-time secret that must reach a person, so it is app-only by the integration rules.',
  save_assistant_conversation:
    'The assistant and agents own these themselves: their own chat history and the agent action path every card already goes through.',
  save_notification_preference:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  set_notification_timing:
    'The app does this for itself in the background (bookkeeping, a nightly job or a screen preference), so there is nothing for a person to ask the assistant to do.',
  create_plate_snapshot:
    'Written by a plate reader or its connector with the reader’s own values as a run finishes, not typed by a person; the assistant can read the snapshot.',
  start_connector_run:
    'Called by an instrument, connector or file watcher as data arrives, not by a person; the assistant can read the result and fix a failed intake with its own tools.',
  import_scientific_rows:
    'Part of the older scientific-table subsystem that measurement tables replace, which the database no longer grants to anyone; people and the assistant import rows into datasets with the import card.',
  insert_sheet_block:
    'A legacy scientific-sheet block call that the database refuses for everyone but the migrator role; people add a sheet to a notebook with the add-a-sheet card.',
  create_and_link_sheet_record:
    'Writes a new record into a cell of an open sheet grid, addressed by the grid’s own row and column identity; the assistant makes the record with the record card and fills the cell with the sheet data card.',
  commit_sheet_record_batch:
    'Writes a batch of records into cells of an open sheet grid, addressed by the grid’s own row and column identity; the assistant makes records with the record card and fills the cells with the sheet data card.',
  validate_dataset_row_batch: 'A dry-run check that writes nothing.',
  validate_sheet_record_batch: 'A dry-run check that writes nothing.',
} as const satisfies Readonly<Record<string, string>>

/** Writes still waiting for a card, by area. Only ever shrinks. */
export const ASSISTANT_GAPS = {
  revoke_calendar_feed: 'other',
} as const satisfies Readonly<Record<string, string>>
