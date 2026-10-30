/**
 * ADMIN-001 — workspace permissions and administration domain model.
 *
 * Wire mappers, typed wrappers around the workspace administration RPCs
 * (migration 0054), and error-code mapping. PostgreSQL and RLS remain the
 * authoritative access-control boundary; these helpers drive the UI,
 * normalise wire shapes and map RPC error codes to actionable messages.
 *
 * The settings, invitations, sessions, project access and audit export paths
 * are owner-only at the database level. The UI gates on the current user's
 * role but does not assume enforcement — every mutation is a controlled RPC.
 */
import type { DataClient } from './data-client'
import { DataClientError } from './data-client'
import { getDisplayTimeZone } from './display-time-zone'
import type { AuditEventWire } from './audit-history'
import { now as appNow } from '#/lib/clock'

export type JsonObject = Record<string, unknown>

export type WorkspaceRole =
  | 'owner'
  | 'admin'
  | 'member'
  | 'steward'
  | 'scientist'
  | 'analyst'
  | 'reviewer'
  | 'viewer'
  /** ADR-0049: an external client viewer, scoped to one client's portal. */
  | 'client_viewer'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'
export type RegistrationMode = 'open' | 'invitation_only'
export type ProjectAccessLevel = 'owner' | 'editor' | 'viewer'
/** What an invitation can grant on a project: the levels a member can hold. */
export type InvitedProjectLevel = 'owner' | 'editor' | 'reviewer' | 'viewer'

/** A project an invitation adds the person to once it is accepted. */
export interface InvitationProjectGrant {
  project_id: string
  access_level: InvitedProjectLevel
}

export interface WorkspaceMemberWire {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  client_id?: string | null
  suspended_at: string | null
  username?: string | null
  created_at: string
  updated_at: string
}

