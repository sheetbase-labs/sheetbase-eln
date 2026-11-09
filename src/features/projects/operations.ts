/**
 * Projects, folders, following, the Inbox and notifications, the audit log
 * and the steward reporting reads. One declaration gives each its public API
 * entry (token allowlist, OpenAPI, docs, SDK), the MCP action, the pipeline
 * action and, where it has one, the assistant card name.
 *
 * Every call acts as the person the token belongs to, and the database still
 * decides what that person may do (project lead, writer, audit settings).
 * Calls about a person's own Inbox, follows and notification settings need a
 * personal token: a service credential has no person behind it, so the
 * database refuses them.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

const workspace = () => note('p_workspace_id', 'uuid', 'Your workspace id.')
const project = () => note('p_project_id', 'uuid', 'Project id.')
const record = () => note('p_record_id', 'uuid', 'Record id.')
const folder = () => note('p_folder_id', 'uuid', 'Folder id.')
const card = (tool: string) => ({
  tool,
  presentation: 'card' as const,
  vocabulary: 'propose' as const,
})
const DOCS = 'projects-api.md'

/** Optional project details, shared by editing a project and copying one. */
const projectDetails = (): OperationInput[] => [
  note('p_client_id', 'uuid', 'The client the work is for.', false, true),
  note('p_modality', 'text', 'Modality, such as `antibody`.', false, true),
  note('p_stage', 'text', 'Stage, such as `discovery`.', false, true),
  note(
    'p_lead_user_id',
    'text',
    'The project lead (their user id).',
    false,
    true,
  ),
  note(
    'p_default_reviewer_user_id',
    'text',
    'Who reviews by default (their user id).',
    false,
    true,
  ),
  note(
    'p_agreement_reference',
    'text',
    'The agreement or contract reference.',
    false,
    true,
  ),
  note('p_started_on', 'date', 'When the work started.', false, true),
]

