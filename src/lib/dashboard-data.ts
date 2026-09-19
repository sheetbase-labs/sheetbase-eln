/**
 * OPS-001 — Dashboard data layer.
 *
 * The personal (My Work) and project dashboards read from the same PostgREST
 * resources the rest of the app uses — `records`, `projects`,
 * `change_events`, `review_submissions`, `comments` — and derive metrics
 * client-side. No dashboard-only tables are created; every metric links back
 * to the records that produce it, and every count declares its time boundary
 * (e.g. "updated in the last 7 days", "overdue after 14 days").
 *
 * The helpers are stateless and share `notebookDataClient` so they stay live
 * with the rest of the app and respect the same RLS boundaries.
 */
import type { DataClient } from './data-client'
import { notebookDataClient, toRecord } from './notebook-data'
import type {
  ChangeEventRecordWire,
  NotebookRecord,
  Project,
  ProjectWire,
  RecordWire,
} from './notebook-data'
import { fetchReviewSubmissions, toReviewItem } from './reviews'
import type { ReviewItem, ReviewSubmissionWire } from './reviews'
import type { CommentWire } from './comments-data'
import { listInIdChunks } from './postgrest-in-list'

// ---------------------------------------------------------------------------
// Wire shapes — re-using the shared types from notebook-data and reviews.
// ---------------------------------------------------------------------------

export type { ChangeEventRecordWire, CommentWire, ReviewSubmissionWire }

// ---------------------------------------------------------------------------
// Dashboard domain shapes.
// ---------------------------------------------------------------------------

/** A workspace-wide activity item rendered in the activity feed. */
export interface DashboardActivityItem {
  id: string
  operation: string
  entityType: string
  actorUserId: string | null
  recordId: string | null
  projectId: string | null
  createdAt: string
  /** Lightweight payload summary from the change event. */
  payload: Record<string, unknown>
}

/** A mention in an open comment thread, rendered in the mentions panel. */
export interface DashboardMentionItem {
  id: string
  recordId: string
  revisionId: string
  body: string
  authorUserId: string | null
  state: 'open' | 'resolved'
  createdAt: string
}

/** A pinned record shortcut, resolved from a localStorage id list. */
export interface DashboardPinnedItem {
  record: NotebookRecord
  project: Project | null
}

/** Stat-card metric with a link target and a time-boundary label. */
export interface DashboardMetric {
  label: string
  value: number
  /** Route the card links to (e.g. /reviews, /projects/$projectId). */
  linkTo?: string
  linkParams?: Record<string, string>
  /** Human-readable time boundary, e.g. "Updated in last 7 days". */
  timeBoundary?: string
  hint?: string
  hintTone?: 'default' | 'urgent' | 'warning' | 'info' | 'success' | 'violet'
}

// ---------------------------------------------------------------------------
// Query keys — dashboard-scoped so invalidation is targeted.
// ---------------------------------------------------------------------------

export const dashboardQueryKeys = {
  recentActivity: (limit: number) =>
    ['dashboard', 'activity', 'recent', limit] as const,
  projectActivity: (projectId: string, limit: number) =>
    ['dashboard', 'activity', 'project', projectId, limit] as const,
  myEdits: (userId: string, limit: number) =>
    ['dashboard', 'my-edits', userId, limit] as const,
  myMentions: (userId: string) => ['dashboard', 'my-mentions', userId] as const,
  myReviews: (userId: string) => ['dashboard', 'my-reviews', userId] as const,
  myRecords: (userId: string) => ['dashboard', 'my-records', userId] as const,
  pinnedRecords: (ids: string[]) =>
    ['dashboard', 'pinned-records', ids] as const,
  projectStats: (projectId: string) =>
    ['dashboard', 'project-stats', projectId] as const,
}

// ---------------------------------------------------------------------------
// Mappers.
// ---------------------------------------------------------------------------

export function toDashboardActivityItem(
  row: ChangeEventRecordWire,
): DashboardActivityItem {
  return {
    id: row.id,
    operation: row.operation,
    entityType: row.entity_type,
    actorUserId: row.actor_user_id,
    recordId: row.record_id,
    projectId:
      'project_id' in row
        ? ((row as Record<string, unknown>).project_id as string | null)
        : null,
    createdAt: row.created_at,
    payload: row.payload,
  }
}

