# Projects, folders, Inbox and audit API

Projects and their folders, following records, your Inbox and notification
settings, the audit log and its checks, and the read-only SQL logins are
reachable with a token, from the assistant, over MCP, in pipelines and through
webhooks, the same way as the rest of the lab (see [lab-api.md](lab-api.md)
for scopes and how tokens work). Who may see and change each project is in
[people-api.md](people-api.md).

- Reads need `lab:read`; actions need `lab:write` and run as the person a
  **personal token** belongs to. The database makes the same checks as the
  app: project lead, project editor, audit settings, data access.
- Your Inbox, follows, pins, recently viewed list and notification settings
  are one person's own, so a service credential, which has no person, cannot
  read or change them.
- Tables are read through `GET /api/db/<table>`; actions are
  `POST /api/db/rpc/<name>` with the `p_` arguments. Projects, folders and
  records are on the core tables (`projects`, `folders`, `records`).
- Over MCP, actions run through `sheetbase.lab.act` and tables through
  `sheetbase.canonical.read`, under the workspace's agent permissions.
- The audit log only grows. Nothing here changes or removes an entry;
  `run_audit_verification` adds one with its result.
- Making or rotating a SQL login hands out a password once, so that stays with
  the person in their account settings (API and data access). Listing and
  revoking logins are here.
- Webhook events: `project.created`, `project.updated`, `project.archived`,
  `project.restored`, `record.moved` (a record changed project or folder),
  `folder.created`, `folder.updated`, `folder.deleted`, `folder.items_moved`,
  `audit.verified`, `sql_login.created` and `sql_login.revoked`. Project,
  folder and audit events can start a pipeline. See
  [event-catalogue.md](event-catalogue.md).
- Stewards with a SQL login also get the views `data.folders`,
  `data.folder_items`, `data.project_follows`, `data.trail_evidence` and
  `data.audit_log` (the audit log without payloads).

## Tables

| Table                      | What it holds                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `folder_items`             | Which folder each dataset, sheet, analysis view and pipeline is filed in. Records name their folder themselves (`records.folder_id`). File things with `move_to_folder`. |
| `work_item_follows`        | The records you follow. Follow and stop with `follow_record` and `unfollow_record`. Personal tokens only.                                                                |
| `work_item_views`          | Inbox items you have seen, by `item_key`. Mark them with `mark_work_items_seen`. Personal tokens only.                                                                   |
| `notification_events`      | The kinds of event you can be told about, and whether email and phone alerts are on by default.                                                                          |
| `notification_preferences` | How you want to be told about each kind of event. Change them with `save_notification_preference`. Personal tokens only.                                                 |
| `recently_viewed`          | What you opened lately. Add to it with `record_recent_view`. Personal tokens only.                                                                                       |
| `user_favourites`          | What you pinned. Pin and unpin with `set_record_favourite`. Personal tokens only.                                                                                        |
| `trail_evidence`           | Steps of a record’s history kept as evidence, with a note. Keep one with `save_trail_evidence`; kept evidence never changes.                                             |

## Projects

### `project_list_summary`

List projects with record counts and last activity. Every project you can see, archived ones too, with its client, lead, how many records and experiments it holds and when it last changed.

Scope: `lab:read`.

### `project_review_candidates`

List the people who may review work in a project. The active members with review permission on the project.

