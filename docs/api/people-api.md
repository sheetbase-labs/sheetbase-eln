# People and workspace API

Members, invitations, project access, groups, workspace settings and the client
portal are reachable with a token, from the assistant, over MCP, in pipelines
and through webhooks, the same way as the rest of the lab (see
[lab-api.md](lab-api.md) for scopes and how tokens work).

- Reads need `lab:read`; actions need `lab:write` and run as the person a
  **personal token** belongs to, with their role. The database makes the same
  checks as the app: members access, project lead, admin and so on. A service
  credential has no person, so these calls and tables refuse it.
- Tables are read through `GET /api/db/<table>`; actions are
  `POST /api/db/rpc/<name>` with the `p_` arguments.
- Over MCP, actions run through `sheetbase.lab.act` and tables through
  `sheetbase.canonical.read`, under the workspace's agent permissions.
- Accepting an invitation is the invited person signing in with their link, and
  your own profile and devices are your own settings, so neither is here.
- Webhook events: `member.joined`, `member.role_changed`, `member.suspended`,
  `member.reinstated`, `member.removed`, `workspace.invitation.created`,
  `workspace.invitation.updated`, `workspace.invitation.deleted`,
  `project.access.granted`, `project.access.updated`,
  `project.access.revoked`, `project.access.requested`,
  `project.access.request_decided`, `workspace.group.created`,
  `workspace.group.deleted`, `workspace.group.member_added`,
  `workspace.group.member_removed`, `workspace.settings.updated`,
  `workspace.settings_access.changed`, `workspace.renamed`,
  `client.created`, `client.updated`, `client.archived`,
  `client.restored`, `client.record_shared`, `client.record_unshared` and
  `client.message_posted`. See [event-catalogue.md](event-catalogue.md).

## Tables

