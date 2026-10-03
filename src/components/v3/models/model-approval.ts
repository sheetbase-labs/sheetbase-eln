import type {
  ApprovalRequest,
  ApprovalRequestState,
} from '#/lib/approval-requests'
import { hasCapability } from '#/lib/capability'
import type { Tone } from '#/components/v3/ui/status'

/**
 * MDL-03.3 — the model-version approval read model (pure).
 *
 * MDL-03.1/03.2 already own the generic `api.approval_requests` store and the
 * server RPCs; this module only interprets the rows the browser may read. It
 * never mutates anything and never invents an outcome the server did not
 * record, so it is safe to unit test without a client.
 *
 * Independence is a server rule (`require_independence` + `submitted_by_user_id`)
 * and every decision is checked again in SQL; the helpers here are the UI hint
 * so the buttons match what the server will accept.
 */

/** Roles an approver may be named from. Mirrors the `chk_approval_requests_roles`
 * list; `viewer` is excluded because a viewer is not a workspace writer and can
 * never decide. */
export const APPROVER_ROLE_OPTIONS = [
  'owner',
  'admin',
  'steward',
  'reviewer',
  'scientist',
  'analyst',
  'member',
] as const

export type ApproverRole = (typeof APPROVER_ROLE_OPTIONS)[number]

/** Owner plus the closest thing to QA in the role vocabulary. */
export const DEFAULT_APPROVER_ROLES: ApproverRole[] = ['owner', 'reviewer']

export const APPROVAL_REASON_MAX = 500

export interface ApprovalDecision {
  id: string
  request_id: string
  workspace_id: string
  user_id: string
  role: string
  decision: 'approved' | 'returned'
  reason: string | null
  created_at: string
}

export interface ApprovalStatus {
  tone: Tone
  label: string
  detail: string
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  steward: 'Steward',
  reviewer: 'Reviewer (QA)',
  scientist: 'Scientist',
  analyst: 'Analyst',
  member: 'Member',
  viewer: 'Viewer',
}

export function roleLabel(role: string): string {
  return (
    ROLE_LABELS[role] ??
    role.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  )
}