export function toDashboardMentionItem(row: CommentWire): DashboardMentionItem {
  return {
    id: row.id,
    recordId: row.record_id,
    revisionId: row.revision_id,
    body: row.body,
    authorUserId: row.author_user_id,
    state: row.state,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Time-boundary helpers.
//
// Every dashboard metric declares what time window it covers so the user can
// trust the number. These helpers are pure functions, tested for time-zone
// safety: they work with epoch milliseconds (UTC-stable) rather than
// calendar-day arithmetic in a local zone.
// ---------------------------------------------------------------------------

/** Number of milliseconds in one day. */
export const DAY_MS = 86_400_000

/**
 * Review ageing thresholds for dashboard hints. Re-exports the review inbox
 * constants so the dashboard and inbox agree on what "overdue" and "due soon"
 * mean. `SOON_DAYS` is the dashboard's own "due soon" boundary (reviews
 * older than this but not yet overdue get a warning hint).
 */
export const OVERDUE_DAYS = 14
export const SOON_DAYS = 7

/**
 * Returns true when `iso` falls within the last `days` days measured from
 * `now` (default: current time). Uses epoch-millisecond diff so the boundary
 * is stable across time zones — "within 7 days" means 7 × 24 h, not "same
 * calendar week".
 */
export function isWithinLastDays(
  iso: string | null | undefined,
  days: number,
  now: number = Date.now(),
): boolean {
  if (!iso) return false
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return false
  return now - ts < days * DAY_MS
}

/**
 * Returns true when a review submission is overdue: `state` is 'submitted'
 * and `submittedAt` is older than `days` days.
 */
export function isReviewOverdue(
  state: string,
  submittedAt: string,
  days: number,
  now: number = Date.now(),
): boolean {
  if (state !== 'submitted') return false
  const ts = Date.parse(submittedAt)
  if (Number.isNaN(ts)) return false
  return now - ts > days * DAY_MS
}

/**
 * Returns true when a review submission is due soon: `state` is 'submitted'
 * and `submittedAt` is older than `soonDays` but not yet overdue.
 */
export function isReviewDueSoon(
  state: string,
  submittedAt: string,
  soonDays: number,
  overdueDays: number,
  now: number = Date.now(),
): boolean {
  if (state !== 'submitted') return false
  const ts = Date.parse(submittedAt)
  if (Number.isNaN(ts)) return false
  const age = now - ts
  return age > soonDays * DAY_MS && age <= overdueDays * DAY_MS
}

/**
 * Formats the next-deadline hint from a set of review items. Returns
 * "Next: <relative time>" for the oldest pending review, or undefined when
 * there are no pending reviews.
 */
export function nextDeadlineHint(
  reviews: ReviewItem[],
  now: number = Date.now(),
): string | undefined {
  const pending = reviews
    .filter((r) => r.state === 'submitted')
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
  if (pending.length === 0) return undefined
  const oldest = pending[0]
  const ageMs = now - Date.parse(oldest.submittedAt)
  const days = Math.floor(ageMs / DAY_MS)
  if (days <= 0) return 'Next: Today'
  if (days === 1) return 'Next: 1 day ago'
  return `Next: ${days}d ago`
}

// ---------------------------------------------------------------------------
// Activity feed operation labels.
// ---------------------------------------------------------------------------

const OPERATION_LABELS: Record<string, string> = {
  create: 'created',
  update: 'updated',
  move: 'moved',
  delete: 'deleted',
  archive: 'archived',
  restore: 'restored',
  link: 'linked',
  unlink: 'unlinked',
  quarantine: 'quarantined',
  resolve: 'resolved',
  reopen: 'reopened',
  lock: 'locked',
  amend: 'amended',
}

const ENTITY_LABELS: Record<string, string> = {
  project: 'project',
  folder: 'folder',
  record: 'record',
  block: 'block',
  record_link: 'link',
  scientific_table: 'dataset',
  scientific_row: 'dataset row',
  formula: 'formula',
  calculation: 'calculation',
  record_field_definition: 'field definition',
  file: 'file',
  dataset_schema: 'dataset schema',
  dataset_schema_field: 'schema field',
  dataset_schema_relationship: 'schema relationship',
  sample_event: 'sample event',
  comment: 'comment',
}

/** Human label for a change-event operation, e.g. "created" → "created". */
export function operationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? operation
}

/** Human label for a change-event entity type, e.g. "record" → "record". */
export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType
}

