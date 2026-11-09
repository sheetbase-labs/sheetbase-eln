import { featureNotExposed } from '../features/collect'
import { PENDING_EXPOSURE } from './integration-pending'

/**
 * Database objects that are deliberately NOT on the external API.
 *
 * Every table and function in the `api` schema (the whole app, from the
 * first migration on) must be reachable by API tokens (and so by MCP and the
 * docs), or be listed here with the reason it is not. The guard test
 * (`integration-coverage.test.ts`) enforces that, so a new feature cannot
 * ship as a screen only.
 *
 * Reasons that hold up: the object is a person's own device or display
 * setting; it shows a one-time secret; it is an attestation a person makes in
 * the app (signing, approving or deciding, releasing a sample, "I've read this
 * protocol"); or it is plumbing the database runs for itself (an inner step
 * of a public call, a trigger, an index). Schema authoring is not a reason:
 * record types, fields, rules, sheet definitions, templates and measurement
 * tables are open behind `schema:write`, and publishing a version behind
 * `schema:publish`. "Not got round to it" is not a reason.
 *
 * Plumbing the database runs for itself (who is signed in, whether they hold a
 * capability) is not a feature: group it in `NOT_EXPOSED_PATTERNS` with one
 * reason instead of listing every name.
 */

/** Groups of plumbing that no caller needs. Each pattern must match something. */
export const NOT_EXPOSED_PATTERNS: readonly {
  readonly pattern: RegExp
  readonly reason: string
}[] = [
  {
    pattern:
      /^(current_(user|workspace|credential|client)_id|claim_probe|has_write_actor|has_capability|has_schema_capability|require_capability|is_workspace_(member|writer|client))$/,
    reason:
      'Who is signed in and whether they may do something: the database asks these on every call, so a caller never needs to.',
  },
  {
    pattern:
      /^(sign_revision|certify_signature|practice_signature|request_signature_identity_verification|request_signature_witness|signature_witness_candidates|verify_signature_identity|self_verify_signature_identity|withdraw_signature_certification|workspace_signature_certifications|update_signature_statement|signatures|signature_witness_requests|user_signature_certifications|approve_review|reject_review|request_changes_on_review|withdraw_review|review_decisions|approve_approval_request|return_approval_request|return_revision_with_comments|approve_parser_version|acknowledge_protocol_version|release_sample|decide_agent_operation|execute_agent_operation|sign_agent_operation|execute_hard_delete)$/,
    reason:
      'A person attests, approves, releases or decides in the app (signing with a fresh password check, reviewing, approving, releasing a sample, confirming a hard delete). Others can read the results and ask for them, but not do them.',
  },
  {
    pattern:
      /^(create_sql_login|rotate_sql_login|agent_admin_credentials|api_credential_status)$/,
    reason:
      'Hands out or manages a login or token secret, shown once to the person who makes it; secrets are never taken or returned over the API.',
  },
  {
    pattern:
      /^(set_user_appearance|set_user_preference|set_user_profile|my_profile|my_onboarding_state|my_join_offer|join_my_domain_workspace|set_active_workspace|save_team_layout|delete_team_layout|touch_saved_search|user_preferences|workspace_layouts|saved_search_uses)$/,
    reason:
      'A person’s own settings, layout, bell list or reading position, kept for their own account in the app.',
  },
  {
    pattern:
      /^(assert_extension_capability|assert_record_batch_capabilities|assert_record_link_same_workspace|has_data_access|has_settings_access|is_model_field_admin|is_sheet_definition_admin|storage_member_using|workspace_member_label|collaboration_object_state|record_id_counters|workspace_change_seq|change_events|record_file_text|record_webhook_delivery_result|establish_connector_run_request|chart_box_stats|chart_dim_label|chart_filter_matches|chart_quantile|chart_spec_referenced_field_ids|chart_to_number|validate_chart_spec_maturity|validate_notebook_sheet_block|validate_pipeline_event_spec|validate_pipeline_schedule_spec|pipeline_cron_field|pipeline_cron_next|discover_object_dependencies(_core\d+)?)$/,
    reason:
      'Checks, helpers and counters the database or server run for themselves (permission and capability checks, chart maths, spec validation, cron parsing, dependency discovery, the change feed that events are made from); not a feature a caller uses.',
  },
  {
    pattern:
      /^(append_pipeline_run_log|complete_pipeline_run|fail_pipeline_run|get_pipeline_run_job|record_pipeline_run_output|update_run_progress)$/,
    reason:
      'Written by the pipeline worker while it runs a job, so a run always carries what really ran; people and scripts start, cancel and read runs.',
  },
  {
    pattern:
      /^(create_sheet_instance_core0311|create_sheet_instance_from_definition_core0311|update_sheet_instance_core0311|query_sheet_instance_rows_core036|query_sheet_instance_rows_core037|submit_record_revision_core067)$/,
    reason:
      'Older numbered versions kept for the app’s upgrade path; the current functions without the number are the ones callers use.',
  },
]