| Table                         | What it holds                                                                                                                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_memberships`       | Who is in the workspace: role, whether suspended, and for a client viewer the client. `role_source` is `idp` when sign-in groups decide the role and `manual` once set by hand. Change them with `change_member_role`, `suspend_member`, `reinstate_member` and `remove_member`. |
| `workspace_invitations`       | Invitations to the workspace and their status (`pending`, `accepted`, `revoked` or `expired`). `token_hash` is a hash of the link, not the link. Needs members access to read.                                                                                                   |
| `project_access`              | Who has what access to each project: one rule per person or group, with `can_view`, `can_edit`, `can_review`, `client_portal` and `can_manage`. Change them with `grant_project_access`, `set_project_access_rule` and `revoke_project_access`.                                  |
| `project_access_requests`     | Requests for edit access to a project and how each was decided. Decide with `decide_project_access_request`.                                                                                                                                                                     |
| `workspace_groups`            | Groups of people that can be given project access.                                                                                                                                                                                                                               |
| `workspace_group_memberships` | Who is in each group.                                                                                                                                                                                                                                                            |
| `settings_access`             | What each role can do in each settings area: `none`, `view` or `manage`.                                                                                                                                                                                                         |
| `workspaces`                  | The workspace itself: its name and key. Rename it with `update_workspace_name`.                                                                                                                                                                                                  |
| `workspace_settings`          | The workspace’s settings: registration, review, signatures, retention, editing rules, general formats, AI and open data switches. Change them with the `update_workspace_*` calls.                                                                                               |
| `clients`                     | Client organisations. `code` is made for you (CL-001). Add and change them with `create_client`, `rename_client` and `set_client_archived`.                                                                                                                                      |
| `client_portal_shares`        | Which approved records each client sees in its portal.                                                                                                                                                                                                                           |
| `client_portal_messages`      | Messages between staff and a client in its portal. `author_kind` says which side wrote it.                                                                                                                                                                                       |

## Members

### `workspace_members_list`

List the members of the workspace. Every member with their name, role and, for a client viewer, the client they belong to.

Scope: `lab:read`.

### `workspace_member_status`

See when each member was last active. Last activity and how many trainings each member must do and has overdue. For people who manage members.

Scope: `lab:read`.

### `list_workspace_sessions`

List the signed-in sessions of the members. Each open session: who, from where, when it started and when it ends. Needs members access. Returns a list of `{ id, user_id, user_name, ip_address, user_agent, created_at, expires_at }`.

Scope: `lab:read`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |

### `revoke_user_session`

Sign one session out. Ends one open session of a member of this workspace. Needs members access.

Scope: `lab:write`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |
| `p_session_id` *   | text | The session id.    |

### `change_member_role`

Change a member’s role. Gives a member a new role. A client viewer needs a client; no one else may have one. Only an admin changes an owner, you cannot change your own role and the last owner cannot be demoted. Needs members access. Returns the membership. Sends `member.role_changed`.

Scope: `lab:write`.

| Argument           | Type |                                                                                                                       |
| ------------------ | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                                                                                    |
| `p_user_id` *      | text | The person (their user id).                                                                                           |
| `p_new_role` *     | text | The new role: `owner`, `admin`, `member`, `steward`, `scientist`, `analyst`, `reviewer`, `viewer` or `client_viewer`. |
| `p_client_id`      | uuid | The client, for a client viewer.                                                                                      |

### `suspend_member`

Suspend a member. Switches a member off without removing them or their work. Not yourself, and not the last owner. Needs members access. Sends `member.suspended`.

Scope: `lab:write`.

| Argument           | Type |                             |
| ------------------ | ---- | --------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.          |
| `p_user_id` *      | text | The person (their user id). |

### `reinstate_member`

Switch a suspended member back on. Lifts a suspension. Needs members access. Sends `member.reinstated`.

Scope: `lab:write`.

| Argument           | Type |                             |
| ------------------ | ---- | --------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.          |
| `p_user_id` *      | text | The person (their user id). |

### `remove_member`

Remove a member from the workspace. Takes a person out of the workspace. Their work stays. Not yourself, and not the last owner. Needs members access. Sends `member.removed`.

Scope: `lab:write`.

| Argument           | Type |                             |
| ------------------ | ---- | --------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.          |
| `p_user_id` *      | text | The person (their user id). |

### `set_member_username`

Set a member’s username. A username is 3 to 40 letters, numbers, dots, dashes or underscores, and unique in the workspace. Leave it out to clear it. Needs members access. Returns the membership.

Scope: `lab:write`.

| Argument           | Type |                               |
| ------------------ | ---- | ----------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.            |
| `p_user_id` *      | text | The person (their user id).   |
| `p_username` *     | text | The username; null clears it. |

## Invitations

### `create_invitation`

Invite someone to the workspace. Makes an invitation for an email address with a role, optionally for a client (client viewers) and with projects the person joins on accepting: `[{ "project_id": "…", "access_level": "viewer" }]`. Returns the invitation and its one-time `token`; the link is `/accept-invitation?token=<token>`. The token is shown once and never stored, so keep it or reissue. Needs members access. Sends `workspace.invitation.created`. In a pipeline the token is left out of the step output.

Scope: `lab:write`.

| Argument               | Type |                                                                                                                                        |
| ---------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `p_workspace_id` *     | uuid | Your workspace id.                                                                                                                     |
| `p_email` *            | text | Who to invite.                                                                                                                         |
| `p_role`               | text | Their role (default `member`): `owner`, `admin`, `member`, `steward`, `scientist`, `analyst`, `reviewer`, `viewer` or `client_viewer`. |
| `p_expires_after_days` | int  | Days the link works (default 7).                                                                                                       |
| `p_client_id`          | uuid | The client, for a client viewer.                                                                                                       |
| `p_project_grants`     | json | JSON list of `{ project_id, access_level }` the person joins on accepting.                                                             |

### `reissue_invitation`

Give an invitation a new link. Replaces the link of a pending or expired invitation; the old link stops working. Returns the invitation and its new one-time `token`. Needs members access. In a pipeline the token is left out of the step output.

Scope: `lab:write`.

| Argument               | Type |                                  |
| ---------------------- | ---- | -------------------------------- |
| `p_workspace_id` *     | uuid | Your workspace id.               |
| `p_invitation_id` *    | uuid | Invitation id.                   |
| `p_expires_after_days` | int  | Days the link works (default 7). |

### `revoke_invitation`

Withdraw a pending invitation. Stops a pending invitation being accepted. Needs members access. Returns the invitation.

Scope: `lab:write`.

| Argument            | Type |                    |
| ------------------- | ---- | ------------------ |
| `p_workspace_id` *  | uuid | Your workspace id. |
| `p_invitation_id` * | uuid | Invitation id.     |

## Project access

### `project_members`

List the people on a project. Everyone with access to the project and what they can do there.

Scope: `lab:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `project_permissions`

