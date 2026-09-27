/**
 * REV-006 — Review inbox data layer.
 *
 * The inbox lists `review_submissions` rows (REV-002) enriched with their
 * linked record and project so the table can show entry, type, project and
 * submitter. The workflow definitions live in the `internal` schema and are
 * not exposed to PostgREST, so the current step is derived client-side from
 * the submission's `workflow_definition_key` + `state` using a small,
 * versioned registry of known workflows. Priority, overdue and withdrawn are
 * display derivations (no stored columns exist yet) — documented below — so
 * the inbox never fabricates data the database does not own.
 *
 * Reads go through the same-origin `/api/db` boundary and RLS like every
 * other resource; the helpers are stateless and share `notebookDataClient`.
 */
import type { DataClient } from './data-client'
import { notebookDataClient, recordKindLabel, toProject } from './notebook-data'
import type { ProjectWire, RecordWire } from './notebook-data'

// ---------------------------------------------------------------------------
// Wire shapes (snake_case, as returned by PostgREST).
// ---------------------------------------------------------------------------

export interface ReviewSubmissionWire {
  id: string
  workspace_id: string
  record_id: string
  revision_id: string
  state: string
  workflow_definition_key: string
  workflow_definition_version: number
  assigned_reviewer_user_ids: string[]
  submitted_by_user_id: string
  submitted_session_id: string
  submitted_role: string
  submitted_at: string
  due_at: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Domain shapes (camelCase, consumed by the inbox UI).
// ---------------------------------------------------------------------------

/** A single step in a review workflow, as the inbox renders it. */
export interface ReviewWorkflowStep {
  key: string
  label: string
  required: boolean
}

export type ReviewInboxStatus =
  'submitted' | 'withdrawn' | 'approved' | 'rejected' | 'returned'

export type ReviewPriority = 'high' | 'medium' | 'low'

/**
 * A review row in the inbox. `record*` and `project*` are joined client-side
 * from the linked `records`/`projects` rows; `currentStep`, `status`,
 * `priority`, `isOverdue` and `isWithdrawn` are display derivations.
 */
export interface ReviewItem {
  id: string
  recordId: string
  revisionId: string
  state: string
  workflowDefinitionKey: string
  workflowDefinitionVersion: number
  assignedReviewerUserIds: string[]
  submittedByUserId: string
  submittedAt: string
  dueAt: string | null
  createdAt: string
  updatedAt: string
  recordIdentifier: string
  recordTitle: string
  recordKind: string
  recordStatus: string
  projectId: string | null
  projectKey: string | null
  projectTitle: string | null
  currentStep: ReviewWorkflowStep
  status: ReviewInboxStatus
  priority: ReviewPriority
  isOverdue: boolean
  isWithdrawn: boolean
}

// ---------------------------------------------------------------------------
// Workflow + status derivation.
//
// `review_workflow_definitions` is internal-only (not PostgREST-exposed), so
// the inbox keeps a client-side map of the workflow definitions the product
// ships with. Unknown keys fall back to a single generic step so the inbox
// never hides a review whose workflow it has not been taught about; when a
// new workflow ships, add it here.
// ---------------------------------------------------------------------------

const WORKFLOW_STEPS = new Map<string, ReviewWorkflowStep[]>([
  [
    'default-scientific-review',
    [{ key: 'scientific-review', label: 'Scientific review', required: true }],
  ],
])

function labelFromKey(key: string): string {
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function workflowStepsFor(
  workflowDefinitionKey: string,
): ReviewWorkflowStep[] {
  const known = WORKFLOW_STEPS.get(workflowDefinitionKey)
  if (known) return known
  return [
    {
      key: workflowDefinitionKey,
      label: labelFromKey(workflowDefinitionKey),
      required: true,
    },
  ]
}

/**
 * The current step for a submission. REV-002 only produces `state='submitted'`
 * with no transitions, so every active review is on its first step. The
 * derivation is forward-compatible: when later tickets add transitions, the
 * step index will come from persisted review state rather than a constant.
 */
export function currentStepFor(item: {
  state: string
  workflowDefinitionKey: string
}): ReviewWorkflowStep {
  const steps = workflowStepsFor(item.workflowDefinitionKey)
  // A withdrawn / completed review is not "on" a step.
  if (item.state !== 'submitted') return steps[0]
  return steps[0]
}

/**
 * Map the raw submission `state` onto the inbox status vocabulary. The
 * database currently constrains `state` to `'submitted'`; the other statuses
 * are rendered when later tickets introduce them so the inbox is ready.
 */
export function inboxStatusFor(state: string): ReviewInboxStatus {
  switch (state) {
    case 'submitted':
    case 'withdrawn':
    case 'approved':
    case 'rejected':
    case 'returned':
      return state
    default:
      return 'submitted'
  }
}

/**
 * WORK-01.1 — a pending review is overdue once its stored due date has
 * passed. When no due date is recorded (pre-existing submissions) fall back to
 * the ageing heuristic: overdue after `OVERDUE_DAYS`. Display only.
 */
export const OVERDUE_DAYS = 14
const OVERDUE_MS = OVERDUE_DAYS * 86_400_000

export function isOverdueFor(
  state: string,
  submittedAt: string,
  dueAt: string | null = null,
): boolean {
  if (state !== 'submitted') return false
  if (dueAt) {
    const due = Date.parse(dueAt)
    if (!Number.isNaN(due)) return Date.now() > due
  }
  const ts = Date.parse(submittedAt)
  if (Number.isNaN(ts)) return false
  return Date.now() - ts > OVERDUE_MS
}

/** True when a submission's due date is within the given window. */
export function isDueSoon(dueAt: string | null, days = 7): boolean {
  if (!dueAt) return false
  const due = Date.parse(dueAt)
  if (Number.isNaN(due)) return false
  const now = Date.now()
  return due >= now && due - now <= days * 86_400_000
}

/**
 * Display priority derived from ageing, not stored. Overdue reviews are high,
 * reviews pending beyond `MEDIUM_DAYS` are medium, and fresh submissions are
 * low. Kept here so the table, inspector and summary cards agree.
 */
export const MEDIUM_DAYS = 7
const MEDIUM_MS = MEDIUM_DAYS * 86_400_000

export function priorityFor(
  state: string,
  submittedAt: string,
  dueAt: string | null = null,
): ReviewPriority {
  if (state !== 'submitted') return 'low'
  if (isOverdueFor(state, submittedAt, dueAt)) return 'high'
  if (dueAt && isDueSoon(dueAt)) return 'medium'
  const ts = Date.parse(submittedAt)
  if (Number.isNaN(ts)) return 'low'
  const age = Date.now() - ts
  if (age > MEDIUM_MS) return 'medium'
  return 'low'
}

// ---------------------------------------------------------------------------
// Mapper — joins a submission with its linked record and project.
// ---------------------------------------------------------------------------

export function toReviewItem(
  submission: ReviewSubmissionWire,
  record: RecordWire | undefined,
  projectTitle: string | null,
  projectKey: string | null,
): ReviewItem {
  const state = submission.state
  return {
    id: submission.id,
    recordId: submission.record_id,
    revisionId: submission.revision_id,
    state,
    workflowDefinitionKey: submission.workflow_definition_key,
    workflowDefinitionVersion: submission.workflow_definition_version,
    assignedReviewerUserIds: submission.assigned_reviewer_user_ids,
    submittedByUserId: submission.submitted_by_user_id,
    submittedAt: submission.submitted_at,
    dueAt: submission.due_at,
    createdAt: submission.created_at,
    updatedAt: submission.updated_at,
    recordIdentifier: record?.identifier ?? submission.record_id,
    recordTitle: record?.title ?? 'Untitled record',
    recordKind: record?.kind ?? 'experiment',
    recordStatus: record?.status ?? 'unknown',
    projectId: record?.project_id ?? null,
    projectKey,
    projectTitle,
    currentStep: currentStepFor({
      state,
      workflowDefinitionKey: submission.workflow_definition_key,
    }),
    status: inboxStatusFor(state),
    priority: priorityFor(state, submission.submitted_at, submission.due_at),
    isOverdue: isOverdueFor(state, submission.submitted_at, submission.due_at),
    isWithdrawn: state === 'withdrawn',
  }
}

// ---------------------------------------------------------------------------
// Fetch helpers.
//
// The inbox fetches submissions (server-ordered, bounded by
// `REVIEW_FETCH_LIMIT`) and the linked records/projects in two flat queries,
// then joins client-side. PostgREST cannot filter the parent submission by an
// embedded record's kind, so type/search/assignee filtering and pagination
// are applied client-side on the bounded set. A review inbox is an actionable
// queue, not an archive, so the cap is generous and clearly surfaced.
// ---------------------------------------------------------------------------

/** Bound the inbox fetch; the oldest pending reviews beyond this are not shown. */
export const REVIEW_FETCH_LIMIT = 500

export const reviewsDataClient: DataClient = notebookDataClient

export const reviewQueryKeys = {
  submissions: () => ['rev-006', 'review-submissions'] as const,
  recordsForReviews: (recordIds: string[]) =>
    ['rev-006', 'review-records', recordIds] as const,
  projectsForReviews: () => ['rev-006', 'review-projects'] as const,
}

export async function fetchReviewSubmissions(
  client: DataClient = reviewsDataClient,
): Promise<ReviewSubmissionWire[]> {
  return client.list<ReviewSubmissionWire>(
    'review_submissions',
    // Select only fields consumed by toReviewItem and the dashboard
    // pending-review filter. Omit workspace_id, submitted_session_id,
    // submitted_role, and idempotency_key to reduce payload size.
    `?select=id,record_id,revision_id,state,workflow_definition_key,workflow_definition_version,assigned_reviewer_user_ids,submitted_by_user_id,submitted_at,due_at,created_at,updated_at&order=submitted_at.desc&limit=${REVIEW_FETCH_LIMIT}`,
  )
}

export async function fetchRecordsForReviews(
  client: DataClient,
  recordIds: string[],
): Promise<RecordWire[]> {
  if (recordIds.length === 0) return []
  const idFilter = recordIds.join(',')
  return client.list<RecordWire>(
    'records',
    `?id=in.(${idFilter})&select=id,workspace_id,project_id,kind,identifier,title,status,created_at,updated_at,archived_at,deleted_at,created_by_user_id,structure_version,metadata_version,tags,properties,updated_by_user_id,locked_at,locked_by_revision_id`,
  )
}

export async function fetchProjectsForReviews(
  client: DataClient,
): Promise<Map<string, { key: string; title: string }>> {
  const rows = await client.list<ProjectWire>(
    'projects',
    '?select=id,key,title&order=created_at.desc',
  )
  const map = new Map<string, { key: string; title: string }>()
  for (const row of rows) {
    const project = toProject(row)
    map.set(project.id, { key: project.key, title: project.title })
  }
  return map
}

// ---------------------------------------------------------------------------
// Filter + paginate (client-side over the bounded fetch).
// ---------------------------------------------------------------------------

export interface ReviewFilterInput {
  status: string
  type: string
  assignee: string
  overdue: string
  search: string
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilterInput = {
  status: '',
  type: '',
  assignee: '',
  overdue: '',
  search: '',
}

export function filterReviews(
  items: ReviewItem[],
  filters: ReviewFilterInput,
  currentUserId: string,
  userLabel: (id: string) => string = (id) => id,
): ReviewItem[] {
  const query = filters.search.trim().toLowerCase()
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false
    if (filters.type && item.recordKind !== filters.type) return false
    if (filters.assignee === 'mine') {
      if (!item.assignedReviewerUserIds.includes(currentUserId)) return false
    }
    if (filters.overdue === 'overdue' && !item.isOverdue) return false
    if (query) {
      const haystack = [
        item.recordIdentifier,
        item.recordTitle,
        item.projectTitle ?? '',
        userLabel(item.submittedByUserId),
        item.currentStep.label,
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

export function sortReviews(
  items: ReviewItem[],
  sortId: string | undefined,
  desc: boolean,
  userLabel: (id: string) => string = (id) => id,
): ReviewItem[] {
  if (!sortId) return items
  const dir = desc ? -1 : 1
  const sorted = [...items].sort((a, b) => {
    switch (sortId) {
      case 'entry':
        return a.recordIdentifier.localeCompare(b.recordIdentifier) * dir
      case 'type':
        return (
          recordKindLabel(a.recordKind).localeCompare(
            recordKindLabel(b.recordKind),
          ) * dir
        )
      case 'project':
        return (a.projectTitle ?? '').localeCompare(b.projectTitle ?? '') * dir
      case 'submitter':
        return (
          userLabel(a.submittedByUserId).localeCompare(
            userLabel(b.submittedByUserId),
          ) * dir
        )
      case 'step':
        return a.currentStep.label.localeCompare(b.currentStep.label) * dir
      case 'submitted':
        return (Date.parse(a.submittedAt) - Date.parse(b.submittedAt)) * dir
      case 'priority': {
        const order: Record<ReviewPriority, number> = {
          high: 0,
          medium: 1,
          low: 2,
        }
        return (order[a.priority] - order[b.priority]) * dir
      }
      default:
        return 0
    }
  })
  return sorted
}

export function paginateReviews(
  items: ReviewItem[],
  pageIndex: number,
  pageSize: number,
): ReviewItem[] {
  const start = pageIndex * pageSize
  return items.slice(start, start + pageSize)
}