/** The reason an object is not exposed, or undefined when it has none. */
export function notExposedReason(name: string): string | undefined {
  const own: Readonly<Record<string, string | undefined>> = NOT_EXPOSED
  const pending: Readonly<Record<string, string | undefined>> = PENDING_EXPOSURE
  return (
    own[name] ??
    pending[name] ??
    NOT_EXPOSED_PATTERNS.find((group) => group.pattern.test(name))?.reason
  )
}

export const NOT_EXPOSED: Readonly<Record<string, string>> = {
  // Each feature folder's own (`notExposed` in `src/features/<name>/feature.ts`).
  ...featureNotExposed(),
  // Plate formats (migration 0104): existing functions rewritten to accept the
  // 6 to 1536-well formats. Nothing new is added to them.
  validate_scientific_block:
    'Database trigger that checks notebook blocks as they are saved.',
  pipeline_config_errors:
    'Checks a pipeline configuration as it is saved; rewritten only to accept plugin steps. Saving a version through the pipeline API runs it.',
  can_run_validation:
    'Tells the Validation page whether this person may start a run; starting one is for a signed-in person in the app, and finished runs are on validation_runs.',
  // Robots, the scheduler and code cells.
  schedule_proposal_bookings:
    'Which bookings an accepted proposal made, so a later plan can replace them; the bookings themselves are on the calendar and the proposal on schedule_proposals.',
  agent_instrument_jobs:
    'The folder agent next to a robot asks for its open jobs here, through POST /api/connectors/jobs with its own token; people read jobs on instrument_jobs.',
  agent_report_instrument_job:
    'The folder agent reports a job moving on and what the robot did, through POST /api/connectors/jobs; people and scripts use queue, start and cancel.',
  record_code_cell_run:
    'Written by the server when a code cell has run in the app, so a run always carries what really ran; the runs are on code_cell_runs.',
  // Plugin rules for registry models.
  set_registry_sameness_value:
    'Stores the key a plugin worked out for an entry; the app writes it right after the plugin ran, so a caller cannot claim a key the plugin did not give. Read on registry_sameness_values.',
  // Part sign-off: signing is an attestation a person makes in the app with a
  // fresh password, so tokens, MCP and pipelines can ask for it but not do it.
  sign_experiment_part:
    'Signing or countersigning a part is a person attesting in the app with a fresh password check; others can read it (record_part_signoffs) and ask for it (request_part_signoff).',
  // Provenance (lineage events and reproducing runs).
  pipeline_reproduction_requests:
    'The queue behind the Reproduce run pipeline action; the finished reproductions are on pipeline_reproductions.',
  request_pipeline_reproduction:
    'Queues a reproduction for the app to run; tokens start one with POST /api/pipelines/reproduce and the pipeline action calls this for signed-in people.',
  record_pipeline_reproduction:
    'Written by the server when a reproduction finishes; not for callers.',
  set_lineage_target_secret:
    'Stores the sealed header value of a lineage endpoint; secrets are never taken or returned over the API.',
  record_lineage_test:
    'Written by the server after a test send to a lineage endpoint; the result shows on lineage_targets.',
  create_lake_credential:
    'Hands out a table login secret, shown once to the person who makes it.',
  publish_publication:
    'Makes a repository record public with a DOI, which cannot be undone; a person confirms it in the app after seeing the draft.',
  create_scim_token:
    'Hands out a directory sync secret, shown once to the person who makes it.',
  // Plugin hooks on save and upload.
  sign_off_plugin_step:
    'Pressing a plugin sign-off step is a person approving in the app, and the database checks their role and that they did not make the change; others can read the steps and who pressed them (plugin_flags, plugin_flag_sign_offs).',
  plugin_search_entries:
    'Entries a plugin hook put in its own search index, with their number vectors; read results through search_plugin_index, which applies the same access rules.',
  // Search by meaning.
  search_embeddings:
    'Derived number vectors kept for ranking; read results through semantic_search and similar_work, which apply the same access rules.',
  set_semantic_search_settings:
    'Turns search by meaning and literature search on or off and chooses the embeddings model; an owner does it in Settings, AI, signed in as a person, because it can send text to a provider.',
  reindex_embeddings:
    'Clears and rebuilds the stored vectors; an owner does it in Settings, AI, signed in as a person.',
  // Personal devices and display settings.
  my_push_devices:
    'Lists the phones and browsers that get this person’s push notifications.',
  save_push_subscription:
    'Registers one browser or phone for push notifications.',
  remove_push_subscription:
    'Removes one browser or phone from push notifications.',
  get_push_public_key:
    'Browser push set-up value, only used by the app itself.',
  set_display_preferences:
    'A person’s display settings, such as theme and date format.',
  set_hidden_nav_pages: 'A person’s sidebar layout.',
  set_nav_folded: 'A person’s sidebar layout.',
  list_views: 'A person’s saved column and sort choices for a list.',
  set_list_view: 'A person’s saved column and sort choices for a list.',
  my_step_timers:
    'View behind the app’s timer bar; step_timers is the readable table.',
  // Covered another way.
  my_request_forms: 'A no-argument lookup; request_forms lists the same forms.',
  legal_hold_counts:
    'A no-argument count; legal_hold_records holds the same rows.',
  // File uploads (tokens have no file access yet).
  set_my_photo: 'Needs an uploaded image from the person’s device.',
  clear_my_photo: 'Removes the person’s own profile photo.',
  member_photo: 'Serves a profile image file.',
  workspace_member_photos: 'Profile image files for the app’s avatars.',
  set_workspace_logo: 'Needs an uploaded image file.',
  clear_workspace_logo:
    'Removes the lab logo file; changed by an admin in Settings.',
  workspace_logo: 'Serves the lab logo file.',
  set_material_sds: 'Attaches an uploaded safety data sheet file.',
  record_file_sequence:
    'Reads a sequence file’s contents, which needs file access.',
  // Account and onboarding, done by the person.
  leave_workspace: 'A person leaves their own workspace from their profile.',
  skip_lab_setup: 'Onboarding step in the app.',
  // Attestation and policy decisions made by a person in the app.
  decide_request: 'Approving or declining a request is a person’s decision.',
  release_legal_hold:
    'Releasing a hold is a compliance decision made in the app.',
  apply_retention:
    'Archives records in bulk; a person confirms it in the app. retention_due lists what is due.',
  set_retention_rule: 'Retention policy is set by an admin in Settings.',
  set_retention_enabled: 'Turns retention on for the workspace; admin setting.',
  set_spec_limits_enabled:
    'Turns result limits on for the workspace; admin setting.',
  // Helpers.
  normalize_pipeline_event_type:
    'Checks the event name on a pipeline schedule; the schedule calls already take it.',
  // Instrument data and run quality control.
  my_notifications:
    'A person’s own bell list, rebuilt only to carry the page a notification opens; read in the app.',
  // Labels.
  save_label_template:
    'Saves how a label looks, including the plugin code and layout it uses; a settings screen with its own admin route, and the plugin points are listed in the plugins API.',
}
