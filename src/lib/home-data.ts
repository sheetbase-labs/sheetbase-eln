import { startOfDayInZone } from './calendar'
import type { DataClient } from './data-client'
import type { ProjectAssignment } from './workspace-access'
import type { ReviewSubmissionWire } from './reviews'
import { fetchRecordsForReviews } from './reviews'
import type { ProjectWire } from './notebook-data'
import type {
  WorkspaceMemberIdentity,
  ProjectMember,
} from '#/components/v3/projects/project-data'
import {
  datasetValidation,
  toDatasetListRow,
} from '#/components/v3/datasets/datasets-data'
import type { DatasetListRow } from '#/components/v3/datasets/datasets-data'
import { fetchActiveDatasetFlags } from './dataset-flags'
import { fetchNeedsActionCounts, toWorkItem } from './work-items/data'
import type { WorkItem, WorkItemWire } from './work-items/data'

export async function fetchHomeMaterials(client: DataClient) {
  const rows = await client.list<WorkItemWire>(
    'my_work_items',
    '?kind=eq.material_expiring&state=in.(needs_action,overdue)&order=due_at.asc&limit=5',
  )
  return rows.map((row) => toWorkItem(row))
}

export function homeMaterialExpiryLabel(
  material: Pick<WorkItem, 'dueAt' | 'reason'>,
  now: Date,
  timeZone: string,
) {
  if (!material.dueAt) return material.reason
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // Compare wall-calendar dates, not elapsed 24-hour periods across DST.
  const [expiryDay, today] = [new Date(material.dueAt), now].map((date) => {
    const parts = formatter.formatToParts(date)
    return Date.UTC(
      Number(parts.find((part) => part.type === 'year')?.value),
      Number(parts.find((part) => part.type === 'month')?.value) - 1,
      Number(parts.find((part) => part.type === 'day')?.value),
    )
  })
  const days = (expiryDay - today) / 86_400_000
  if (days === 0) return 'lot expires today'
  const unit = Math.abs(days) === 1 ? 'day' : 'days'
  return days > 0
    ? `lot expires in ${days} ${unit}`
    : `lot expired ${Math.abs(days)} ${unit} ago`
}

export async function fetchHomePeople(
  client: DataClient,
  projectIds: string[],
  userId: string,
) {
  const projects = await Promise.all(
    projectIds.map((id) =>
      client.rpc<ProjectMember[]>('project_members', { p_project_id: id }),
    ),
  )
  const people = new Map<string, { id: string; name: string; role: string }>()
  for (const member of projects.flat()) {
    if (member.user_id === userId) continue
    if (people.has(member.user_id) && !member.is_lead) continue
    people.set(member.user_id, {
      id: member.user_id,
      name: member.name,
      role: member.is_lead
        ? 'Project lead'
        : member.workspace_role
          ? `Workspace ${member.workspace_role}`
          : 'Project member',
    })
  }
  return [...people.values()]
}

export async function fetchHomeReviews(client: DataClient, userId: string) {
  const submissions = await client.list<ReviewSubmissionWire>(
    'review_submissions',
    `?state=eq.submitted&assigned_reviewer_user_ids=cs.${encodeURIComponent(`{${userId}}`)}&select=id,record_id,revision_id,due_at,submitted_by_user_id&order=due_at.asc.nullslast,submitted_at.desc&limit=5`,
  )
  if (!submissions.length) return []
  const records = await fetchRecordsForReviews(
    client,
    submissions.map((row) => row.record_id),
  )
  const projectIds = [
    ...new Set(
      records.flatMap((row) => (row.project_id ? [row.project_id] : [])),
    ),
  ]
  const [projects, members] = await Promise.all([
    projectIds.length
      ? client.list<Pick<ProjectWire, 'id' | 'title'>>(
          'projects',
          `?id=in.(${projectIds.join(',')})&select=id,title`,
        )
      : [],
    client.rpc<WorkspaceMemberIdentity[]>('workspace_members_list', {}),
  ])
  return submissions.flatMap((submission) => {
    const record = records.find((row) => row.id === submission.record_id)
    // The record's read authority is required for every displayed review.
    if (!record) return []
    return [
      {
        id: submission.id,
        recordId: submission.record_id,
        revisionId: submission.revision_id,
        identifier: record.identifier,
        title: record.title,
        projectTitle:
          projects.find((row) => row.id === record.project_id)?.title ?? null,
        submittedByName:
          members.find((row) => row.user_id === submission.submitted_by_user_id)
            ?.name ?? null,
        dueAt: submission.due_at,
      },
    ]
  })
}