Scope: `lab:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `update_project_details`

Change a project’s name, client, lead and other details. Leave out what stays. `p_expected_revision` is the project’s `revision` as you read it, so two edits cannot overwrite each other. Needs to manage the project. Returns the project. Sends `project.updated`.

Scope: `lab:write`.

| Argument                     | Type   |                                          |
| ---------------------------- | ------ | ---------------------------------------- |
| `p_project_id` *             | uuid   | Project id.                              |
| `p_expected_revision` *      | bigint | The project’s `revision` as you read it. |
| `p_title`                    | text   | The new name.                            |
| `p_client_id`                | uuid   | The client the work is for.              |
| `p_modality`                 | text   | Modality, such as `antibody`.            |
| `p_stage`                    | text   | Stage, such as `discovery`.              |
| `p_lead_user_id`             | text   | The project lead (their user id).        |
| `p_default_reviewer_user_id` | text   | Who reviews by default (their user id).  |
| `p_agreement_reference`      | text   | The agreement or contract reference.     |
| `p_started_on`               | date   | When the work started.                   |

### `archive_project`

Archive a project. Hides the project from everyday lists. Nothing is deleted and it can be restored. Needs to manage the project. Returns the project. Sends `project.archived`.

Scope: `lab:write`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `unarchive_project`

Restore an archived project. Brings an archived project back. Needs to manage the project. Returns the project. Sends `project.restored`.

Scope: `lab:write`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `create_project_from_structure`

Start a new project with the structure of an existing one. Makes a project with the source project’s plan (its tasks and deliverables, all set back to not started) and none of its records. Needs to manage the source. `p_expected_source_revision` is the source’s `revision`. Returns the new project. Sends `project.created`.

Scope: `lab:write`.

| Argument                       | Type   |                                                 |
| ------------------------------ | ------ | ----------------------------------------------- |
| `p_source_project_id` *        | uuid   | The project to copy.                            |
| `p_expected_source_revision` * | bigint | The source project’s `revision` as you read it. |
| `p_title` *                    | text   | The new project’s name.                         |
| `p_client_id`                  | uuid   | The client the work is for.                     |
| `p_modality`                   | text   | Modality, such as `antibody`.                   |
| `p_stage`                      | text   | Stage, such as `discovery`.                     |
| `p_lead_user_id`               | text   | The project lead (their user id).               |
| `p_default_reviewer_user_id`   | text   | Who reviews by default (their user id).         |
| `p_agreement_reference`        | text   | The agreement or contract reference.            |
| `p_started_on`                 | date   | When the work started.                          |

### `create_plan_from_project`

Copy the plan of one project into another. Copies the phases, milestones and their conditions from the source project into the target, moved so the first starts on `p_start_date`. Needs to be able to write in the workspace. Returns the counts of what was copied.

Scope: `lab:write`.

| Argument                | Type |                                   |
| ----------------------- | ---- | --------------------------------- |
| `p_target_project_id` * | uuid | The project the plan goes into.   |
| `p_source_project_id` * | uuid | The project whose plan is copied. |
| `p_start_date` *        | date | When the copied plan starts.      |

### Importing projects in bulk

The Import button on the Projects list reads a CSV (Name, and optionally Client, Modality, Stage, Lead, Started as `2026-11-11`, Agreement) and makes each line with `create_project`, one call per line, as the New project form does. There is no separate bulk endpoint, so a token, the MCP `sheetbase.lab.act` tool, the assistant and a pipeline do the same by calling `create_project` once per project. Each line sends `project.created`, and a line that cannot be made fails alone without stopping the rest.

### `move_record_to_project`

Move a record to another project. Moves the record and everything in it. `p_expected_metadata_version` is the record’s `metadata_version`. Needs to edit both projects. Returns the record. Sends `record.moved`.

Scope: `lab:write`.

| Argument                        | Type   |                                                 |
| ------------------------------- | ------ | ----------------------------------------------- |
| `p_record_id` *                 | uuid   | Record id.                                      |
| `p_project_id` *                | uuid   | The project it moves to.                        |
| `p_expected_metadata_version` * | bigint | The record’s `metadata_version` as you read it. |

## Folders

### `create_project_folder`

Make a folder in a project. Optionally inside another folder. Needs to edit the project. Returns the folder. Sends `folder.created`.

Scope: `lab:write`.

| Argument         | Type |                        |
| ---------------- | ---- | ---------------------- |
| `p_project_id` * | uuid | Project id.            |
| `p_name` *       | text | The folder’s name.     |
| `p_parent_id`    | uuid | The folder it goes in. |

### `rename_project_folder`

Rename a folder. Returns the folder. Sends `folder.updated`.

Scope: `lab:write`.

| Argument        | Type |               |
| --------------- | ---- | ------------- |
| `p_folder_id` * | uuid | Folder id.    |
| `p_name` *      | text | The new name. |

### `delete_project_folder`

Delete a folder that holds no records. A folder that still holds records cannot be deleted; move them first. Folders inside it move up one level. Needs to edit the project. Sends `folder.deleted`.

Scope: `lab:write`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_folder_id` * | uuid | Folder id. |

### `move_records_to_folder`

