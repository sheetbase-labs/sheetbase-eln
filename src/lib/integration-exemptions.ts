/**
 * Database objects that are deliberately NOT on the external API.
 *
 * Every table and function a migration adds to the `api` schema from
 * migration 0057 on must be reachable by API tokens (and so by MCP and the
 * docs), or be listed here with the reason it is not. The guard test
 * (`integration-coverage.test.ts`) enforces that, so a new feature cannot
 * ship as a screen only.
 *
 * Reasons that hold up: the object is a person's own device or display
 * setting; it hands out a secret; it needs a file upload, which tokens cannot
 * do yet; it authors the workspace's schema (people only, `schema.edit`); or
 * it is an attestation or a bulk, hard-to-undo decision that a person makes
 * in the app. "Not got round to it" is not a reason.
 */

export const NOT_EXPOSED: Readonly<Record<string, string>> = {
  // Plate formats (migration 0104): existing functions rewritten to accept the
  // 6 to 1536-well formats. Nothing new is added to them.
  validate_scientific_block:
    'Database trigger that checks notebook blocks as they are saved.',
  create_plate_design:
    'Plate designs are authored in the app; rewritten in 0104 only to accept the larger plate formats.',
  save_plate_layout_template:
    'Plate layout templates are authored in the app; rewritten in 0104 only to accept the larger plate formats.',
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
  create_scim_token:
    'Hands out a directory sync secret, shown once to the person who makes it.',
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
  save_notification_preference:
    'A person’s notification settings, changed in their own account.',
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
  // Secrets.
  calendar_feeds:
    'Holds the secret link a person subscribes their calendar app to.',
  create_calendar_feed: 'Hands out a secret calendar link for one person.',
  revoke_calendar_feed: 'Revokes a person’s secret calendar link.',
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
  // Schema authoring stays with people (schema.edit); tokens cannot create models.
  create_registry_model: 'Authors a record model; people only.',
  create_request_model: 'Authors a record model; people only.',
  create_starter_model: 'Authors a record model; people only.',
  set_model_registry: 'Changes what a record model is; people only.',
  set_model_chemistry: 'Changes what a record model is; people only.',
  index_record_structure:
    'Internal re-index run by the app after it reads a drawing; token callers use set_record_structure.',
  set_model_incident_log: 'Changes what a record model is; people only.',
  set_request_form:
    'Decides which models accept requests and who handles them; admin setting.',
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
  // Agent permissions (agent guardrails): the guardrails are a person's to set
  // and decide, never an agent's.
  set_agent_action_policy:
    'Sets what agents may do on their own (Auto, Ask or Never); an admin setting that an agent must not be able to change for itself.',
  decide_agent_action:
    'Approving or rejecting what an agent asked to do is a person’s decision made in the app; credentials are refused.',
  can_run_ai_evals:
    'Tells the AI settings page whether this person may run the assistant checks; finished runs are on ai_eval_runs.',
  // Helpers.
  normalize_pipeline_event_type:
    'Checks the event name on a pipeline schedule; the schedule calls already take it.',
  // Instrument data and run quality control.
  create_converter_parser:
    'Choosing how an instrument’s files are read is an integrations setting with its own admin route (`/api/parsers/converter`); documents and quality control are exposed.',
  my_notifications:
    'A person’s own bell list, rebuilt only to carry the page a notification opens; read in the app.',
}