export function homeDatasetIssueLabel(row: DatasetListRow) {
  if (row.outOfRange > 0 && row.missingUnit === 0) {
    return `${row.outOfRange} ${row.outOfRange === 1 ? 'value' : 'values'} outside range`
  }
  return datasetValidation(row).label
}

export async function fetchHomeDatasetIssues(client: DataClient) {
  const datasets = await client.list<Parameters<typeof toDatasetListRow>[0]>(
    'rpc/dataset_list_summary',
    '?issue_count=gt.0&archived_at=is.null&order=updated_at.desc&limit=5',
  )
  return Promise.all(
    datasets.map(async (wire) => {
      const row = toDatasetListRow(wire)
      const flags = await fetchActiveDatasetFlags(client, row.uuid)
      return {
        id: row.uuid,
        identifier: row.id,
        label: homeDatasetIssueLabel(row),
        detail: row.missingUnitFields.length
          ? `${row.missingUnitFields.map((field) => `“${field}”`).join(', ')} — add before review`
          : [...new Set(flags.map((flag) => flag.reason))].join('; '),
      }
    }),
  )
}

export async function hasOpenedHomeProject(
  client: DataClient,
  userId: string,
  projectIds: string[],
) {
  if (!projectIds.length) return false
  return (
    (await client.count(
      'recently_viewed',
      `?user_id=eq.${encodeURIComponent(userId)}&object_kind=eq.project&object_id=in.(${projectIds.join(',')})`,
    )) > 0
  )
}

export function homeAssignedProjects<T extends { id: string; title: string }>(
  projects: T[],
  assignments: ProjectAssignment[],
): (T & { accessLevel: string })[] {
  return assignments.flatMap((assignment) => {
    if (!assignment.can_view) return []
    const project = projects.find((row) => row.id === assignment.project_id)
    const accessLevel = assignment.can_manage
      ? 'Owner'
      : assignment.can_edit
        ? assignment.can_review
          ? 'Reviewer'
          : 'Editor'
        : assignment.can_review
          ? 'Review only'
          : 'Viewer'
    return project ? [{ ...project, accessLevel }] : []
  })
}

export function homeDayRange(now: Date, timeZone: string) {
  const start = startOfDayInZone(now, timeZone)
  // Resolve the following wall-clock midnight independently: DST days are
  // not necessarily 24 hours. Noon tomorrow is safely inside that next day.
  const end = startOfDayInZone(
    new Date(start.getTime() + 36 * 60 * 60 * 1000),
    timeZone,
  )
  return { start: start.toISOString(), end: end.toISOString() }
}

export async function fetchHomeCounts(
  client: DataClient,
  workspaceId: string,
  range: ReturnType<typeof homeDayRange>,
) {
  const workspace = `workspace_id=eq.${encodeURIComponent(workspaceId)}`
  const [
    datasetsWithErrors,
    experimentsInProgress,
    instrumentRuns,
    inboxCounts,
    unreadNotifications,
  ] = await Promise.all([
    // This security-invoker RPC returns one row per readable Dataset,
    // independent of how many active flags that Dataset has.
    client.count(
      'rpc/dataset_list_summary',
      '?issue_count=gt.0&archived_at=is.null',
    ),
    client.count(
      'records',
      `?${workspace}&kind=eq.experiment&status=eq.in_progress&deleted_at=is.null`,
    ),
    // What the Schedule shows for today: the day's live bookings, so Home and
    // Schedule never disagree about how busy the instruments are.
    client.count(
      'calendar_bookings',
      `?${workspace}&status=neq.cancelled&starts_at=gte.${encodeURIComponent(range.start)}&starts_at=lt.${encodeURIComponent(range.end)}`,
    ),
    // QA2-Inbox-1: the Inbox totals come from the one Inbox predicate, not a
    // second state-only count, so Home's chips and the list they open agree.
    // QA4: they are the server's count over every row the caller can see
    // (seen state included), not the length of `fetchWorkItems`' 200-row
    // preview, so a large workspace cannot read smaller here than in the
    // sidebar badge.
    fetchNeedsActionCounts(client),
    // R5-HOME-01: the same unread authority the notifications bell reads, so
    // the quiet condition cannot call a page calm while the bell shows unread.
    client.count('my_notifications', '?read_at=is.null'),
  ])
  return {
    reviews: inboxCounts.reviews,
    datasetsWithErrors,
    experimentsInProgress,
    instrumentRuns,
    inbox: inboxCounts.total,
    unreadNotifications,
  }
}

export function homeDueLabel(
  dueAt: string | null,
  now: Date,
  timeZone: string,
) {
  if (!dueAt) return '—'
  const date = new Date(dueAt)
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  if (day.format(date) === day.format(now)) return 'Today'
  return date.toLocaleDateString('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
  })
}