export function roleList(roles: readonly string[]): string {
  const labels = roles.map(roleLabel)
  if (labels.length <= 1) return labels[0] ?? 'an approver'
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`
}

function byNewest(a: ApprovalRequest, b: ApprovalRequest): number {
  const at = Date.parse(a.created_at)
  const bt = Date.parse(b.created_at)
  if (Number.isNaN(at) || Number.isNaN(bt)) return 0
  return bt - at
}

/** All requests for one object, newest first. */
export function sortRequestsNewest(
  requests: readonly ApprovalRequest[],
): ApprovalRequest[] {
  return [...requests].sort(byNewest)
}

export function latestRequest(
  requests: readonly ApprovalRequest[],
): ApprovalRequest | null {
  return sortRequestsNewest(requests)[0] ?? null
}

/** The one open request, if any (the DB enforces at most one per object). */
export function pendingRequest(
  requests: readonly ApprovalRequest[],
): ApprovalRequest | null {
  return requests.find((request) => request.state === 'pending') ?? null
}

const STATE_STATUS: Record<
  ApprovalRequestState,
  { tone: Tone; label: string; detail: string }
> = {
  pending: {
    tone: 'review',
    label: 'Awaiting approval',
    detail: 'Locked while an approver reviews it',
  },
  approved: {
    tone: 'ok',
    label: 'Approved',
    detail: 'Cleared to publish',
  },
  returned: {
    tone: 'bad',
    label: 'Returned',
    detail: 'Changes were requested',
  },
  withdrawn: {
    tone: 'stored',
    label: 'Withdrawn',
    detail: 'The submitter withdrew it',
  },
}

/** The status shown for a version: the open request wins, else the latest. */
export function approvalStatus(
  requests: readonly ApprovalRequest[],
): ApprovalStatus {
  const request = pendingRequest(requests) ?? latestRequest(requests)
  if (!request) {
    return {
      tone: 'none',
      label: 'Not submitted',
      detail: 'No approval request yet',
    }
  }
  return STATE_STATUS[request.state]
}

/** Mirrors `replace_dataset_schema_version_fields`: editing a draft needs it. */
export function canSubmitForApproval(role: string | null | undefined): boolean {
  return hasCapability(role, 'schema.edit')
}

/** Mirrors `api.is_workspace_writer` (record.create capability). */
export function isWorkspaceWriter(role: string | null | undefined): boolean {
  return hasCapability(role, 'record.create')
}

/** True when this user's role is named on the request. */
export function isRequiredApprover(
  request: ApprovalRequest | null,
  role: string | null | undefined,
): boolean {
  if (!request || !role) return false
  return request.required_approver_roles.includes(role)
}

/**
 * UI hint for approve/return: pending, a writer, a named role, and — when the
 * request requires independence — not the submitter. The SQL repeats all of
 * this and is authoritative.
 */
export function canDecide(
  request: ApprovalRequest | null,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!request || request.state !== 'pending') return false
  if (!isWorkspaceWriter(role)) return false
  if (!isRequiredApprover(request, role)) return false
  if (request.approved_by_user_ids.includes(userId ?? '')) return false
  if (request.require_independence && request.submitted_by_user_id === userId) {
    return false
  }
  return true
}

/** Only the submitter may withdraw, and only while the request is pending. */
export function canWithdraw(
  request: ApprovalRequest | null,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!request || request.state !== 'pending') return false
  if (!isWorkspaceWriter(role)) return false
  return (
    request.submitted_by_user_id !== null &&
    request.submitted_by_user_id === userId
  )
}

/**
 * A draft may publish without approval only while no request exists; once a
 * request does, the latest must be `approved` (see
 * `internal.approval_publish_blocker`).
 */
export function canPublishDraft(requests: readonly ApprovalRequest[]): boolean {
  if (pendingRequest(requests)) return false
  if (requests.length === 0) return true
  return latestRequest(requests)?.state === 'approved'
}

export type ApprovalTrailKind =
  'submitted' | 'approved' | 'returned' | 'withdrawn'

export interface ApprovalTrailEntry {
  id: string
  kind: ApprovalTrailKind
  actorUserId: string | null
  role: string | null
  at: string
  reason: string | null
}

/**
 * The audit trail for one request: the submission, every recorded decision,
 * and the terminal state when a request was approved, returned or withdrawn.
 * Decisions are the per-approver record; when none were read (narrow read), the
 * request's own decided fields stand in. Chronological, oldest first.
 */
export function buildApprovalTrail(
  request: ApprovalRequest,
  decisions: readonly ApprovalDecision[],
): ApprovalTrailEntry[] {
  const entries: ApprovalTrailEntry[] = [
    {
      id: `${request.id}:submitted`,
      kind: 'submitted',
      actorUserId: request.submitted_by_user_id,
      role: null,
      at: request.submitted_at,
      reason: request.reason,
    },
  ]

  const own = decisions
    .filter((decision) => decision.request_id === request.id)
    .map<ApprovalTrailEntry>((decision) => ({
      id: decision.id,
      kind: decision.decision,
      actorUserId: decision.user_id,
      role: decision.role,
      at: decision.created_at,
      reason: decision.reason,
    }))
  entries.push(...own)

  const terminal = request.state
  if (terminal === 'approved' && !own.some((e) => e.kind === 'approved')) {
    entries.push({
      id: `${request.id}:approved`,
      kind: 'approved',
      actorUserId: request.decided_by_user_id,
      role: null,
      at: request.decided_at ?? request.updated_at,
      reason: request.decision_reason,
    })
  }
  if (terminal === 'returned' && !own.some((e) => e.kind === 'returned')) {
    entries.push({
      id: `${request.id}:returned`,
      kind: 'returned',
      actorUserId: request.decided_by_user_id,
      role: null,
      at: request.decided_at ?? request.updated_at,
      reason: request.decision_reason,
    })
  }
  if (terminal === 'withdrawn') {
    entries.push({
      id: `${request.id}:withdrawn`,
      kind: 'withdrawn',
      actorUserId: request.decided_by_user_id,
      role: null,
      at: request.decided_at ?? request.updated_at,
      reason: request.decision_reason,
    })
  }

  return entries.sort((a, b) => {
    const at = Date.parse(a.at)
    const bt = Date.parse(b.at)
    if (Number.isNaN(at) || Number.isNaN(bt)) return 0
    return at - bt
  })
}

/** Every actor id the trail and status may need to resolve to a name. */
export function approvalActorIds(
  requests: readonly ApprovalRequest[],
  decisions: readonly ApprovalDecision[],
): string[] {
  const ids = new Set<string>()
  for (const request of requests) {
    if (request.submitted_by_user_id) ids.add(request.submitted_by_user_id)
    if (request.decided_by_user_id) ids.add(request.decided_by_user_id)
    for (const id of request.approved_by_user_ids) ids.add(id)
  }
  for (const decision of decisions) ids.add(decision.user_id)
  return [...ids]
}

/** Trimmed reason within 1..500, or null when invalid. */
export function normaliseReason(value: string): string | null {
  const reason = value.trim()
  if (reason.length < 1 || reason.length > APPROVAL_REASON_MAX) return null
  return reason
}
