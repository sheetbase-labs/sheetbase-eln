import { startOfDayInZone } from './calendar'
import type { DataClient } from './data-client'
import type { ProjectAssignment } from './workspace-access'

export function homeAssignedProjects(
  projects: { id: string; title: string }[],
  assignments: ProjectAssignment[],
) {
  return assignments.flatMap((assignment) => {
    if (!assignment.can_view) return []
    const project = projects.find((row) => row.id === assignment.project_id)
    return project ? [{ ...project, accessLevel: assignment.access_level }] : []
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
    reviews,
    datasetsWithErrors,
    experimentsInProgress,
    instrumentRuns,
    inbox,
  ] = await Promise.all([
    client.count(
      'my_work_items',
      '?kind=eq.review_requested&state=in.(needs_action,overdue)',
    ),
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
    client.count(
      'instrument_runs',
      `?${workspace}&started_at=gte.${encodeURIComponent(range.start)}&started_at=lt.${encodeURIComponent(range.end)}`,
    ),
    client.count('my_work_items', '?state=in.(needs_action,overdue)'),
  ])
  return {
    reviews,
    datasetsWithErrors,
    experimentsInProgress,
    instrumentRuns,
    inbox,
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