See what you can do on a project. Your own permissions on one project.

Scope: `lab:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `my_project_permissions`

See what you can do on every project. Your permissions on each project you can see.

Scope: `lab:read`.

### `project_access_rules`

List the access rules of a project. The rules that give a person or a group access to the project.

Scope: `lab:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `workspace_project_access_rules`

List the access rules of every project. The access rules of all the projects you can manage.

Scope: `lab:read`.

### `project_access_defaults`

See the workspace’s project access defaults. Whether new projects are private to their lead, the group that can view every project, and whether the client portal is off.

Scope: `lab:read`.

### `set_project_access_defaults`

Set the group that can view every project. Names the group whose members can view every project (null for none). Needs access to manage project settings.

Scope: `lab:write`.

| Argument               | Type |                              |
| ---------------------- | ---- | ---------------------------- |
| `p_qa_view_group_id` * | uuid | The group, or null for none. |

### `grant_project_access`

Give a person access to a project. Adds a person to a project at an access level, with an optional project role (`lead`, `scientist`, `default_reviewer` or `oversight`). Needs to be project lead or an admin. Returns the access rule. Sends `project.access.granted` or `project.access.updated`.

Scope: `lab:write`.

| Argument           | Type |                                                                             |
| ------------------ | ---- | --------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                                          |
| `p_project_id` *   | uuid | Project id.                                                                 |
| `p_user_id` *      | text | The person (their user id).                                                 |
| `p_access_level`   | text | Access level (default `viewer`): `owner`, `editor`, `reviewer` or `viewer`. |
| `p_project_role`   | text | Their role on the project.                                                  |

### `revoke_project_access`

Take a person off a project. Removes a person’s access rule from a project. Needs to be project lead or an admin. Sends `project.access.revoked`.

Scope: `lab:write`.

| Argument           | Type |                             |
| ------------------ | ---- | --------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.          |
| `p_project_id` *   | uuid | Project id.                 |
| `p_user_id` *      | text | The person (their user id). |

### `set_project_member`

Set a person’s access level on a project. Gives a person one access level on a project, replacing what they had. Returns the access rule.

Scope: `lab:write`.

| Argument           | Type |                                                          |
| ------------------ | ---- | -------------------------------------------------------- |
| `p_project_id` *   | uuid | Project id.                                              |
| `p_user_id` *      | text | The person (their user id).                              |
| `p_access_level` * | text | Access level: `owner`, `editor`, `reviewer` or `viewer`. |

### `remove_project_member`

Remove a person from a project. Removes every access rule a person has on the project.

Scope: `lab:write`.

| Argument         | Type |                             |
| ---------------- | ---- | --------------------------- |
| `p_project_id` * | uuid | Project id.                 |
| `p_user_id` *    | text | The person (their user id). |

### `set_project_access_rule`

Give a person or a group exact permissions on a project. Gives a person (`p_user_id`) or a group (`p_group_id`) exactly the permissions named. Needs to be project lead or an admin. Returns the access rule.

Scope: `lab:write`.

| Argument            | Type |                                    |
| ------------------- | ---- | ---------------------------------- |
| `p_project_id` *    | uuid | Project id.                        |
| `p_user_id`         | text | The person; leave out for a group. |
| `p_group_id`        | uuid | The group; leave out for a person. |
| `p_can_view` *      | bool | May see the project.               |
| `p_can_edit` *      | bool | May change work in it.             |
| `p_can_review` *    | bool | May review work in it.             |
| `p_client_portal` * | bool | Sees it in the client portal.      |
| `p_can_manage` *    | bool | May manage who has access.         |

### `remove_project_access_rule`

Remove a project access rule. Removes one rule by its id.

Scope: `lab:write`.