export const PROJECTS_OPERATIONS = defineOperations([
  // -- projects --------------------------------------------------------------
  {
    name: 'project_list_summary',
    label: 'List projects with their counts',
    summary: 'List projects with record counts and last activity',
    description:
      'Every project you can see, archived ones too, with its client, lead, how many records and experiments it holds and when it last changed.',
    kind: 'read',
    inputs: [],
    result:
      'rows:id=uuid,workspace_id=uuid,key=text,title=text,status=text,display_id=text,client_id=uuid,client_code=text,client_name=text,modality=text,stage=text,lead_user_id=text,lead_name=text,default_reviewer_user_id=text,agreement_reference=text,started_on=date,revision=bigint,created_at=ts,updated_at=ts,archived_at=ts,record_count=bigint,experiment_count=bigint,last_activity_at=ts',
    docsPage: DOCS,
  },
  {
    name: 'project_review_candidates',
    label: 'List who can review in a project',
    summary: 'List the people who may review work in a project',
    description: 'The active members with review permission on the project.',
    kind: 'read',
    inputs: [project()],
    result: 'rows:user_id=text',
    docsPage: DOCS,
  },
  {
    name: 'update_project_details',
    label: 'Edit a project',
    summary: 'Change a project’s name, client, lead and other details',
    description:
      'Leave out what stays. `p_expected_revision` is the project’s `revision` as you read it, so two edits cannot overwrite each other. Needs to manage the project. Returns the project. Sends `project.updated`.',
    kind: 'write',
    inputs: [
      project(),
      note(
        'p_expected_revision',
        'bigint',
        'The project’s `revision` as you read it.',
      ),
      note('p_title', 'text', 'The new name.', false, true),
      ...projectDetails(),
    ],
    result: 'row:projects',
    assistant: card('sheetbase.project.update'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'archive_project',
    label: 'Archive a project',
    summary: 'Archive a project',
    description:
      'Hides the project from everyday lists. Nothing is deleted and it can be restored. Needs to manage the project. Returns the project. Sends `project.archived`.',
    kind: 'write',
    inputs: [project()],
    result: 'row:projects',
    assistant: card('sheetbase.project.archive'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'unarchive_project',
    label: 'Restore a project',
    summary: 'Restore an archived project',
    description:
      'Brings an archived project back. Needs to manage the project. Returns the project. Sends `project.restored`.',
    kind: 'write',
    inputs: [project()],
    result: 'row:projects',
    assistant: card('sheetbase.project.restore'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'create_project_from_structure',
    label: 'Start a project like another',
    summary: 'Start a new project with the structure of an existing one',
    description:
      'Makes a project with the source project’s plan (its tasks and deliverables, all set back to not started) and none of its records. Needs to manage the source. `p_expected_source_revision` is the source’s `revision`. Returns the new project. Sends `project.created`.',
    kind: 'write',
    inputs: [
      note('p_source_project_id', 'uuid', 'The project to copy.'),
      note(
        'p_expected_source_revision',
        'bigint',
        'The source project’s `revision` as you read it.',
      ),
      note('p_title', 'text', 'The new project’s name.'),
      ...projectDetails(),
    ],
    result: 'row:projects',
    assistant: card('sheetbase.project.copy_structure'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'create_plan_from_project',
    label: 'Copy a project’s plan',
    summary: 'Copy the plan of one project into another',
    description:
      'Copies the phases, milestones and their conditions from the source project into the target, moved so the first starts on `p_start_date`. Needs to be able to write in the workspace. Returns the counts of what was copied.',
    kind: 'write',
    inputs: [
      note('p_target_project_id', 'uuid', 'The project the plan goes into.'),
      note('p_source_project_id', 'uuid', 'The project whose plan is copied.'),
      note('p_start_date', 'date', 'When the copied plan starts.'),
    ],
    result: 'json',
    assistant: card('sheetbase.project.copy_plan'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'move_record_to_project',
    label: 'Move a record to another project',
    summary: 'Move a record to another project',
    description:
      'Moves the record and everything in it. `p_expected_metadata_version` is the record’s `metadata_version`. Needs to edit both projects. Returns the record. Sends `record.moved`.',
    kind: 'write',
    inputs: [
      record(),
      note('p_project_id', 'uuid', 'The project it moves to.'),
      note(
        'p_expected_metadata_version',
        'bigint',
        'The record’s `metadata_version` as you read it.',
      ),
    ],
    result: 'row:records',
    assistant: card('sheetbase.record.move_project'),
    pipeline: {},
    docsPage: DOCS,
  },
  // -- folders ---------------------------------------------------------------
  {
    name: 'create_project_folder',
    label: 'Make a folder',
    summary: 'Make a folder in a project',
    description:
      'Optionally inside another folder. Needs to edit the project. Returns the folder. Sends `folder.created`.',
    kind: 'write',
    inputs: [
      project(),
      note('p_name', 'text', 'The folder’s name.'),
      note('p_parent_id', 'uuid', 'The folder it goes in.', false, true),
    ],
    result: 'row:folders',
    assistant: card('sheetbase.folder.create'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'rename_project_folder',
    label: 'Rename a folder',
    summary: 'Rename a folder',
    description: 'Returns the folder. Sends `folder.updated`.',
    kind: 'write',
    inputs: [folder(), note('p_name', 'text', 'The new name.')],
    result: 'row:folders',
    assistant: card('sheetbase.folder.rename'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'delete_project_folder',
    label: 'Delete a folder',
    summary: 'Delete a folder that holds no records',
    description:
      'A folder that still holds records cannot be deleted; move them first. Folders inside it move up one level. Needs to edit the project. Sends `folder.deleted`.',
    kind: 'write',
    inputs: [folder()],
    result: 'void',
    assistant: card('sheetbase.folder.delete'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'move_records_to_folder',
    label: 'Put records in a folder',
    summary: 'Move records into a folder, or out of every folder',
    description:
      'Moves records of one project into a folder of that project; leave the folder out to take them out of their folder. Returns how many moved. Sends `record.moved` for each.',
    kind: 'write',
    inputs: [
      project(),
      note('p_record_ids', 'uuid[]', 'The records to move.'),
      note('p_folder_id', 'uuid', 'The folder, or null for none.', true, true),
    ],
    result: 'int',
    assistant: card('sheetbase.folder.move_records'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'move_to_folder',
    label: 'Put datasets, sheets and pipelines in a folder',
    summary: 'Move datasets, sheets, analysis views or pipelines into a folder',
    description:
      'A JSON array of `{ "kind": "dataset" | "sheet_instance" | "analysis_view" | "pipeline_definition", "id": "…" }`; leave the folder out to take them out of their folder. Returns how many moved. Sends `folder.item_placed` or `folder.item_removed` for each.',
    kind: 'write',
    inputs: [
      note('p_items', 'json', 'What to move.'),
      note('p_folder_id', 'uuid', 'The folder, or null for none.', true, true),
    ],
    result: 'int',
    assistant: card('sheetbase.folder.move_items'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'folder_items_list',
    label: 'List what is in a folder',
    summary:
      'List the datasets, sheets, analysis views and pipelines in a folder',
    description:
      'Records in a folder are on `records` (`folder_id`); this lists the other things filed there.',
    kind: 'read',
    inputs: [folder()],
    result:
      'rows:object_kind=text,object_id=uuid,name=text,project_id=uuid,placed_at=ts',
    docsPage: DOCS,
  },
  // -- following -------------------------------------------------------------
  {
    name: 'follow_record',
    label: 'Follow a record',
    summary: 'Follow a record',
    description:
      'Its changes show in your Inbox under Following. Needs a personal token. Returns when you started following.',
    kind: 'write',
    inputs: [record()],
    result: 'ts',
    assistant: card('sheetbase.record.follow'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'unfollow_record',
    label: 'Stop following a record',
    summary: 'Stop following a record',
    description: 'Needs a personal token.',
    kind: 'write',
    inputs: [record()],
    result: 'void',
    assistant: card('sheetbase.record.unfollow'),
    pipeline: {},
    docsPage: DOCS,
  },
  // -- Inbox and notifications -----------------------------------------------
  {
    name: 'inbox_work_items_page',
    label: 'Read the Inbox',
    summary: 'Read a page of your Inbox',
    description:
      'One tab of your Inbox (`needs-action`, `following` or `done-today`), optionally one kind of item (`reviews`, `data`, `runs`, `materials`, `lab`, `admin`, `agents` or `following`), up to 200 at a time. Needs a personal token. Returns `{ items, total, offset, tabs, types }`, where `tabs` and `types` are counts.',
    kind: 'read',
    inputs: [
      note(
        'p_tab',
        'text',
        '`needs-action` (the default), `following` or `done-today`.',
        false,
      ),
      note('p_type', 'text', 'Only this kind of item.', false, true),
      note(
        'p_limit',
        'int',
        'At most this many, 1 to 200 (default 100).',
        false,
      ),
      note('p_offset', 'int', 'Skip this many first.', false),
    ],
    result: 'json',
    docsPage: DOCS,
  },
  {
    name: 'inbox_needs_action_counts',
    label: 'Count what needs you',
    summary: 'Count the Inbox items that need you',
    description:
      'How many items need you, and how many of those are reviews. Needs a personal token.',
    kind: 'read',
    inputs: [],
    result: 'rows:total=int,reviews=int',
    docsPage: DOCS,
  },
  {
    name: 'mark_work_items_seen',
    label: 'Mark Inbox items seen',
    summary: 'Mark Inbox items as seen',
    description:
      'By their `item_key` from the Inbox. Needs a personal token. Returns how many were marked.',
    kind: 'write',
    inputs: [note('p_item_keys', 'text[]', 'The items’ `item_key` values.')],
    result: 'int',
    docsPage: DOCS,
  },
  {
    name: 'mark_notifications_read',
    label: 'Mark notifications read',
    summary: 'Mark your notifications as read',
    description:
      'Leave the ids out to mark them all. Needs a personal token. Returns how many were marked.',
    kind: 'write',
    inputs: [
      note(
        'p_ids',
        'uuid[]',
        'Which notifications (`my_notifications`).',
        false,
      ),
    ],
    result: 'int',
    docsPage: DOCS,
  },
  {
    name: 'save_notification_preference',
    label: 'Choose how you hear about something',
    summary: 'Choose how you are told about one kind of event',
    description:
      'For one kind of event (`notification_events`), whether you are told in the app, by email, in the daily digest and on your phone. Needs a personal token. Returns your setting.',
    kind: 'write',
    inputs: [
      note(
        'p_event_type',
        'text',
        'The kind of event, such as `review_requested`.',
      ),
      note('p_in_app', 'bool', 'Show it in the app.'),
      note('p_email', 'bool', 'Send an email.'),
      note('p_digest', 'bool', 'Put it in the daily digest.'),
      note('p_push', 'bool', 'Send it to your phone.', false, true),
    ],
    result: 'row:notification_preferences',
    docsPage: DOCS,
  },
  {
    name: 'set_notification_timing',
    label: 'Set quiet hours and the digest time',
    summary: 'Set your quiet hours and when the daily digest arrives',
    description:
      'Times are `HH:MM` in the workspace time zone; leave one out to clear it. Needs a personal token. Returns your preferences.',
    kind: 'write',
    inputs: [
      note('p_quiet_start', 'text', 'When quiet hours start.', false, true),
      note('p_quiet_end', 'text', 'When quiet hours end.', false, true),
      note('p_digest_time', 'text', 'When the digest is sent.', false, true),
    ],
    result: 'row:user_preferences',
    docsPage: DOCS,
  },
  {
    name: 'record_recent_view',
    label: 'Note that you opened something',
    summary: 'Add something to your recently viewed list',
    description:
      'Puts a record, dataset, sheet, project or template at the top of your recently viewed list (`recently_viewed`). Needs a personal token. Returns when.',
    kind: 'write',
    inputs: [
      note(
        'p_object_kind',
        'text',
        '`record`, `dataset`, `sheet`, `project` or `notebook_template`.',
      ),
      note('p_object_id', 'uuid', 'Its id.'),
    ],
    result: 'ts',
    docsPage: DOCS,
  },
  // -- audit and verification ------------------------------------------------
  {
    name: 'audit_events',
    label: 'Search the audit log',
    summary: 'Search the audit log',
    description:
      'Who changed what and when, newest first, filtered by kind of thing, operation, person, dates, text, one object or one project. Page with `p_before_sequence`. Entries about tokens, invitations, settings and project access are shown to owners, admins and stewards only. Needs a personal token. Returns `{ events, hasMore, nextCursor }`; pass `nextCursor` as `p_before_sequence` for the next page.',
    kind: 'read',
    inputs: [
      note(
        'p_entity_type',
        'text',
        'Only this kind of thing, such as `record`.',
        false,
        true,
      ),
      note(
        'p_operation',
        'text',
        'Only this operation, such as `update`.',
        false,
        true,
      ),
      note(
        'p_actor_user_id',
        'text',
        'Only changes by this person.',
        false,
        true,
      ),
      note('p_from', 'ts', 'From this time.', false, true),
      note('p_to', 'ts', 'Up to this time.', false, true),
      note('p_search', 'text', 'Text to look for.', false, true),
      note('p_object', 'uuid', 'Only this object.', false, true),
      note(
        'p_before_sequence',
        'bigint',
        'Entries before this sequence number (the next page).',
        false,
        true,
      ),
      note('p_limit', 'int', 'At most this many (default 50).', false),
      note('p_project_id', 'uuid', 'Only this project.', false, true),
    ],
    result: 'json',
    docsPage: DOCS,
  },
  {
    name: 'export_audit_log',
    label: 'Export the audit log',
    summary: 'Export the audit log between two dates',
    description:
      'Up to 5,000 entries in order, without secrets or addresses. Needs audit settings access.',
    kind: 'read',
    inputs: [
      workspace(),
      note('p_from_date', 'ts', 'From this time.', false, true),
      note('p_to_date', 'ts', 'Up to this time.', false, true),
      note('p_limit', 'int', 'At most this many (default 1,000).', false),
    ],
    result: 'json',
    docsPage: DOCS,
  },
  {
    name: 'verify_audit_chain',
    label: 'Check the audit log is untouched',
    summary: 'Check that no audit entry was changed or removed',
    description:
      'Walks the chain of entry fingerprints. Returns whether it holds, how many entries were checked and the first one that does not. Needs audit settings access.',
    kind: 'read',
    inputs: [workspace()],
    result:
      'rows:ok=bool,checked=int,first_bad_sequence=bigint,first_bad_id=uuid',
    docsPage: DOCS,
  },
  {
    name: 'audit_verification_status',
    label: 'See the last audit check',
    summary: 'See the result of the last full audit check',
    description:
      'When the audit log and signed records were last checked and whether everything held. Null before the first check.',
    kind: 'read',
    inputs: [],
    result: 'json',
    docsPage: DOCS,
  },
  {
    name: 'run_audit_verification',
    label: 'Check the audit log and signatures now',
    summary: 'Check the audit log and every signed record now',
    description:
      'Runs the full check the nightly job runs and adds its result to the audit log. Changes nothing else. Needs to manage audit settings. Returns the result. Sends `audit.verified`.',
    kind: 'write',
    inputs: [workspace()],
    result: 'json',
    assistant: card('sheetbase.audit.verify'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'record_timeline',
    label: 'See a record’s history',
    summary: 'See everything that happened to a record',
    description:
      'Its changes, reviews and their decisions, checks, signatures and comments, in one list.',
    kind: 'read',
    inputs: [record()],
    result: 'json',
    docsPage: DOCS,
  },
  {
    name: 'save_trail_evidence',
    label: 'Keep a trail as evidence',
    summary: 'Keep a record’s audit trail as evidence',
    description:
      'Saves the steps you picked from a record’s history, with a note, so they can be shown later. Saved evidence cannot be changed. Returns what was saved.',
    kind: 'write',
    inputs: [
      record(),
      note('p_steps', 'json', 'A JSON array of 1 to 200 trail steps.'),
      note(
        'p_note',
        'text',
        'Why it is kept (up to 500 characters).',
        false,
        true,
      ),
    ],
    result: 'row:trail_evidence',
    pipeline: {},
    docsPage: DOCS,
  },
  // -- steward reporting -----------------------------------------------------
  {
    name: 'reporting_models',
    label: 'List the SQL views',
    summary: 'List the read-only SQL views for data access',
    description:
      'One view per record type and the fixed views, with the name to query. For people with data access.',
    kind: 'read',
    inputs: [],
    result:
      'rows:model_key=text,model_name=text,view_name=text,kind=text,parent_key=text',
    docsPage: DOCS,
  },
  {
    name: 'reporting_columns',
    label: 'List the SQL view columns',
    summary: 'List the columns of every SQL view',
    description:
      'Each column with its label, SQL type and unit. For people with data access.',
    kind: 'read',
    inputs: [],
    result:
      'rows:model_key=text,view_name=text,field_key=text,column_name=text,label=text,sql_type=text,unit=text,ordinal=int',
    docsPage: DOCS,
  },
  {
    name: 'sql_access_ready',
    label: 'Check SQL access is ready',
    summary: 'Check whether read-only SQL logins can be made here',
    description:
      'True when you have data access and the database is set up for SQL logins.',
    kind: 'read',
    inputs: [],
    result: 'bool',
    docsPage: DOCS,
  },
  {
    name: 'list_sql_logins',
    label: 'List SQL logins',
    summary: 'List the read-only SQL logins',
    description:
      'Your own logins, or everyone’s for an owner or admin, with their status (`active`, `expired`, `suspended` or `revoked`). Passwords are never returned.',
    kind: 'read',
    inputs: [workspace()],
    result:
      'rows:id=uuid,name=text,username=text,user_id=text,created_at=ts,expires_at=ts,revoked_at=ts,status=text',
    docsPage: DOCS,
  },
  {
    name: 'revoke_sql_login',
    label: 'Revoke a SQL login',
    summary: 'Revoke a read-only SQL login',
    description:
      'The login stops working at once. Your own, or anyone’s for an owner or admin. Sends `sql_login.revoked`.',
    kind: 'write',
    inputs: [workspace(), note('p_login_id', 'uuid', 'The login id.')],
    result: 'void',
    assistant: card('sheetbase.sql_login.revoke'),
    pipeline: {},
    docsPage: DOCS,
  },
])