/**
 * Builds a human-readable activity sentence from a change event, e.g.
 * "updated record" or "created block". Uses the payload's title/identifier
 * when available.
 */
export function activitySentence(item: DashboardActivityItem): string {
  const op = operationLabel(item.operation)
  const entity = entityLabel(item.entityType)
  const payload = item.payload
  const title =
    typeof payload.title === 'string'
      ? payload.title
      : typeof payload.identifier === 'string'
        ? payload.identifier
        : undefined
  return title ? `${op} ${entity} "${title}"` : `${op} ${entity}`
}

// ---------------------------------------------------------------------------
// Fetch helpers — all go through the same /api/db PostgREST boundary.
// ---------------------------------------------------------------------------

/**
 * Recent workspace-wide change events for the activity feed. Ordered
 * newest-first and bounded so the feed stays compact.
 */
export function fetchRecentActivity(
  client: DataClient = notebookDataClient,
  limit = 25,
): Promise<DashboardActivityItem[]> {
  return client
    .list<ChangeEventRecordWire>(
      'change_events',
      `?order=created_at.desc&limit=${limit}&select=id,entity_type,entity_uuid,operation,record_id,actor_user_id,payload,created_at,project_id`,
    )
    .then((rows) => rows.map(toDashboardActivityItem))
}

/**
 * Recent change events scoped to a project, for the project dashboard's
 * activity feed.
 */
export function fetchProjectActivity(
  client: DataClient,
  projectId: string,
  limit = 25,
): Promise<DashboardActivityItem[]> {
  return client
    .list<ChangeEventRecordWire>(
      'change_events',
      `?project_id=eq.${projectId}&order=created_at.desc&limit=${limit}&select=id,entity_type,entity_uuid,operation,record_id,actor_user_id,payload,created_at,project_id`,
    )
    .then((rows) => rows.map(toDashboardActivityItem))
}

/**
 * Open comments that mention the user. PostgREST's `cs` (contains) operator
 * filters the text array column `mentions`. Only open threads are returned so
 * resolved mentions don't clutter the panel.
 */
export function fetchMyMentions(
  client: DataClient,
  userId: string,
  limit = 10,
): Promise<DashboardMentionItem[]> {
  // PostgREST array-contains: ?mentions=cs.{user-id}
  // The curly braces are part of the PostgREST array literal syntax.
  return client
    .list<CommentWire>(
      'comments',
      `?mentions=cs.{${userId}}&state=eq.open&order=created_at.desc&limit=${limit}`,
    )
    .then((rows) => rows.map(toDashboardMentionItem))
}

/**
 * Review submissions assigned to the current user that are still pending.
 * Reuses the review inbox fetcher and filters client-side by the assigned
 * reviewer array, matching the inbox's pattern.
 */
export async function fetchMyPendingReviews(
  client: DataClient,
  userId: string,
): Promise<ReviewItem[]> {
  const submissions = await fetchReviewSubmissions(client)
  const recordIds = submissions.map((s) => s.record_id)
  const records = recordIds.length
    ? await listInIdChunks<RecordWire>(
        client,
        'records',
        recordIds,
        (idFilter) =>
          `?id=in.(${idFilter})&select=id,workspace_id,project_id,kind,identifier,title,status,created_at,updated_at,archived_at,deleted_at,created_by_user_id,structure_version,metadata_version,tags,properties,updated_by_user_id,locked_at,locked_by_revision_id`,
      )
    : []
  const recordMap = new Map(records.map((r) => [r.id, r]))

  // Fetch only projects referenced by the returned records instead of
  // every project in the workspace.
  const projectIds = [
    ...new Set(
      records
        .map((r) => r.project_id)
        .filter((id): id is string => id !== null),
    ),
  ]
  const projectRows = projectIds.length
    ? await listInIdChunks<ProjectWire>(
        client,
        'projects',
        projectIds,
        (idFilter) => `?id=in.(${idFilter})&select=id,key,title`,
      )
    : []
  const projectMap = new Map(
    projectRows.map((p) => [p.id, { key: p.key, title: p.title }]),
  )

  return submissions
    .filter(
      (s) =>
        s.state === 'submitted' &&
        s.assigned_reviewer_user_ids.includes(userId),
    )
    .map((s) => {
      const record = recordMap.get(s.record_id)
      const projectId = record?.project_id ?? null
      const project = projectId ? projectMap.get(projectId) : null
      return toReviewItem(
        s,
        record,
        project?.title ?? null,
        project?.key ?? null,
      )
    })
}