| Argument      | Type |                 |
| ------------- | ---- | --------------- |
| `p_rule_id` * | uuid | Access rule id. |

### `update_project_settings`

Change the review and sharing rules of a project. Whether the project needs an effective protocol, an independent reviewer, and shares approved work with its client automatically. Leave out what stays. Returns the project.

Scope: `lab:write`.

| Argument                         | Type |                                         |
| -------------------------------- | ---- | --------------------------------------- |
| `p_project_id` *                 | uuid | Project id.                             |
| `p_require_effective_protocol`   | bool | Experiments need an effective protocol. |
| `p_require_independent_reviewer` | bool | A different person must review.         |
| `p_auto_share_to_client`         | bool | Share approved work with the client.    |

### `project_access_requests_list`

List requests for edit access. The requests people made to edit a project, with their status.

Scope: `lab:read`.

### `request_project_edit_access`

Ask for edit access to a project. Asks the project’s leads for edit access, with a reason. Returns the request. Sends `project.access.requested`.

Scope: `lab:write`.

| Argument         | Type |                  |
| ---------------- | ---- | ---------------- |
| `p_project_id` * | uuid | Project id.      |
| `p_reason` *     | text | Why you need it. |

### `decide_project_access_request`

Approve or decline a request for edit access. Approving gives the person edit access. Needs to be project lead or an admin. Sends `project.access.request_decided`.

Scope: `lab:write`.

| Argument         | Type |                                        |
| ---------------- | ---- | -------------------------------------- |
| `p_request_id` * | uuid | Request id.                            |
| `p_approve` *    | bool | `true` to approve, `false` to decline. |

## Groups

### `workspace_groups_list`

List the groups and their members. Every group with the user ids of its members.

Scope: `lab:read`.

### `create_workspace_group`

Make a group of people. Makes an empty group, which can then be given access to projects. Needs members access. Returns the group. Sends `workspace.group.created`.

Scope: `lab:write`.

| Argument   | Type |             |
| ---------- | ---- | ----------- |
| `p_name` * | text | Group name. |

### `delete_workspace_group`

Delete a group. Deletes the group and the access rules that named it. Needs members access. Sends `workspace.group.deleted`.

Scope: `lab:write`.

| Argument       | Type |           |
| -------------- | ---- | --------- |
| `p_group_id` * | uuid | Group id. |

### `set_workspace_group_member`

Add a person to a group, or take them out. Needs members access. Sends `workspace.group.member_added` or `workspace.group.member_removed`.

Scope: `lab:write`.

| Argument        | Type |                                   |
| --------------- | ---- | --------------------------------- |
| `p_group_id` *  | uuid | Group id.                         |
| `p_user_id` *   | text | The person (their user id).       |
| `p_is_member` * | bool | `true` to add, `false` to remove. |

## Workspace settings

### `update_workspace_name`

Rename the workspace. Needs access to manage General settings. Returns the workspace. Sends `workspace.renamed`.

Scope: `lab:write`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |
| `p_name` *         | text | The new name.      |

### `update_workspace_general`

Change the site name, time zone and formats. Site, time zone, date format and number format; leave out what stays. Needs access to manage General settings. Returns the settings. Sends `workspace.settings.updated`.

Scope: `lab:write`.

| Argument           | Type |                                          |
| ------------------ | ---- | ---------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                       |
| `p_site`           | text | The site name.                           |
| `p_timezone`       | text | IANA time zone, such as `Europe/London`. |
| `p_date_format`    | text | Date format, such as `d MMM yyyy`.       |
| `p_number_format`  | text | Number format, such as `decimal`.        |

### `update_workspace_settings`

Change registration, review, signature and editing rules. Registration mode, the review workflow, the signature policy, audit retention, editing rules and integration settings; leave out what stays. Needs the matching settings access. Returns the settings. Sends `workspace.settings.updated`.

Scope: `lab:write`.

