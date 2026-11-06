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
  // Helpers.
  normalize_pipeline_event_type:
    'Checks the event name on a pipeline schedule; the schedule calls already take it.',
}
