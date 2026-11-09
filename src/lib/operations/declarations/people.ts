/**
 * People and the workspace: members, invitations, project access, groups,
 * workspace settings and the client portal. One declaration gives each its
 * public API entry (token allowlist, OpenAPI, docs, SDK), the MCP action, the
 * pipeline action and, where it has one, the assistant card name. The webhook
 * events they produce are in the event catalogue (`event-catalogue.ts`).
 *
 * Every call acts as the person the token belongs to, and the database still
 * decides what that person may do (members access, project lead, writer).
 */
import { defineOperations, input } from '../descriptor'
import type { OperationInput } from '../descriptor'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

const workspace = () => note('p_workspace_id', 'uuid', 'Your workspace id.')
const userId = (text = 'The person (their user id).') =>
  note('p_user_id', 'text', text)
const project = () => note('p_project_id', 'uuid', 'Project id.')
const ROLES =
  '`owner`, `admin`, `member`, `steward`, `scientist`, `analyst`, `reviewer`, `viewer` or `client_viewer`.'
const LEVELS = '`owner`, `editor`, `reviewer` or `viewer`.'
const people = (tool: string) => ({
  tool,
  presentation: 'card' as const,
  vocabulary: 'propose' as const,
})

export const PEOPLE_OPERATIONS = defineOperations([
  // -- members ---------------------------------------------------------------
  {
    name: 'workspace_members_list',
    label: 'List the members',
    summary: 'List the members of the workspace',
    description:
      'Every member with their name, role and, for a client viewer, the client they belong to.',
    kind: 'read',
    inputs: [],
    result:
      'rows:user_id=text,name=text,role=text,client_id=uuid,client_name=text',
  },
  {
    name: 'workspace_member_status',
    label: 'See when members were last active',
    summary: 'See when each member was last active',
    description:
      'Last activity and how many trainings each member must do and has overdue. For people who manage members.',
    kind: 'read',
    inputs: [],
    result:
      'rows:user_id=text,last_active_at=ts,training_required=bigint,training_overdue=bigint',
  },
  {
    name: 'list_workspace_sessions',
    label: 'List signed-in sessions',
    summary: 'List the signed-in sessions of the members',
    description:
      'Each open session: who, from where, when it started and when it ends. Needs members access. Returns a list of `{ id, user_id, user_name, ip_address, user_agent, created_at, expires_at }`.',
    kind: 'read',
    inputs: [workspace()],
    result: 'json',
  },
  {
    name: 'revoke_user_session',
    label: 'Sign a session out',
    summary: 'Sign one session out',
    description:
      'Ends one open session of a member of this workspace. Needs members access.',
    kind: 'write',
    inputs: [workspace(), note('p_session_id', 'text', 'The session id.')],
    result: 'json',
    pipeline: {},
  },
  {
    name: 'change_member_role',
    label: 'Change a member’s role',
    summary: 'Change a member’s role',
    description:
      'Gives a member a new role. A client viewer needs a client; no one else may have one. Only an admin changes an owner, you cannot change your own role and the last owner cannot be demoted. Needs members access. Returns the membership. Sends `member.role_changed`.',
    kind: 'write',
    inputs: [
      workspace(),
      userId(),
      note('p_new_role', 'text', `The new role: ${ROLES}`),
      note(
        'p_client_id',
        'uuid',
        'The client, for a client viewer.',
        false,
        true,
      ),
    ],
    result: 'row:workspace_memberships',
    assistant: people('sheetbase.member.set_role'),
    pipeline: {},
  },
  {
    name: 'suspend_member',
    label: 'Suspend a member',
    summary: 'Suspend a member',
    description:
      'Switches a member off without removing them or their work. Not yourself, and not the last owner. Needs members access. Sends `member.suspended`.',
    kind: 'write',
    inputs: [workspace(), userId()],
    result: 'row:workspace_memberships',
    assistant: people('sheetbase.member.suspend'),
    pipeline: {},
  },
  {
    name: 'reinstate_member',
    label: 'Reinstate a member',
    summary: 'Switch a suspended member back on',
    description:
      'Lifts a suspension. Needs members access. Sends `member.reinstated`.',
    kind: 'write',
    inputs: [workspace(), userId()],
    result: 'row:workspace_memberships',
    assistant: people('sheetbase.member.reinstate'),
    pipeline: {},
  },
  {
    name: 'remove_member',
    label: 'Remove a member',
    summary: 'Remove a member from the workspace',
    description:
      'Takes a person out of the workspace. Their work stays. Not yourself, and not the last owner. Needs members access. Sends `member.removed`.',
    kind: 'write',
    inputs: [workspace(), userId()],
    result: 'void',
    assistant: people('sheetbase.member.remove'),
    pipeline: {},
  },
  {
    name: 'set_member_username',
    label: 'Set a member’s username',
    summary: 'Set a member’s username',
    description:
      'A username is 3 to 40 letters, numbers, dots, dashes or underscores, and unique in the workspace. Leave it out to clear it. Needs members access. Returns the membership.',
    kind: 'write',
    inputs: [
      workspace(),
      userId(),
      note('p_username', 'text', 'The username; null clears it.', true, true),
    ],
    result: 'row:workspace_memberships',
    pipeline: {},
  },
  // -- invitations -----------------------------------------------------------
  {
    name: 'create_invitation',
    label: 'Invite someone',
    summary: 'Invite someone to the workspace',
    description:
      'Makes an invitation for an email address with a role, optionally for a client (client viewers) and with projects the person joins on accepting: `[{ "project_id": "…", "access_level": "viewer" }]`. Returns the invitation and its one-time `token`; the link is `/accept-invitation?token=<token>`. The token is shown once and never stored, so keep it or reissue. Needs members access. Sends `workspace.invitation.created`. In a pipeline the token is left out of the step output.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_email', 'text', 'Who to invite.'),
      note(
        'p_role',
        'text',
        `Their role (default \`member\`): ${ROLES}`,
        false,
      ),
      note(
        'p_expires_after_days',
        'int',
        'Days the link works (default 7).',
        false,
      ),
      note(
        'p_client_id',
        'uuid',
        'The client, for a client viewer.',
        false,
        true,
      ),
      note(
        'p_project_grants',
        'json',
        'JSON list of `{ project_id, access_level }` the person joins on accepting.',
        false,
      ),
    ],
    result: 'json',
    assistant: people('sheetbase.member.invite'),
    pipeline: { omitFromResult: ['token'] },
  },
  {
    name: 'reissue_invitation',
    label: 'Send an invitation again',
    summary: 'Give an invitation a new link',
    description:
      'Replaces the link of a pending or expired invitation; the old link stops working. Returns the invitation and its new one-time `token`. Needs members access. In a pipeline the token is left out of the step output.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_invitation_id', 'uuid', 'Invitation id.'),
      note(
        'p_expires_after_days',
        'int',
        'Days the link works (default 7).',
        false,
      ),
    ],
    result: 'json',
    pipeline: { omitFromResult: ['token'] },
  },
  {
    name: 'revoke_invitation',
    label: 'Withdraw an invitation',
    summary: 'Withdraw a pending invitation',
    description:
      'Stops a pending invitation being accepted. Needs members access. Returns the invitation.',
    kind: 'write',
    inputs: [workspace(), note('p_invitation_id', 'uuid', 'Invitation id.')],
    result: 'row:workspace_invitations',
    assistant: people('sheetbase.invitation.revoke'),
    pipeline: {},
  },
  // -- project access --------------------------------------------------------
  {
    name: 'project_members',
    label: 'List who is on a project',
    summary: 'List the people on a project',
    description:
      'Everyone with access to the project and what they can do there.',
    kind: 'read',
    inputs: [project()],
    result:
      'rows:user_id=text,name=text,access_level=text,workspace_role=text,project_role=text,is_lead=bool,added_at=ts,can_view=bool,can_edit=bool,can_review=bool,client_portal=bool,can_manage=bool',
  },
  {
    name: 'project_permissions',
    label: 'See what I can do on a project',
    summary: 'See what you can do on a project',
    description: 'Your own permissions on one project.',
    kind: 'read',
    inputs: [project()],
    result:
      'rows:can_view=bool,can_edit=bool,can_review=bool,client_portal=bool,can_manage=bool',
  },
  {
    name: 'my_project_permissions',
    label: 'See what I can do on every project',
    summary: 'See what you can do on every project',
    description: 'Your permissions on each project you can see.',
    kind: 'read',
    inputs: [],
    result:
      'rows:project_id=uuid,can_view=bool,can_edit=bool,can_review=bool,client_portal=bool,can_manage=bool,access_level=text',
  },
  {
    name: 'project_access_rules',
    label: 'List the access rules of a project',
    summary: 'List the access rules of a project',
    description:
      'The rules that give a person or a group access to the project.',
    kind: 'read',
    inputs: [project()],
    result:
      'rows:id=uuid,project_id=uuid,user_id=text,group_id=uuid,principal_name=text,can_view=bool,can_edit=bool,can_review=bool,client_portal=bool,can_manage=bool',
  },
  {
    name: 'workspace_project_access_rules',
    label: 'List every project access rule',
    summary: 'List the access rules of every project',
    description: 'The access rules of all the projects you can manage.',
    kind: 'read',
    inputs: [],
    result:
      'rows:id=uuid,project_id=uuid,user_id=text,group_id=uuid,principal_name=text,can_view=bool,can_edit=bool,can_review=bool,client_portal=bool,can_manage=bool',
  },
  {
    name: 'project_access_defaults',
    label: 'See the project access defaults',
    summary: 'See the workspace’s project access defaults',
    description:
      'Whether new projects are private to their lead, the group that can view every project, and whether the client portal is off.',
    kind: 'read',
    inputs: [],
    result:
      'rows:private_to_lead=bool,qa_view_group_id=uuid,client_portal_off=bool',
  },
  {
    name: 'set_project_access_defaults',
    label: 'Set the project access defaults',
    summary: 'Set the group that can view every project',
    description:
      'Names the group whose members can view every project (null for none). Needs access to manage project settings.',
    kind: 'write',
    inputs: [
      note(
        'p_qa_view_group_id',
        'uuid',
        'The group, or null for none.',
        true,
        true,
      ),
    ],
    result: 'void',
    pipeline: {},
  },
  {
    name: 'grant_project_access',
    label: 'Give someone access to a project',
    summary: 'Give a person access to a project',
    description:
      'Adds a person to a project at an access level, with an optional project role (`lead`, `scientist`, `default_reviewer` or `oversight`). Needs to be project lead or an admin. Returns the access rule. Sends `project.access.granted` or `project.access.updated`.',
    kind: 'write',
    inputs: [
      workspace(),
      project(),
      userId(),
      note(
        'p_access_level',
        'text',
        `Access level (default \`viewer\`): ${LEVELS}`,
        false,
      ),
      note('p_project_role', 'text', 'Their role on the project.', false, true),
    ],
    result: 'row:project_access',
    assistant: people('sheetbase.project_access.grant'),
    pipeline: {},
  },
  {
    name: 'revoke_project_access',
    label: 'Take someone off a project',
    summary: 'Take a person off a project',
    description:
      'Removes a person’s access rule from a project. Needs to be project lead or an admin. Sends `project.access.revoked`.',
    kind: 'write',
    inputs: [workspace(), project(), userId()],
    result: 'void',
    assistant: people('sheetbase.project_access.revoke'),
    pipeline: {},
  },
  {
    name: 'set_project_member',
    label: 'Set a person’s access level on a project',
    summary: 'Set a person’s access level on a project',
    description:
      'Gives a person one access level on a project, replacing what they had. Returns the access rule.',
    kind: 'write',
    inputs: [
      project(),
      userId(),
      note('p_access_level', 'text', `Access level: ${LEVELS}`),
    ],
    result: 'row:project_access',
    pipeline: {},
  },
  {
    name: 'remove_project_member',
    label: 'Remove a person from a project',
    summary: 'Remove a person from a project',
    description: 'Removes every access rule a person has on the project.',
    kind: 'write',
    inputs: [project(), userId()],
    result: 'void',
    pipeline: {},
  },
  {
    name: 'set_project_access_rule',
    label: 'Set a project access rule',
    summary: 'Give a person or a group exact permissions on a project',
    description:
      'Gives a person (`p_user_id`) or a group (`p_group_id`) exactly the permissions named. Needs to be project lead or an admin. Returns the access rule.',
    kind: 'write',
    inputs: [
      project(),
      note(
        'p_user_id',
        'text',
        'The person; leave out for a group.',
        false,
        true,
      ),
      note(
        'p_group_id',
        'uuid',
        'The group; leave out for a person.',
        false,
        true,
      ),
      note('p_can_view', 'bool', 'May see the project.'),
      note('p_can_edit', 'bool', 'May change work in it.'),
      note('p_can_review', 'bool', 'May review work in it.'),
      note('p_client_portal', 'bool', 'Sees it in the client portal.'),
      note('p_can_manage', 'bool', 'May manage who has access.'),
    ],
    result: 'row:project_access',
    pipeline: {},
  },
  {
    name: 'remove_project_access_rule',
    label: 'Remove a project access rule',
    summary: 'Remove a project access rule',
    description: 'Removes one rule by its id.',
    kind: 'write',
    inputs: [note('p_rule_id', 'uuid', 'Access rule id.')],
    result: 'void',
    pipeline: {},
  },
  {
    name: 'update_project_settings',
    label: 'Change a project’s rules',
    summary: 'Change the review and sharing rules of a project',
    description:
      'Whether the project needs an effective protocol, an independent reviewer, and shares approved work with its client automatically. Leave out what stays. Returns the project.',
    kind: 'write',
    inputs: [
      project(),
      note(
        'p_require_effective_protocol',
        'bool',
        'Experiments need an effective protocol.',
        false,
        true,
      ),
      note(
        'p_require_independent_reviewer',
        'bool',
        'A different person must review.',
        false,
        true,
      ),
      note(
        'p_auto_share_to_client',
        'bool',
        'Share approved work with the client.',
        false,
        true,
      ),
    ],
    result: 'row:projects',
    pipeline: {},
  },
  {
    name: 'project_access_requests_list',
    label: 'List requests for edit access',
    summary: 'List requests for edit access',
    description:
      'The requests people made to edit a project, with their status.',
    kind: 'read',
    inputs: [],
    result:
      'rows:id=uuid,project_id=uuid,user_id=text,name=text,reason=text,status=text,created_at=ts',
  },
  {
    name: 'request_project_edit_access',
    label: 'Ask for edit access to a project',
    summary: 'Ask for edit access to a project',
    description:
      'Asks the project’s leads for edit access, with a reason. Returns the request. Sends `project.access.requested`.',
    kind: 'write',
    inputs: [project(), note('p_reason', 'text', 'Why you need it.')],
    result: 'row:project_access_requests',
    pipeline: {},
  },
  {
    name: 'decide_project_access_request',
    label: 'Decide a request for edit access',
    summary: 'Approve or decline a request for edit access',
    description:
      'Approving gives the person edit access. Needs to be project lead or an admin. Sends `project.access.request_decided`.',
    kind: 'write',
    inputs: [
      note('p_request_id', 'uuid', 'Request id.'),
      note('p_approve', 'bool', '`true` to approve, `false` to decline.'),
    ],
    result: 'void',
    assistant: people('sheetbase.project_access.decide'),
    pipeline: {},
  },
  // -- groups ----------------------------------------------------------------
  {
    name: 'workspace_groups_list',
    label: 'List the groups',
    summary: 'List the groups and their members',
    description: 'Every group with the user ids of its members.',
    kind: 'read',
    inputs: [],
    result: 'rows:id=uuid,name=text,member_ids=text[]',
  },
  {
    name: 'create_workspace_group',
    label: 'Make a group',
    summary: 'Make a group of people',
    description:
      'Makes an empty group, which can then be given access to projects. Needs members access. Returns the group. Sends `workspace.group.created`.',
    kind: 'write',
    inputs: [note('p_name', 'text', 'Group name.')],
    result: 'row:workspace_groups',
    assistant: people('sheetbase.group.create'),
    pipeline: {},
  },
  {
    name: 'delete_workspace_group',
    label: 'Delete a group',
    summary: 'Delete a group',
    description:
      'Deletes the group and the access rules that named it. Needs members access. Sends `workspace.group.deleted`.',
    kind: 'write',
    inputs: [note('p_group_id', 'uuid', 'Group id.')],
    result: 'void',
    pipeline: {},
  },
  {
    name: 'set_workspace_group_member',
    label: 'Add or remove a group member',
    summary: 'Add a person to a group, or take them out',
    description:
      'Needs members access. Sends `workspace.group.member_added` or `workspace.group.member_removed`.',
    kind: 'write',
    inputs: [
      note('p_group_id', 'uuid', 'Group id.'),
      userId(),
      note('p_is_member', 'bool', '`true` to add, `false` to remove.'),
    ],
    result: 'void',
    assistant: people('sheetbase.group.set_member'),
    pipeline: {},
  },
  // -- settings --------------------------------------------------------------
  {
    name: 'update_workspace_name',
    label: 'Rename the workspace',
    summary: 'Rename the workspace',
    description:
      'Needs access to manage General settings. Returns the workspace. Sends `workspace.renamed`.',
    kind: 'write',
    inputs: [workspace(), note('p_name', 'text', 'The new name.')],
    result: 'row:workspaces',
    assistant: people('sheetbase.workspace.rename'),
    pipeline: {},
  },
  {
    name: 'update_workspace_general',
    label: 'Change the general settings',
    summary: 'Change the site name, time zone and formats',
    description:
      'Site, time zone, date format and number format; leave out what stays. Needs access to manage General settings. Returns the settings. Sends `workspace.settings.updated`.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_site', 'text', 'The site name.', false, true),
      note(
        'p_timezone',
        'text',
        'IANA time zone, such as `Europe/London`.',
        false,
        true,
      ),
      note(
        'p_date_format',
        'text',
        'Date format, such as `d MMM yyyy`.',
        false,
        true,
      ),
      note(
        'p_number_format',
        'text',
        'Number format, such as `decimal`.',
        false,
        true,
      ),
    ],
    result: 'row:workspace_settings',
    assistant: people('sheetbase.workspace.general'),
    pipeline: {},
  },
  {
    name: 'update_workspace_settings',
    label: 'Change the workspace rules',
    summary: 'Change registration, review, signature and editing rules',
    description:
      'Registration mode, the review workflow, the signature policy, audit retention, editing rules and integration settings; leave out what stays. Needs the matching settings access. Returns the settings. Sends `workspace.settings.updated`.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_registration_mode', 'text', 'Who can join.', false, true),
      note(
        'p_review_workflow_enabled',
        'bool',
        'Work goes through review.',
        false,
        true,
      ),
      note(
        'p_review_workflow_config',
        'json',
        'JSON review workflow settings.',
        false,
        true,
      ),
      note('p_signature_policy', 'json', 'JSON signature policy.', false, true),
      note(
        'p_audit_retention_days',
        'int',
        'Days the audit log is kept.',
        false,
        true,
      ),
      note(
        'p_integration_settings',
        'json',
        'JSON integration settings.',
        false,
        true,
      ),
      note(
        'p_require_change_reason',
        'bool',
        'Changes need a reason.',
        false,
        true,
      ),
      note('p_lock_on_sign', 'bool', 'Signing locks the record.', false, true),
      note(
        'p_allow_offline_editing',
        'bool',
        'Allow editing offline.',
        false,
        true,
      ),
    ],
    result: 'row:workspace_settings',
    pipeline: {},
  },
  {
    name: 'update_workspace_id_prefixes',
    label: 'Change the identifier prefixes',
    summary: 'Change the identifier prefix of each kind of record',
    description:
      'A JSON object of kind to prefix, such as `{ "experiment": "EXP" }`. Needs General settings access. Returns the settings.',
    kind: 'write',
    inputs: [workspace(), note('p_prefixes', 'json', 'Kind to prefix.')],
    result: 'row:workspace_settings',
    pipeline: {},
  },
  {
    name: 'update_workspace_publication_policy',
    label: 'Require approval to publish',
    summary: 'Say whether publishing needs approval',
    description: 'Returns the settings.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_required', 'bool', '`true` if publishing needs approval.'),
    ],
    result: 'row:workspace_settings',
    pipeline: {},
  },
  {
    name: 'update_workspace_data_access_roles',
    label: 'Choose who has data access',
    summary: 'Choose which roles have data access',
    description:
      'The roles that see keys, API routes and database names and can make a read-only SQL login (never `client_viewer`). Returns the settings.',
    kind: 'write',
    inputs: [workspace(), note('p_roles', 'text[]', 'The roles.')],
    result: 'row:workspace_settings',
    pipeline: {},
  },
  {
    name: 'update_workspace_ai_settings',
    label: 'Change the AI settings',
    summary: 'Change the workspace’s AI settings',
    description:
      'Switch AI on or off, the provider profile and model, whether prompts may leave the install, and the limits per call. Needs AI settings access. Returns the settings.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_enabled', 'bool', 'AI is on.'),
      note('p_provider_profile', 'text', 'The provider profile.', true, true),
      note('p_model', 'text', 'The model.'),
      note('p_cloud_egress_enabled', 'bool', 'Prompts may leave the install.'),
      note('p_max_tokens', 'int', 'Most tokens per call.'),
      note(
        'p_max_cost',
        'int',
        'Most cost per call, in millionths of a dollar.',
      ),
    ],
    result: 'row:workspace_settings',
    pipeline: {},
  },
  {
    name: 'update_workspace_ai_feature_flags',
    label: 'Change what agents may use',
    summary: 'Change which AI features are switched on',
    description:
      'A JSON object of switches: `assistant`, `mcp_read`, `mcp_draft`, `mcp_workflow`, `mcp_admin_read`, `mcp_admin_propose`, `mcp_lab`. Needs AI settings access. Returns the settings.',
    kind: 'write',
    inputs: [workspace(), note('p_feature_flags', 'json', 'The switches.')],
    result: 'row:workspace_settings',
    pipeline: {},
  },
  {
    name: 'set_settings_access',
    label: 'Set who can open a settings area',
    summary: 'Set what a role can do in a settings area',
    description:
      'The level (`none`, `view` or `manage`) a role has in one settings area. Needs a workspace admin. Returns the rule. Sends `workspace.settings_access.changed`.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_area', 'text', 'The settings area, such as `members`.'),
      note('p_role', 'text', `The role: ${ROLES}`),
      note('p_level', 'text', '`none`, `view` or `manage`.'),
    ],
    result: 'row:settings_access',
    pipeline: {},
  },
  {
    name: 'settings_access_level',
    label: 'See my level in a settings area',
    summary: 'See your level in a settings area',
    description: 'Returns `none`, `view` or `manage`.',
    kind: 'read',
    inputs: [workspace(), note('p_area', 'text', 'The settings area.')],
    result: 'text',
  },
  // -- clients and the client portal ----------------------------------------
  {
    name: 'create_client',
    label: 'Add a client',
    summary: 'Add a client organisation',
    description:
      'The code (CL-001 and so on) is made for you. Needs to be able to write in the workspace. Returns the client. Sends `client.created`.',
    kind: 'write',
    inputs: [
      note('p_name', 'text', 'The client’s name, up to 200 characters.'),
    ],
    result: 'row:clients',
    assistant: people('sheetbase.client.create'),
    pipeline: {},
  },
  {
    name: 'rename_client',
    label: 'Rename a client',
    summary: 'Rename a client',
    description: 'Returns the client. Sends `client.updated`.',
    kind: 'write',
    inputs: [
      note('p_client_id', 'uuid', 'Client id.'),
      note('p_name', 'text', 'The new name.'),
    ],
    result: 'row:clients',
    pipeline: {},
  },
  {
    name: 'set_client_archived',
    label: 'Archive or restore a client',
    summary: 'Archive a client, or bring it back',
    description:
      'Returns the client. Sends `client.archived` or `client.restored`.',
    kind: 'write',
    inputs: [
      note('p_client_id', 'uuid', 'Client id.'),
      note('p_archived', 'bool', '`true` to archive, `false` to restore.'),
    ],
    result: 'row:clients',
    pipeline: {},
  },
  {
    name: 'share_record_with_client',
    label: 'Share a record with a client',
    summary: 'Share an approved record with a client’s portal',
    description:
      'Shows an approved record in the client’s portal. Returns the share. Sends `client.record_shared`.',
    kind: 'write',
    inputs: [
      note('p_client_id', 'uuid', 'Client id.'),
      note('p_record_id', 'uuid', 'Record id.'),
    ],
    result: 'row:client_portal_shares',
    assistant: people('sheetbase.client.share_record'),
    pipeline: {},
  },
  {
    name: 'unshare_record_with_client',
    label: 'Stop sharing a record with a client',
    summary: 'Take a record out of a client’s portal',
    description: 'Sends `client.record_unshared`.',
    kind: 'write',
    inputs: [
      note('p_client_id', 'uuid', 'Client id.'),
      note('p_record_id', 'uuid', 'Record id.'),
    ],
    result: 'void',
    assistant: people('sheetbase.client.unshare_record'),
    pipeline: {},
  },
  {
    name: 'record_client_sharing',
    label: 'See how a record is shared with its client',
    summary: 'See how a record is shared with its client',
    description:
      'The record’s client, whether its project shares automatically, and when and by whom it was shared.',
    kind: 'read',
    inputs: [note('p_record_id', 'uuid', 'Record id.')],
    result:
      'rows:record_status=text,project_id=uuid,client_id=uuid,client_code=text,client_name=text,auto_share=bool,shared_at=ts,shared_by_name=text,can_manage=bool',
  },
  {
    name: 'post_client_portal_message',
    label: 'Message a client',
    summary: 'Post a message in a client’s portal',
    description:
      'Posts to the client (optionally about one project). A client viewer posts in their own portal. Returns the message. Sends `client.message_posted`.',
    kind: 'write',
    inputs: [
      note('p_client_id', 'uuid', 'Client id.'),
      note('p_project_id', 'uuid', 'The project it is about.', false, true),
      note('p_body', 'text', 'The message.', false, true),
    ],
    result: 'row:client_portal_messages',
    pipeline: {},
  },
  {
    name: 'set_study_task_client_visible',
    label: 'Show a study task to the client',
    summary: 'Show a study task in the client portal, or hide it',
    description: 'Returns the task.',
    kind: 'write',
    inputs: [
      note('p_task_id', 'uuid', 'Study task id.'),
      note(
        'p_expected_metadata_version',
        'int',
        'The task’s version you read.',
      ),
      note('p_client_visible', 'bool', '`true` to show.'),
      note('p_reason', 'text', 'Why.', false, true),
    ],
    result: 'json',
    pipeline: {},
  },
  {
    name: 'client_portal_identity',
    label: 'See my client portal',
    summary: 'See which client portal you belong to',
    description: 'For a client viewer: their client and workspace.',
    kind: 'read',
    inputs: [],
    result: 'json',
  },
  {
    name: 'client_portal_projects',
    label: 'List the portal projects',
    summary: 'List the projects in your client portal',
    description: 'What a client viewer sees.',
    kind: 'read',
    inputs: [],
    result:
      'rows:project_id=uuid,display_id=text,title=text,stage=text,status=text,modality=text,lead_name=text,last_update=ts,client_name=text,client_code=text',
  },
  {
    name: 'client_portal_records',
    label: 'List the portal records',
    summary: 'List the records shared in your client portal',
    description: 'What a client viewer sees.',
    kind: 'read',
    inputs: [],
    result:
      'rows:record_id=uuid,identifier=text,title=text,kind=text,status=text,project_id=uuid,shared_at=ts,approved_at=ts,approved_by_name=text',
  },
  {
    name: 'client_portal_reports',
    label: 'List the portal reports',
    summary: 'List the reports shared in your client portal',
    description: 'What a client viewer sees.',
    kind: 'read',
    inputs: [],
    result:
      'rows:record_id=uuid,identifier=text,title=text,covers=text,shared_at=ts',
  },
  {
    name: 'client_portal_messages',
    label: 'Read the portal messages',
    summary: 'Read the messages in a client’s portal',
    description: 'A client viewer reads their own; staff name the client.',
    kind: 'read',
    inputs: [note('p_client_id', 'uuid', 'Client id.', false, true)],
    result:
      'rows:id=uuid,client_id=uuid,project_id=uuid,author_kind=text,author_user_id=text,author_name=text,body=text,created_at=ts',
  },
  {
    name: 'client_portal_milestones',
    label: 'List the milestones of a portal project',
    summary: 'List the milestones of a portal project',
    description: 'What a client viewer sees for one project.',
    kind: 'read',
    inputs: [project()],
    result:
      'rows:milestone_id=uuid,title=text,status=text,due_at=ts,sort_position=int',
  },
  {
    name: 'client_portal_record_document',
    label: 'Read a shared record',
    summary: 'Read a record shared in your client portal',
    description: 'The record as the client sees it.',
    kind: 'read',
    inputs: [note('p_record_id', 'uuid', 'Record id.')],
    result: 'json',
  },
  {
    name: 'client_portal_preview_projects',
    label: 'Preview a client’s portal projects',
    summary: 'See the projects a client’s portal shows',
    description: 'For staff: what the client would see.',
    kind: 'read',
    inputs: [note('p_client_id', 'uuid', 'Client id.')],
    result:
      'rows:project_id=uuid,display_id=text,title=text,stage=text,status=text,modality=text,lead_name=text,last_update=ts,client_name=text,client_code=text',
  },
  {
    name: 'client_portal_preview_records',
    label: 'Preview a client’s portal records',
    summary: 'See the records a client’s portal shows',
    description: 'For staff: what the client would see.',
    kind: 'read',
    inputs: [note('p_client_id', 'uuid', 'Client id.')],
    result:
      'rows:record_id=uuid,identifier=text,title=text,kind=text,status=text,project_id=uuid,shared_at=ts,approved_at=ts,approved_by_name=text',
  },
])