/**
 * Records created or updated by the user — the "assigned to me" list on My
 * Work. Fetches active (non-archived, non-deleted) records where the user is
 * the creator or last updater.
 */
export function fetchMyRecords(
  client: DataClient,
  userId: string,
  limit = 50,
): Promise<NotebookRecord[]> {
  // PostgREST OR filter: created_by_user_id or updated_by_user_id matches.
  // Use the `or` query parameter.
  return client
    .list<RecordWire>(
      'records',
      `?or=(created_by_user_id.eq.${userId},updated_by_user_id.eq.${userId})&archived_at=is.null&deleted_at=is.null&order=updated_at.desc&limit=${limit}`,
    )
    .then((rows) => rows.map(toRecord))
}

/**
 * Fetch pinned records by their IDs. The ID list is stored in localStorage
 * (see PinnedRecordsPanel); this helper resolves them to full domain records
 * joined with their projects.
 */
export async function fetchPinnedRecords(
  client: DataClient,
  recordIds: string[],
): Promise<DashboardPinnedItem[]> {
  if (recordIds.length === 0) return []
  const records = await listInIdChunks<RecordWire>(
    client,
    'records',
    recordIds,
    (idFilter) =>
      `?id=in.(${idFilter})&select=id,workspace_id,project_id,kind,identifier,title,status,created_at,updated_at,archived_at,deleted_at,created_by_user_id,structure_version,metadata_version,tags,properties,updated_by_user_id,locked_at,locked_by_revision_id`,
  )
  const projectIds = [
    ...new Set(
      records
        .map((r) => r.project_id)
        .filter((id): id is string => id !== null),
    ),
  ]
  const projects =
    projectIds.length > 0
      ? await listInIdChunks<ProjectWire>(
          client,
          'projects',
          projectIds,
          (idFilter) =>
            `?id=in.(${idFilter})&select=id,key,title,status,created_at,updated_at,archived_at`,
        )
      : []
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  return records.map((r) => {
    const record = toRecord(r)
    const project = r.project_id ? projectMap.get(r.project_id) : undefined
    return {
      record,
      project: project
        ? {
            id: project.id,
            key: project.key,
            title: project.title,
            status: project.status,
            createdAt: project.created_at,
            updatedAt: project.updated_at,
            archivedAt: project.archived_at,
          }
        : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Metric derivations — pure functions that compute dashboard metrics from
// fetched data. Each declares its time boundary.
// ---------------------------------------------------------------------------

/**
 * Compute the "My Work" summary metrics from the fetched data. Each metric
 * links to the route that shows the underlying records and declares the time
 * boundary it covers.
 */
export function computeMyWorkMetrics(args: {
  myRecords: NotebookRecord[]
  pendingReviews: ReviewItem[]
  myMentions: DashboardMentionItem[]
  recentActivity: DashboardActivityItem[]
  overdueDays: number
  soonDays: number
}): DashboardMetric[] {
  const { myRecords, pendingReviews, recentActivity, overdueDays, soonDays } =
    args

  const experiments = myRecords.filter((r) => r.kind === 'experiment')
  const inProgress = myRecords.filter((r) => r.status === 'in_progress')
  const overdueReviews = pendingReviews.filter((r) =>
    isReviewOverdue(r.state, r.submittedAt, overdueDays),
  )
  const dueSoonReviews = pendingReviews.filter((r) =>
    isReviewDueSoon(r.state, r.submittedAt, soonDays, overdueDays),
  )

  return [
    {
      label: 'Assigned experiments',
      value: experiments.length,
      linkTo: '/projects',
      timeBoundary: 'All active records you own or edit',
      hint:
        inProgress.length > 0 ? `${inProgress.length} in progress` : undefined,
      hintTone: 'info',
    },
    {
      label: 'Pending reviews',
      value: pendingReviews.length,
      linkTo: '/reviews',
      timeBoundary: `Overdue after ${overdueDays} days`,
      hint:
        overdueReviews.length > 0
          ? `${overdueReviews.length} overdue`
          : dueSoonReviews.length > 0
            ? `${dueSoonReviews.length} due soon`
            : undefined,
      hintTone: overdueReviews.length > 0 ? 'urgent' : 'warning',
    },
    {
      label: 'In progress',
      value: inProgress.length,
      linkTo: '/projects',
      timeBoundary: 'Records with status "in_progress"',
      hint: 'Open work items',
      hintTone: 'default',
    },
    {
      label: 'Recent activity',
      value: recentActivity.length,
      linkTo: '/',
      timeBoundary: `Last ${recentActivity.length} workspace events`,
      hint: 'Across all projects',
      hintTone: 'default',
    },
    {
      label: 'Open mentions',
      value: args.myMentions.length,
      linkTo: '/',
      timeBoundary: 'Unresolved comment mentions',
      hint:
        args.myMentions.length > 0
          ? `${args.myMentions.length} new`
          : 'No mentions',
      hintTone: args.myMentions.length > 0 ? 'info' : 'default',
    },
  ]
}

/**
 * Compute the project dashboard summary metrics from the project's records.
 * Each card links to the records table filtered by kind.
 */
export function computeProjectMetrics(args: {
  records: NotebookRecord[]
  projectId: string
  overdueDays: number
}): DashboardMetric[] {
  const { records, projectId, overdueDays } = args

  const experiments = records.filter((r) => r.kind === 'experiment')
  const samples = records.filter((r) => r.kind === 'sample')
  const protocols = records.filter((r) => r.kind === 'protocol_template')
  const files = records.filter((r) => r.kind === 'file')
  const pendingReviews = records.filter(
    (r) => r.status === 'review' || r.status === 'under_review',
  )
  const inProgressExperiments = experiments.filter(
    (r) => r.status === 'in_progress',
  )
  const updatedThisWeek = records.filter((r) =>
    isWithinLastDays(r.updatedAt, 7),
  )

  return [
    {
      label: 'Active experiments',
      value: experiments.length,
      linkTo: '/projects/$projectId',
      linkParams: { projectId },
      timeBoundary: 'All experiment records',
      hint:
        inProgressExperiments.length > 0
          ? `${inProgressExperiments.length} in progress`
          : 'Active notebooks',
      hintTone: 'info',
    },
    {
      label: 'Linked samples',
      value: samples.length,
      linkTo: '/projects/$projectId',
      linkParams: { projectId },
      timeBoundary: 'All sample records',
      hint: 'Linked samples',
      hintTone: 'success',
    },
    {
      label: 'Datasets',
      value: files.length,
      linkTo: '/projects/$projectId',
      linkParams: { projectId },
      timeBoundary: 'Updated in last 7 days',
      hint:
        updatedThisWeek.length > 0
          ? `${updatedThisWeek.filter((r) => r.kind === 'file').length} updated this week`
          : 'File records',
      hintTone: 'default',
    },
    {
      label: 'Protocols',
      value: protocols.length,
      linkTo: '/projects/$projectId',
      linkParams: { projectId },
      timeBoundary: 'All protocol templates',
      hint:
        protocols.length === 1 ? '1 template' : `${protocols.length} templates`,
      hintTone: 'violet',
    },
    {
      label: 'Pending reviews',
      value: pendingReviews.length,
      linkTo: '/reviews',
      timeBoundary: `Overdue after ${overdueDays} days`,
      hint: pendingReviews.length > 0 ? 'Awaiting approval' : 'None pending',
      hintTone: pendingReviews.length > 0 ? 'urgent' : 'default',
    },
  ]
}