export interface WorkspaceInvitationWire {
  id: string
  workspace_id: string
  email: string
  role: WorkspaceRole
  client_id?: string | null
  project_grants?: InvitationProjectGrant[]
  status: InvitationStatus
  expires_at: string
  accepted_at: string | null
  accepted_by_user_id: string | null
  revoked_at: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export type InstrumentGateMode = 'off' | 'warn' | 'block'

export interface WorkspaceSettingsWire {
  id: string
  workspace_id: string
  registration_mode: RegistrationMode
  review_workflow_enabled: boolean
  review_workflow_config: JsonObject
  signature_policy: JsonObject
  audit_retention_days: number
  integration_settings: JsonObject
  /** Absent on older fixtures; the database default is `warn`. */
  instrument_gate_mode?: InstrumentGateMode
  /** Absent on older fixtures; the database default is off. */
  regulated_lab?: boolean
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export interface ProjectAccessWire {
  id: string
  workspace_id: string
  project_id: string
  user_id: string
  access_level: ProjectAccessLevel
  granted_by_user_id: string
  created_at: string
  updated_at: string
}

export interface WorkspaceSessionWire {
  id: string
  user_id: string
  user_name: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
  expires_at: string
}

export interface WorkspaceMember {
  id: string
  workspaceId: string
  userId: string
  role: WorkspaceRole
  clientId?: string | null
  suspendedAt: string | null
  username?: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceInvitation {
  id: string
  workspaceId: string
  email: string
  role: WorkspaceRole
  clientId?: string | null
  projectGrants: InvitationProjectGrant[]
  status: InvitationStatus
  expiresAt: string
  acceptedAt: string | null
  acceptedByUserId: string | null
  revokedAt: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceSettings {
  id: string
  workspaceId: string
  registrationMode: RegistrationMode
  reviewWorkflowEnabled: boolean
  reviewWorkflowConfig: JsonObject
  signaturePolicy: JsonObject
  auditRetentionDays: number
  integrationSettings: JsonObject
  /** What happens when an instrument that is overdue, retired or not
   * qualified for the person takes new data. */
  instrumentGateMode: InstrumentGateMode
  /** Whether the lab runs by regulated-lab rules. */
  regulatedLab: boolean
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface ProjectAccess {
  id: string
  workspaceId: string
  projectId: string
  userId: string
  accessLevel: ProjectAccessLevel
  grantedByUserId: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceSession {
  id: string
  userId: string
  userName: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  expiresAt: string
}

export const toWorkspaceMember = (w: WorkspaceMemberWire): WorkspaceMember => ({
  id: w.id,
  workspaceId: w.workspace_id,
  userId: w.user_id,
  role: w.role,
  clientId: w.client_id ?? null,
  suspendedAt: w.suspended_at,
  username: w.username ?? null,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
})

export const toWorkspaceInvitation = (
  w: WorkspaceInvitationWire,
): WorkspaceInvitation => ({
  id: w.id,
  workspaceId: w.workspace_id,
  email: w.email,
  role: w.role,
  clientId: w.client_id ?? null,
  projectGrants: w.project_grants ?? [],
  status: w.status,
  expiresAt: w.expires_at,
  acceptedAt: w.accepted_at,
  acceptedByUserId: w.accepted_by_user_id,
  revokedAt: w.revoked_at,
  createdByUserId: w.created_by_user_id,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
})

export const toWorkspaceSettings = (
  w: WorkspaceSettingsWire,
): WorkspaceSettings => ({
  id: w.id,
  workspaceId: w.workspace_id,
  registrationMode: w.registration_mode,
  reviewWorkflowEnabled: w.review_workflow_enabled,
  reviewWorkflowConfig: w.review_workflow_config,
  signaturePolicy: w.signature_policy,
  auditRetentionDays: w.audit_retention_days,
  integrationSettings: w.integration_settings,
  instrumentGateMode: w.instrument_gate_mode ?? 'warn',
  regulatedLab: w.regulated_lab ?? false,
  createdByUserId: w.created_by_user_id,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
})

export const toProjectAccess = (w: ProjectAccessWire): ProjectAccess => ({
  id: w.id,
  workspaceId: w.workspace_id,
  projectId: w.project_id,
  userId: w.user_id,
  accessLevel: w.access_level,
  grantedByUserId: w.granted_by_user_id,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
})

export const toWorkspaceSession = (
  w: WorkspaceSessionWire,
): WorkspaceSession => ({
  id: w.id,
  userId: w.user_id,
  userName: w.user_name,
  ipAddress: w.ip_address,
  userAgent: w.user_agent,
  createdAt: w.created_at,
  expiresAt: w.expires_at,
})

export const adminQueryKeys = {
  members: (workspaceId: string) =>
    ['admin-001', 'members', workspaceId] as const,
  invitations: (workspaceId: string) =>
    ['admin-001', 'invitations', workspaceId] as const,
  settings: (workspaceId: string) =>
    ['admin-001', 'settings', workspaceId] as const,
  sessions: (workspaceId: string) =>
    ['admin-001', 'sessions', workspaceId] as const,
  projectAccess: (workspaceId: string) =>
    ['admin-001', 'project-access', workspaceId] as const,
}

const filter = (column: string, id: string, order: string) =>
  `?${column}=eq.${encodeURIComponent(id)}&order=${order}`

export async function fetchWorkspaceMembers(
  c: DataClient,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const rows = await c.list<WorkspaceMemberWire>(
    'workspace_memberships',
    `${filter('workspace_id', workspaceId, 'created_at.asc')}&select=id,workspace_id,user_id,role,client_id,suspended_at,username,created_at,updated_at`,
  )
  return rows.map(toWorkspaceMember)
}

export interface ClientSummary {
  id: string
  code: string
  name: string
}

export async function fetchClients(
  c: DataClient,
  workspaceId: string,
): Promise<ClientSummary[]> {
  const rows = await c.list<{ id: string; code: string; name: string }>(
    'clients',
    `${filter('workspace_id', workspaceId, 'code.asc')}&select=id,code,name`,
  )
  return rows
}

export async function fetchInvitations(
  c: DataClient,
  workspaceId: string,
): Promise<WorkspaceInvitation[]> {
  const rows = await c.list<WorkspaceInvitationWire>(
    'workspace_invitations',
    filter('workspace_id', workspaceId, 'created_at.desc'),
  )
  return rows.map(toWorkspaceInvitation)
}

export async function fetchWorkspaceSettings(
  c: DataClient,
  workspaceId: string,
): Promise<WorkspaceSettings | null> {
  const rows = await c.list<WorkspaceSettingsWire>(
    'workspace_settings',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}`,
  )
  return rows[0] ? toWorkspaceSettings(rows[0]) : null
}

export async function fetchProjectAccess(
  c: DataClient,
  workspaceId: string,
): Promise<ProjectAccess[]> {
  const rows = await c.list<ProjectAccessWire>(
    'project_access',
    filter('workspace_id', workspaceId, 'created_at.asc'),
  )
  return rows.map(toProjectAccess)
}

export async function fetchWorkspaceSessions(
  c: DataClient,
  workspaceId: string,
): Promise<WorkspaceSession[]> {
  const rows = await c.rpc<WorkspaceSessionWire[]>('list_workspace_sessions', {
    p_workspace_id: workspaceId,
  })
  return rows.map(toWorkspaceSession)
}

export async function createInvitation(
  c: DataClient,
  input: {
    workspaceId: string
    email: string
    role: WorkspaceRole
    expiresAfterDays: number
    clientId?: string | null
    /** Projects the person joins on accepting, at the level named. */
    projectGrants?: InvitationProjectGrant[]
  },
): Promise<{ invitation: WorkspaceInvitation; token: string }> {
  const result = await c.rpc<WorkspaceInvitationWire & { token: string }>(
    'create_invitation',
    {
      p_workspace_id: input.workspaceId,
      p_email: input.email,
      p_role: input.role,
      p_expires_after_days: input.expiresAfterDays,
      p_client_id: input.clientId ?? null,
      p_project_grants: input.projectGrants ?? [],
    },
  )
  return { invitation: toWorkspaceInvitation(result), token: result.token }
}

/**
 * Replace a pending invitation's link with a new one. Only the token's hash is
 * stored, so an old link cannot be shown again, but it can be replaced; the old
 * link stops working.
 */
export async function reissueInvitation(
  c: DataClient,
  input: {
    workspaceId: string
    invitationId: string
    expiresAfterDays?: number
  },
): Promise<{ invitation: WorkspaceInvitation; token: string }> {
  const result = await c.rpc<WorkspaceInvitationWire & { token: string }>(
    'reissue_invitation',
    {
      p_workspace_id: input.workspaceId,
      p_invitation_id: input.invitationId,
      p_expires_after_days: input.expiresAfterDays ?? 7,
    },
  )
  return { invitation: toWorkspaceInvitation(result), token: result.token }
}

/** The link an inviter sends: it carries the one-time token to the accept route. */
export function invitationLink(origin: string, token: string): string {
  return `${origin}/accept-invitation?token=${encodeURIComponent(token)}`
}

export async function revokeInvitation(
  c: DataClient,
  input: { workspaceId: string; invitationId: string },
): Promise<WorkspaceInvitationWire> {
  return c.rpc('revoke_invitation', {
    p_workspace_id: input.workspaceId,
    p_invitation_id: input.invitationId,
  })
}

export async function acceptInvitation(
  c: DataClient,
  input: { token: string; userId: string },
): Promise<WorkspaceInvitationWire> {
  return c.rpc('accept_invitation', {
    p_token: input.token,
    p_user_id: input.userId,
  })
}

async function memberRpc(
  c: DataClient,
  name: string,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMemberWire> {
  return c.rpc(name, {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  })
}

export async function setMemberUsername(
  c: DataClient,
  input: { workspaceId: string; userId: string; username: string },
): Promise<WorkspaceMemberWire> {
  return c.rpc('set_member_username', {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_username: input.username,
  })
}

export async function changeMemberRole(
  c: DataClient,
  input: {
    workspaceId: string
    userId: string
    newRole: WorkspaceRole
    clientId?: string | null
  },
): Promise<WorkspaceMemberWire> {
  return c.rpc('change_member_role', {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
    p_new_role: input.newRole,
    p_client_id: input.clientId ?? null,
  })
}

export async function removeMember(
  c: DataClient,
  input: { workspaceId: string; userId: string },
): Promise<void> {
  await c.rpc<void>('remove_member', {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
  })
}

export function suspendMember(
  c: DataClient,
  input: { workspaceId: string; userId: string },
): Promise<WorkspaceMemberWire> {
  return memberRpc(c, 'suspend_member', input.workspaceId, input.userId)
}

export function reinstateMember(
  c: DataClient,
  input: { workspaceId: string; userId: string },
): Promise<WorkspaceMemberWire> {
  return memberRpc(c, 'reinstate_member', input.workspaceId, input.userId)
}

export function revokeUserSession(
  c: DataClient,
  input: { workspaceId: string; sessionId: string },
): Promise<JsonObject> {
  return c.rpc<JsonObject>('revoke_user_session', {
    p_workspace_id: input.workspaceId,
    p_session_id: input.sessionId,
  })
}

export async function updateWorkspaceSettings(
  c: DataClient,
  input: {
    workspaceId: string
    registrationMode?: RegistrationMode
    reviewWorkflowEnabled?: boolean
    reviewWorkflowConfig?: JsonObject
    signaturePolicy?: JsonObject
    auditRetentionDays?: number
    integrationSettings?: JsonObject
  },
): Promise<WorkspaceSettingsWire> {
  return c.rpc('update_workspace_settings', {
    p_workspace_id: input.workspaceId,
    p_registration_mode: input.registrationMode ?? null,
    p_review_workflow_enabled: input.reviewWorkflowEnabled ?? null,
    p_review_workflow_config: input.reviewWorkflowConfig ?? null,
    p_signature_policy: input.signaturePolicy ?? null,
    p_audit_retention_days: input.auditRetentionDays ?? null,
    p_integration_settings: input.integrationSettings ?? null,
  })
}

export async function grantProjectAccess(
  c: DataClient,
  input: {
    workspaceId: string
    projectId: string
    userId: string
    accessLevel: ProjectAccessLevel
  },
): Promise<ProjectAccessWire> {
  return c.rpc('grant_project_access', {
    p_workspace_id: input.workspaceId,
    p_project_id: input.projectId,
    p_user_id: input.userId,
    p_access_level: input.accessLevel,
  })
}

export async function revokeProjectAccess(
  c: DataClient,
  input: { workspaceId: string; projectId: string; userId: string },
): Promise<void> {
  await c.rpc<void>('revoke_project_access', {
    p_workspace_id: input.workspaceId,
    p_project_id: input.projectId,
    p_user_id: input.userId,
  })
}

export async function exportAuditLog(
  c: DataClient,
  input: {
    workspaceId: string
    fromDate?: string
    toDate?: string
    limit: number
  },
): Promise<AuditEventWire[]> {
  return c.rpc('export_audit_log', {
    p_workspace_id: input.workspaceId,
    p_from_date: input.fromDate ?? null,
    p_to_date: input.toDate ?? null,
    p_limit: input.limit,
  })
}

export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  // Member was the same role as Scientist; the database folds it in.
  member: 'Scientist',
  steward: 'Data steward',
  scientist: 'Scientist',
  analyst: 'Analyst',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
  client_viewer: 'Client viewer',
}

/** Invitation and member-role copy. Viewer is read-only (GOV-01). */
export const WORKSPACE_ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: 'Full workspace administration, including invitations and security.',
  admin: 'Administers configuration and membership except owner-only security.',
  member:
    'Creates and edits experiments, samples and datasets in their projects. Signs as author.',
  steward:
    'Can publish Models and Dataset Schemas; cannot administer security.',
  scientist:
    'Creates and edits experiments, samples and datasets in their projects. Signs as author.',
  analyst:
    'Works with datasets and analyses in their projects, and records results.',
  reviewer:
    'Everything a scientist can do, plus reviews and signs other people’s records.',
  viewer:
    'Read-only. Cannot create, link or upgrade records, Sheets or Datasets.',
  client_viewer:
    'External client. Sees only approved records explicitly shared to their client portal; never drafts, comments, raw data or files.',
}

/** The roles a person can be given, in the order they are offered. */
export const ASSIGNABLE_WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  'owner',
  'admin',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
  'client_viewer',
]

export const WORKSPACE_ROLE_TOKENS: Record<WorkspaceRole, string> = {
  owner: 'bg-review-wash text-review',
  admin: 'bg-selection text-info',
  member: 'bg-muted text-muted-foreground',
  steward: 'bg-success-wash text-success-text',
  scientist: 'bg-success-wash text-success-text',
  analyst: 'bg-selection text-info',
  reviewer: 'bg-warning-wash text-warning-text',
  client_viewer: 'bg-review-wash text-review',
  viewer: 'bg-muted text-muted-foreground',
}

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  revoked: 'Revoked',
  expired: 'Expired',
}

export const INVITATION_STATUS_TOKENS: Record<InvitationStatus, string> = {
  pending: 'bg-warning-wash text-warning-text',
  accepted: 'bg-success-wash text-success-text',
  revoked: 'bg-danger-wash text-danger-text',
  expired: 'bg-muted text-muted-foreground',
}

export const PROJECT_ACCESS_LABELS: Record<ProjectAccessLevel, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

export const PROJECT_ACCESS_TOKENS: Record<ProjectAccessLevel, string> = {
  owner: 'bg-review-wash text-review',
  editor: 'bg-selection text-info',
  viewer: 'bg-muted text-muted-foreground',
}

export const REGISTRATION_MODE_LABELS: Record<RegistrationMode, string> = {
  open: 'Open registration',
  invitation_only: 'Invitation only',
}

export function isOwnerRole(role: string): boolean {
  return role === 'owner'
}

export function formatRelativeTime(
  timestamp: string | null | undefined,
): string {
  if (!timestamp) return 'Never'
  const elapsed = appNow().getTime() - new Date(timestamp).getTime()
  if (!Number.isFinite(elapsed)) return 'Never'
  const future = elapsed < 0
  const seconds = Math.round(Math.abs(elapsed) / 1000)
  const units: Array<[number, string]> = [
    [31_536_000, 'year'],
    [2_592_000, 'month'],
    [604_800, 'week'],
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ]
  const [size, name] =
    units.find(([unitSize]) => seconds >= unitSize) ?? units[6]
  const value = Math.max(1, Math.floor(seconds / size))
  return future
    ? `in ${value} ${name}${value === 1 ? '' : 's'}`
    : `${value} ${name}${value === 1 ? '' : 's'} ago`
}

export function formatDate(timestamp: string | null | undefined): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getDisplayTimeZone(),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function describeAdminError(error: unknown): string {
  if (!(error instanceof DataClientError))
    return 'Could not complete the administration operation. Try again.'
  const messages: Record<string, string> = {
    SB050: 'You cannot perform this action on your own account.',
    SB051: 'This action would remove the last workspace owner.',
    SB052: 'The selected member was not found in this workspace.',
    SB053: 'That role is not valid.',
    SB054: 'The session was not found.',
    SB055: 'You do not have owner access to perform this action.',
    SB056: 'The registration mode is not valid.',
    SB057: 'Audit retention days must be a positive number.',
    SB058: 'That access level is not valid.',
    SB059: 'The project was not found in this workspace.',
    SB060: 'The export limit exceeds the maximum allowed (5000 rows).',
    SB061: 'The invitation is invalid, expired, or already used.',
    SB062: 'Your identity does not match the invitation recipient.',
    SB033: 'This action belongs to a different workspace.',
    '42501': 'You do not have owner access to perform this action.',
  }
  return messages[error.code] ?? error.message
}