| Argument                    | Type |                                |
| --------------------------- | ---- | ------------------------------ |
| `p_workspace_id` *          | uuid | Your workspace id.             |
| `p_registration_mode`       | text | Who can join.                  |
| `p_review_workflow_enabled` | bool | Work goes through review.      |
| `p_review_workflow_config`  | json | JSON review workflow settings. |
| `p_signature_policy`        | json | JSON signature policy.         |
| `p_audit_retention_days`    | int  | Days the audit log is kept.    |
| `p_integration_settings`    | json | JSON integration settings.     |
| `p_require_change_reason`   | bool | Changes need a reason.         |
| `p_lock_on_sign`            | bool | Signing locks the record.      |
| `p_allow_offline_editing`   | bool | Allow editing offline.         |

### `update_workspace_id_prefixes`

Change the identifier prefix of each kind of record. A JSON object of kind to prefix, such as `{ "experiment": "EXP" }`. Needs General settings access. Returns the settings.

Scope: `lab:write`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |
| `p_prefixes` *     | json | Kind to prefix.    |

### `update_workspace_publication_policy`

Say whether publishing needs approval. Returns the settings.

Scope: `lab:write`.

| Argument           | Type |                                      |
| ------------------ | ---- | ------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                   |
| `p_required` *     | bool | `true` if publishing needs approval. |

### `update_workspace_data_access_roles`

Choose which roles have data access. The roles that see keys, API routes and database names and can make a read-only SQL login (never `client_viewer`). Returns the settings.

Scope: `lab:write`.

| Argument           | Type   |                    |
| ------------------ | ------ | ------------------ |
| `p_workspace_id` * | uuid   | Your workspace id. |
| `p_roles` *        | text[] | The roles.         |

### `update_workspace_ai_settings`

Change the workspace’s AI settings. Switch AI on or off, the provider profile and model, whether prompts may leave the install, and the limits per call. Needs AI settings access. Returns the settings.

Scope: `lab:write`.

| Argument                   | Type |                                                |
| -------------------------- | ---- | ---------------------------------------------- |
| `p_workspace_id` *         | uuid | Your workspace id.                             |
| `p_enabled` *              | bool | AI is on.                                      |
| `p_provider_profile` *     | text | The provider profile.                          |
| `p_model` *                | text | The model.                                     |
| `p_cloud_egress_enabled` * | bool | Prompts may leave the install.                 |
| `p_max_tokens` *           | int  | Most tokens per call.                          |
| `p_max_cost` *             | int  | Most cost per call, in millionths of a dollar. |

### `update_workspace_ai_feature_flags`

Change which AI features are switched on. A JSON object of switches: `assistant`, `mcp_read`, `mcp_draft`, `mcp_workflow`, `mcp_admin_read`, `mcp_admin_propose`, `mcp_lab`. Needs AI settings access. Returns the settings.

Scope: `lab:write`.

| Argument            | Type |                    |
| ------------------- | ---- | ------------------ |
| `p_workspace_id` *  | uuid | Your workspace id. |
| `p_feature_flags` * | json | The switches.      |

### `set_settings_access`

Set what a role can do in a settings area. The level (`none`, `view` or `manage`) a role has in one settings area. Needs a workspace admin. Returns the rule. Sends `workspace.settings_access.changed`.

Scope: `lab:write`.

| Argument           | Type |                                                                                                                   |
| ------------------ | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                                                                                |
| `p_area` *         | text | The settings area, such as `members`.                                                                             |
| `p_role` *         | text | The role: `owner`, `admin`, `member`, `steward`, `scientist`, `analyst`, `reviewer`, `viewer` or `client_viewer`. |
| `p_level` *        | text | `none`, `view` or `manage`.                                                                                       |

### `settings_access_level`

See your level in a settings area. Returns `none`, `view` or `manage`.

Scope: `lab:read`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |
| `p_area` *         | text | The settings area. |

## Clients and the client portal

### `create_client`

Add a client organisation. The code (CL-001 and so on) is made for you. Needs to be able to write in the workspace. Returns the client. Sends `client.created`.

Scope: `lab:write`.

| Argument   | Type |                                          |
| ---------- | ---- | ---------------------------------------- |
| `p_name` * | text | The client’s name, up to 200 characters. |

### `rename_client`

Rename a client. Returns the client. Sends `client.updated`.

Scope: `lab:write`.