Move records into a folder, or out of every folder. Moves records of one project into a folder of that project; leave the folder out to take them out of their folder. Returns how many moved. Sends `record.moved` for each.

Scope: `lab:write`.

| Argument         | Type   |                               |
| ---------------- | ------ | ----------------------------- |
| `p_project_id` * | uuid   | Project id.                   |
| `p_record_ids` * | uuid[] | The records to move.          |
| `p_folder_id` *  | uuid   | The folder, or null for none. |

### `move_to_folder`

Move datasets, sheets, analysis views or pipelines into a folder. A JSON array of `{ "kind": "dataset" | "sheet_instance" | "analysis_view" | "pipeline_definition", "id": "…" }`; leave the folder out to take them out of their folder. Returns how many moved. Sends `folder.item_placed` or `folder.item_removed` for each.

Scope: `lab:write`.

| Argument        | Type |                               |
| --------------- | ---- | ----------------------------- |
| `p_items` *     | json | What to move.                 |
| `p_folder_id` * | uuid | The folder, or null for none. |

### `folder_items_list`

List the datasets, sheets, analysis views and pipelines in a folder. Records in a folder are on `records` (`folder_id`); this lists the other things filed there.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_folder_id` * | uuid | Folder id. |

## Following

### `follow_record`

Follow a record. Its changes show in your Inbox under Following. Needs a personal token. Returns when you started following.

Scope: `lab:write`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `unfollow_record`

Stop following a record. Needs a personal token.

Scope: `lab:write`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

## Inbox and notifications

### `inbox_work_items_page`

Read a page of your Inbox. One tab of your Inbox (`needs-action`, `following` or `done-today`), optionally one kind of item (`reviews`, `data`, `runs`, `materials`, `lab`, `admin`, `agents` or `following`), up to 200 at a time. Needs a personal token. Returns `{ items, total, offset, tabs, types }`, where `tabs` and `types` are counts.

Scope: `lab:read`.

| Argument   | Type |                                                            |
| ---------- | ---- | ---------------------------------------------------------- |
| `p_tab`    | text | `needs-action` (the default), `following` or `done-today`. |
| `p_type`   | text | Only this kind of item.                                    |
| `p_limit`  | int  | At most this many, 1 to 200 (default 100).                 |
| `p_offset` | int  | Skip this many first.                                      |

### `inbox_needs_action_counts`

Count the Inbox items that need you. How many items need you, and how many of those are reviews. Needs a personal token.

Scope: `lab:read`.

### `mark_work_items_seen`

Mark Inbox items as seen. By their `item_key` from the Inbox. Needs a personal token. Returns how many were marked.

Scope: `lab:write`.

| Argument        | Type   |                               |
| --------------- | ------ | ----------------------------- |
| `p_item_keys` * | text[] | The items’ `item_key` values. |

### `mark_notifications_read`

Mark your notifications as read. Leave the ids out to mark them all. Needs a personal token. Returns how many were marked.

Scope: `lab:write`.

| Argument | Type   |                                           |
| -------- | ------ | ----------------------------------------- |
| `p_ids`  | uuid[] | Which notifications (`my_notifications`). |

### `save_notification_preference`

Choose how you are told about one kind of event. For one kind of event (`notification_events`), whether you are told in the app, by email, in the daily digest and on your phone. Needs a personal token. Returns your setting.

Scope: `lab:write`.

| Argument         | Type |                                                |
| ---------------- | ---- | ---------------------------------------------- |
| `p_event_type` * | text | The kind of event, such as `review_requested`. |
| `p_in_app` *     | bool | Show it in the app.                            |
| `p_email` *      | bool | Send an email.                                 |
| `p_digest` *     | bool | Put it in the daily digest.                    |
| `p_push`         | bool | Send it to your phone.                         |

### `set_notification_timing`

Set your quiet hours and when the daily digest arrives. Times are `HH:MM` in the workspace time zone; leave one out to clear it. Needs a personal token. Returns your preferences.

Scope: `lab:write`.

| Argument        | Type |                          |
| --------------- | ---- | ------------------------ |
| `p_quiet_start` | text | When quiet hours start.  |
| `p_quiet_end`   | text | When quiet hours end.    |
| `p_digest_time` | text | When the digest is sent. |

### `record_recent_view`

Add something to your recently viewed list. Puts a record, dataset, sheet, project or template at the top of your recently viewed list (`recently_viewed`). Needs a personal token. Returns when.

Scope: `lab:write`.

| Argument          | Type |                                                                 |
| ----------------- | ---- | --------------------------------------------------------------- |
| `p_object_kind` * | text | `record`, `dataset`, `sheet`, `project` or `notebook_template`. |
| `p_object_id` *   | uuid | Its id.                                                         |

## Audit log and checks

### `audit_events`

Search the audit log. Who changed what and when, newest first, filtered by kind of thing, operation, person, dates, text, one object or one project. Page with `p_before_sequence`. Entries about tokens, invitations, settings and project access are shown to owners, admins and stewards only. Needs a personal token. Returns `{ events, hasMore, nextCursor }`; pass `nextCursor` as `p_before_sequence` for the next page.

Scope: `lab:read`.

| Argument            | Type   |                                                      |
| ------------------- | ------ | ---------------------------------------------------- |
| `p_entity_type`     | text   | Only this kind of thing, such as `record`.           |
| `p_operation`       | text   | Only this operation, such as `update`.               |
| `p_actor_user_id`   | text   | Only changes by this person.                         |
| `p_from`            | ts     | From this time.                                      |
| `p_to`              | ts     | Up to this time.                                     |
| `p_search`          | text   | Text to look for.                                    |
| `p_object`          | uuid   | Only this object.                                    |
| `p_before_sequence` | bigint | Entries before this sequence number (the next page). |
| `p_limit`           | int    | At most this many (default 50).                      |
| `p_project_id`      | uuid   | Only this project.                                   |

### `export_audit_log`

Export the audit log between two dates. Up to 5,000 entries in order, without secrets or addresses. Needs audit settings access.

Scope: `lab:read`.

| Argument           | Type |                                    |
| ------------------ | ---- | ---------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                 |
| `p_from_date`      | ts   | From this time.                    |
| `p_to_date`        | ts   | Up to this time.                   |
| `p_limit`          | int  | At most this many (default 1,000). |

### `verify_audit_chain`

Check that no audit entry was changed or removed. Walks the chain of entry fingerprints. Returns whether it holds, how many entries were checked and the first one that does not. Needs audit settings access.

Scope: `lab:read`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |

### `audit_verification_status`

See the result of the last full audit check. When the audit log and signed records were last checked and whether everything held. Null before the first check.

Scope: `lab:read`.

### `run_audit_verification`

Check the audit log and every signed record now. Runs the full check the nightly job runs and adds its result to the audit log. Changes nothing else. Needs to manage audit settings. Returns the result. Sends `audit.verified`.

Scope: `lab:write`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |

### `record_timeline`

See everything that happened to a record. Its changes, reviews and their decisions, checks, signatures and comments, in one list.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `save_trail_evidence`

Keep a record’s audit trail as evidence. Saves the steps you picked from a record’s history, with a note, so they can be shown later. Saved evidence cannot be changed. Returns what was saved.

Scope: `lab:write`.

| Argument        | Type |                                        |
| --------------- | ---- | -------------------------------------- |
| `p_record_id` * | uuid | Record id.                             |
| `p_steps` *     | json | A JSON array of 1 to 200 trail steps.  |
| `p_note`        | text | Why it is kept (up to 500 characters). |

## Data access (SQL)

### `reporting_models`

List the read-only SQL views for data access. One view per record type and the fixed views, with the name to query. For people with data access.

Scope: `lab:read`.

### `reporting_columns`

List the columns of every SQL view. Each column with its label, SQL type and unit. For people with data access.

Scope: `lab:read`.

### `sql_access_ready`

Check whether read-only SQL logins can be made here. True when you have data access and the database is set up for SQL logins.

Scope: `lab:read`.

### `list_sql_logins`

List the read-only SQL logins. Your own logins, or everyone’s for an owner or admin, with their status (`active`, `expired`, `suspended` or `revoked`). Passwords are never returned.

Scope: `lab:read`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |

### `revoke_sql_login`

Revoke a read-only SQL login. The login stops working at once. Your own, or anyone’s for an owner or admin. Sends `sql_login.revoked`.

Scope: `lab:write`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |
| `p_login_id` *     | uuid | The login id.      |
