/**
 * Lab watchers.
 *
 * A watcher is a review a lab turns on from a list: it looks at the lab on a
 * schedule and leaves a finding in the Inbox of the person who turned it on,
 * with a link to the record and, where one makes sense, a button for the next
 * step. The looking is rule-based and runs in the database, so it works with
 * AI switched off and gives the same answer twice.
 */
import type { DataClient } from './data-client'
import { agentActionByKey } from './agent-action-policy'

export const WATCHER_KINDS = [
  'stock_expiring',
  'stock_low',
  'work_overdue',
  'data_missing',
  'results_off',
] as const
export type WatcherKind = (typeof WATCHER_KINDS)[number]

export const WATCHER_SCHEDULES = ['hourly', 'daily', 'weekly'] as const
export type WatcherSchedule = (typeof WATCHER_SCHEDULES)[number]

export const WATCHER_SCHEDULE_LABEL: Record<WatcherSchedule, string> = {
  hourly: 'Every hour',
  daily: 'Every day',
  weekly: 'Every week',
}

export interface WatcherMeta {
  kind: WatcherKind
  label: string
  /** What it looks for, in a sentence a scientist would say. */
  description: string
  /** A setting the watcher takes, if any. */
  param?: {
    key: 'days' | 'sigma'
    label: string
    unit: string
    defaultValue: number
    min: number
    max: number
  }
}

export const WATCHERS: readonly WatcherMeta[] = Object.freeze([
  {
    kind: 'stock_expiring',
    label: 'Lots about to expire',
    description:
      'Reagent lots that expire soon, with no order open and nothing planned for them.',
    param: {
      key: 'days',
      label: 'Warn this far ahead',
      unit: 'days',
      defaultValue: 30,
      min: 1,
      max: 365,
    },
  },
  {
    kind: 'stock_low',
    label: 'Reagents running low',
    description:
      'Reagents at or below their low-stock level that nobody has ordered more of.',
  },
  {
    kind: 'work_overdue',
    label: 'Overdue experiments',
    description:
      'Experiments past the day they were planned to finish and still open.',
  },
  {
    kind: 'data_missing',
    label: 'Missing data before review',
    description:
      'Experiments with every step ticked off but no results, tables or sheets recorded.',
  },
  {
    kind: 'results_off',
    label: 'Results off from past runs',
    description:
      'Recent sample measurements far from what the same measurement usually gives.',
    param: {
      key: 'sigma',
      label: 'Flag results this far off',
      unit: 'standard deviations',
      defaultValue: 3,
      min: 1,
      max: 10,
    },
  },
] satisfies WatcherMeta[])

export function watcherMeta(kind: string): WatcherMeta | undefined {
  return WATCHERS.find((watcher) => watcher.kind === kind)
}

export interface LabWatcherRow {
  id: string
  workspace_id: string
  kind: WatcherKind
  enabled: boolean
  project_id: string | null
  schedule: WatcherSchedule
  params: Record<string, unknown>
  owner_user_id: string
  last_run_at: string | null
  last_found: number | null
  next_run_at: string
  created_at: string
  updated_at: string
}

export type FindingStatus = 'open' | 'snoozed' | 'dismissed' | 'resolved'

export interface SuggestedAction {
  kind: 'lab_action'
  label: string
  action: string
  arguments: Record<string, unknown>
}

export interface LabWatcherFindingRow {
  id: string
  workspace_id: string
  watcher_id: string
  kind: WatcherKind
  object_kind: string
  object_id: string | null
  project_id: string | null
  title: string
  summary: string
  suggested_action: SuggestedAction | null
  status: FindingStatus
  snoozed_until: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export const watcherKeys = {
  watchers: ['lab-watchers', 'list'] as const,
  findings: ['lab-watchers', 'findings'] as const,
  finding: (id: string) => ['lab-watchers', 'finding', id] as const,
}

export async function fetchLabWatchers(
  client: Pick<DataClient, 'list'>,
): Promise<LabWatcherRow[]> {
  return client.list<LabWatcherRow>('lab_watchers', '?select=*&order=kind.asc')
}

export async function fetchWatcherFindings(
  client: Pick<DataClient, 'list'>,
  limit = 100,
): Promise<LabWatcherFindingRow[]> {
  return client.list<LabWatcherFindingRow>(
    'lab_watcher_findings',
    `?select=*&status=neq.resolved&order=created_at.desc&limit=${limit}`,
  )
}

export async function fetchWatcherFinding(
  client: Pick<DataClient, 'list'>,
  id: string,
): Promise<LabWatcherFindingRow | null> {
  const rows = await client.list<LabWatcherFindingRow>(
    'lab_watcher_findings',
    `?select=*&id=eq.${encodeURIComponent(id)}`,
  )
  return rows.at(0) ?? null
}

export async function setLabWatcher(
  client: Pick<DataClient, 'rpc'>,
  input: {
    workspaceId: string
    kind: WatcherKind
    enabled: boolean
    schedule: WatcherSchedule
    projectId?: string | null
    params?: Record<string, unknown>
  },
): Promise<LabWatcherRow> {
  return client.rpc<LabWatcherRow>('set_lab_watcher', {
    p_workspace_id: input.workspaceId,
    p_kind: input.kind,
    p_enabled: input.enabled,
    p_schedule: input.schedule,
    p_project_id: input.projectId ?? null,
    p_params: input.params ?? {},
  })
}

export async function runLabWatcherNow(
  client: Pick<DataClient, 'rpc'>,
  watcherId: string,
): Promise<number> {
  return client.rpc<number>('run_lab_watcher', { p_watcher_id: watcherId })
}

export async function setFindingStatus(
  client: Pick<DataClient, 'rpc'>,
  input: {
    findingId: string
    action: 'dismiss' | 'snooze' | 'reopen'
    until?: Date
  },
): Promise<LabWatcherFindingRow> {
  return client.rpc<LabWatcherFindingRow>('set_watcher_finding_status', {
    p_finding_id: input.findingId,
    p_action: input.action,
    p_until: input.until ? input.until.toISOString() : null,
  })
}

/**
 * Do what a finding suggests, as the person pressing the button. Only a lab
 * action the app knows is run; the ordinary RPC applies the person's own access.
 */
export async function runSuggestedAction(
  client: Pick<DataClient, 'rpc'>,
  finding: Pick<LabWatcherFindingRow, 'suggested_action'>,
): Promise<void> {
  const suggestion = finding.suggested_action
  if (!suggestion) return
  if (!agentActionByKey(suggestion.action)) {
    throw new Error('This suggestion is not something the app can do.')
  }
  await client.rpc(suggestion.action, suggestion.arguments)
}

/** Snooze lengths offered on a finding. */
export const SNOOZE_CHOICES = [
  { label: 'Tomorrow', days: 1 },
  { label: 'Next week', days: 7 },
  { label: 'Next month', days: 30 },
] as const

export function snoozeUntil(days: number, now = new Date()): Date {
  const until = new Date(now)
  until.setDate(until.getDate() + days)
  until.setHours(8, 0, 0, 0)
  return until
}