| Argument        | Type |               |
| --------------- | ---- | ------------- |
| `p_client_id` * | uuid | Client id.    |
| `p_name` *      | text | The new name. |

### `set_client_archived`

Archive a client, or bring it back. Returns the client. Sends `client.archived` or `client.restored`.

Scope: `lab:write`.

| Argument        | Type |                                        |
| --------------- | ---- | -------------------------------------- |
| `p_client_id` * | uuid | Client id.                             |
| `p_archived` *  | bool | `true` to archive, `false` to restore. |

### `share_record_with_client`

Share an approved record with a client’s portal. Shows an approved record in the client’s portal. Returns the share. Sends `client.record_shared`.

Scope: `lab:write`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_client_id` * | uuid | Client id. |
| `p_record_id` * | uuid | Record id. |

### `unshare_record_with_client`

Take a record out of a client’s portal. Sends `client.record_unshared`.

Scope: `lab:write`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_client_id` * | uuid | Client id. |
| `p_record_id` * | uuid | Record id. |

### `record_client_sharing`

See how a record is shared with its client. The record’s client, whether its project shares automatically, and when and by whom it was shared.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `post_client_portal_message`

Post a message in a client’s portal. Posts to the client (optionally about one project). A client viewer posts in their own portal. Returns the message. Sends `client.message_posted`.

Scope: `lab:write`.

| Argument        | Type |                          |
| --------------- | ---- | ------------------------ |
| `p_client_id` * | uuid | Client id.               |
| `p_project_id`  | uuid | The project it is about. |
| `p_body`        | text | The message.             |

### `set_study_task_client_visible`

Show a study task in the client portal, or hide it. Returns the task.

Scope: `lab:write`.

| Argument                        | Type |                              |
| ------------------------------- | ---- | ---------------------------- |
| `p_task_id` *                   | uuid | Study task id.               |
| `p_expected_metadata_version` * | int  | The task’s version you read. |
| `p_client_visible` *            | bool | `true` to show.              |
| `p_reason`                      | text | Why.                         |

### `client_portal_identity`

See which client portal you belong to. For a client viewer: their client and workspace.

Scope: `lab:read`.

### `client_portal_projects`

List the projects in your client portal. What a client viewer sees.

Scope: `lab:read`.

### `client_portal_records`

List the records shared in your client portal. What a client viewer sees.

Scope: `lab:read`.

### `client_portal_reports`

List the reports shared in your client portal. What a client viewer sees.

Scope: `lab:read`.

### `client_portal_messages`

Read the messages in a client’s portal. A client viewer reads their own; staff name the client.

Scope: `lab:read`.

| Argument      | Type |            |
| ------------- | ---- | ---------- |
| `p_client_id` | uuid | Client id. |

### `client_portal_milestones`

List the milestones of a portal project. What a client viewer sees for one project.

Scope: `lab:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `client_portal_record_document`

Read a record shared in your client portal. The record as the client sees it.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `client_portal_preview_projects`

See the projects a client’s portal shows. For staff: what the client would see.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_client_id` * | uuid | Client id. |

### `client_portal_preview_records`

See the records a client’s portal shows. For staff: what the client would see.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_client_id` * | uuid | Client id. |

## SQL views

A steward with a personal SQL login can read the same information in SQL. Each view is in the `data` schema, covers one workspace and shows only the rows the login's member may read.

| View                      | What it holds                                                                 |
| ------------------------- | ----------------------------------------------------------------------------- |
| `members`                 | Who is in the workspace: role, whether suspended, client for a client viewer. |
| `invitations`             | Invitations and their status. The link is never kept, so it is not here.      |
| `project_access`          | Who has what access to each project, per person or group.                     |
| `access_requests`         | Requests for edit access and how each was decided.                            |
| `groups`, `group_members` | Groups and who is in them.                                                    |
| `settings_access`         | What each role can do in each settings area.                                  |
| `clients`                 | Client organisations.                                                         |
| `client_shares`           | Which approved records each client sees in its portal.                        |
| `portal_messages`         | Messages between staff and a client.                                          |

If another workspace already holds a plain name, yours is suffixed with six characters of your workspace id (for example `members_a1b2c3`).
