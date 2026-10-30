import { t } from '#/copy'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { now } from '#/lib/clock'
import { notebookDataClient } from '#/lib/notebook-data'
import { listByIds } from '#/lib/chunk-ids'
import { containsPattern } from '#/lib/postgrest-contains'
import {
  fetchWorkspaceMemberIdentities,
  workspaceMemberQueryKeys,
} from '#/components/v3/projects/project-data'

/** UI port (roadmap-4/ui-app3): the experiments list, mapped from real
 * experiment records. Protocol version and open issues are design fields the
 * data model does not carry yet and render as gaps; the model carries no
 * experiment start date either, so the list shows when the record was created.
 *
 * The database does the filtering: the tab, project, date window and search
 * text all become part of the read, and the tab counts are counted under the
 * same filters. The list then loads one page at a time
 * (`EXPERIMENT_LIST_PAGE_SIZE`) of exactly the rows the open tab counts, so a
 * workspace of any size neither misses rows nor shows a count its list cannot
 * reach. */

export interface ExperimentListRow {
  uuid: string
  id: string
  title: string
  projectId: string | null
  project: string
  ownerId: string
  owner: string
  status: { tone: Tone; label: string }
  /** The status tab that lists this record, so the tabs filter the same
   * statuses their counts count. Null only for a status the table does not
   * know, which stays reachable in `all`. */
  statusTab: ExperimentStatusTab | 'archived' | null
  protocol: string
  protocolRecordId: string | null
  /** The version of the protocol the experiment started on, when recorded. */
  protocolVersion: number | null
  created: string
  updated: string
  /** The stored instants behind `created` and `updated`. */
  createdAt: string
  updatedAt: string
  recent: boolean
}

interface ExperimentWire {
  id: string
  project_id: string | null
  identifier: string
  title: string
  status: string
  created_by_user_id: string
  created_at: string
  updated_at: string
  archived_at?: string | null
}

/** The list's tabs. `experiments.tsx` renders exactly these. */
export type ExperimentTabKey =
  | 'all'
  | 'mine'
  | 'inprogress'
  | 'onhold'
  | 'inreview'
  | 'approved'
  | 'planned'
  | 'drafts'
  | 'archived'

/** The tabs that group experiments by status. `all` is the whole workspace and
 * `mine` is the caller's own experiments, so neither is a status tab. */
export type ExperimentStatusTab = Exclude<
  ExperimentTabKey,
  'all' | 'mine' | 'archived'
>

/**
 * Every status an experiment record can carry, and the status tab that lists
 * it. `api.start_experiment` leaves `draft`; `api.set_experiment_status` moves
 * the record through `in_progress` → `in_review` → `returned`/`approved`; and
 * the rows written before that lifecycle still carry `planned`, `paused` and
 * `on_hold`. `returned` stays in the review tab it came back from, exactly as
 * `planned` has a tab of its own beside Drafts. The remaining entries are the shared
 * record vocabulary this list renders for other kinds too, and sit with the
 * terminal stage.
 *
 * `tab` is what makes every experiment reachable from a tab: each status is
 * listed by exactly one, so the status tabs' counts add up to `all`.
 */
const STATUS: Partial<
  Record<string, { tone: Tone; label: string; tab: ExperimentStatusTab }>
> = {
  draft: {
    tone: 'draft',
    label: t('projects.experimentsData.draft'),
    tab: 'drafts',
  },
  planned: {
    tone: 'draft',
    label: t('projects.experimentsData.planned'),
    tab: 'planned',
  },
  in_progress: {
    tone: 'progress',
    label: t('projects.experimentsData.inProgress'),
    tab: 'inprogress',
  },
  in_review: {
    tone: 'review',
    label: t('projects.experimentsData.inReview'),
    tab: 'inreview',
  },
  returned: {
    tone: 'warn',
    label: t('projects.experimentsData.returned'),
    tab: 'inreview',
  },
  approved: {
    tone: 'ok',
    label: t('projects.experimentsData.approved'),
    tab: 'approved',
  },
  completed: {
    tone: 'ok',
    label: t('projects.experimentsData.completed'),
    tab: 'approved',
  },
  locked: {
    tone: 'stored',
    label: t('projects.experimentsData.locked'),
    tab: 'approved',
  },
  failed: {
    tone: 'bad',
    label: t('projects.experimentsData.failed'),
    tab: 'approved',
  },
  paused: {
    tone: 'warn',
    label: t('projects.experimentsData.onHold'),
    tab: 'onhold',
  },
  on_hold: {
    tone: 'warn',
    label: t('projects.experimentsData.onHold'),
    tab: 'onhold',
  },
}

export function experimentStatus(status: string): {
  tone: Tone
  label: string
} {
  const known = STATUS[status]
  return known
    ? { tone: known.tone, label: known.label }
    : {
        tone: 'none',
        label: status
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      }
}

/** What narrows the list besides the open tab. The tab counts are counted under
 * the same scope, so a tab's number is the length of the list behind it. */
export interface ExperimentListScope {
  projectId?: string
  /** Only experiments changed at or after this instant. Unset reads all time. */
  since?: string
  query?: string
  /** Projects and people whose names match the search text; the database
   * cannot see names, so the app names them and the read matches their IDs. */
  matchProjectIds?: string[]
  matchOwnerIds?: string[]
}

export interface ExperimentListFilter extends ExperimentListScope {
  tab: ExperimentTabKey
  userId?: string
}

export type ExperimentListSort = 'updated' | 'id'

export const experimentListQueryKeys = {
  page: (
    workspaceId: string | undefined,
    filter: ExperimentListFilter,
    sort: ExperimentListSort,
    limit: number,
  ) => ['ui-port', 'experiments', workspaceId, filter, sort, limit] as const,
  tabCounts: (userId: string | undefined, scope: ExperimentListScope) =>
    ['ui-port', 'experiments', 'tab-counts', userId, scope] as const,
}

/** One page of the experiments list. Loading is explicit: the route raises the
 * limit to load more, and the exact totals come from `useExperimentTabCounts`. */
export const EXPERIMENT_LIST_PAGE_SIZE = 300

/** The record filter every experiment read and count shares. */
const EXPERIMENT_FILTER = 'kind=eq.experiment&deleted_at=is.null'

const EXPERIMENT_SELECT =
  'select=id,project_id,identifier,title,status,created_by_user_id,created_at,updated_at,archived_at'

/** The statuses a status tab lists, from the table above. */
function statusesForTab(tab: ExperimentStatusTab): string[] {
  return Object.entries(STATUS)
    .filter(([, entry]) => entry?.tab === tab)
    .map(([status]) => status)
}

/** The PostgREST filters for the open tab and scope. These mirror the clauses
 * of `api.experiment_tab_counts`, so a list and its count cannot disagree. */
export function experimentListFilters(filter: ExperimentListFilter): string[] {
  const clauses = [EXPERIMENT_FILTER]
  if (filter.tab === 'archived') clauses.push('archived_at=not.is.null')
  else {
    clauses.push('archived_at=is.null')
    if (filter.tab === 'mine')
      clauses.push(
        `created_by_user_id=eq.${encodeURIComponent(filter.userId ?? '')}`,
      )
    else if (filter.tab !== 'all')
      clauses.push(`status=in.(${statusesForTab(filter.tab).join(',')})`)
  }
  if (filter.projectId)
    clauses.push(`project_id=eq.${encodeURIComponent(filter.projectId)}`)
  if (filter.since)
    clauses.push(`updated_at=gte.${encodeURIComponent(filter.since)}`)
  const term = (filter.query ?? '').trim()
  if (term) {
    const pattern = encodeURIComponent(containsPattern(term))
    const alternatives = [
      `identifier.ilike.${pattern}`,
      `title.ilike.${pattern}`,
    ]
    if (filter.matchProjectIds?.length)
      alternatives.push(`project_id.in.(${filter.matchProjectIds.join(',')})`)
    if (filter.matchOwnerIds?.length)
      alternatives.push(
        `created_by_user_id.in.(${filter.matchOwnerIds.map(encodeURIComponent).join(',')})`,
      )
    clauses.push(`or=(${alternatives.join(',')})`)
  }
  return clauses
}

export function toExperimentListRow(
  row: ExperimentWire,
  projectNames: Map<string, string>,
  ownerNames: Map<string, string>,
): ExperimentListRow {
  const updated = Date.parse(row.updated_at)
  return {
    uuid: row.id,
    id: row.identifier,
    title: row.title,
    projectId: row.project_id,
    project: row.project_id ? (projectNames.get(row.project_id) ?? '—') : '—',
    ownerId: row.created_by_user_id,
    owner: ownerNames.get(row.created_by_user_id) ?? '—',
    status: experimentStatus(row.status),
    statusTab: row.archived_at ? 'archived' : (STATUS[row.status]?.tab ?? null),
    protocol: '—',
    protocolRecordId: null,
    protocolVersion: null,
    created: row.created_at.slice(0, 10),
    updated: row.updated_at.slice(0, 10),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recent:
      !Number.isNaN(updated) && now().getTime() - updated <= RECENT_WINDOW_MS,
  }
}

/** How far back "recent" reaches: the list's default date window. */
export const RECENT_WINDOW_MS = 30 * 86_400_000

/** The instant the default date window starts at, rounded down to the hour so
 * the list and its counts share one cache entry for the whole hour. */
export function recentSince(): string {
  const hour = 3_600_000
  return new Date(
    Math.floor((now().getTime() - RECENT_WINDOW_MS) / hour) * hour,
  ).toISOString()
}

export function useExperimentRecords(
  workspaceId: string | undefined,
  filter: ExperimentListFilter = { tab: 'all' },
  sort: ExperimentListSort = 'updated',
  limit: number = EXPERIMENT_LIST_PAGE_SIZE,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: experimentListQueryKeys.page(workspaceId, filter, sort, limit),
    // Keep the rows on screen while a new tab or search loads, so the list
    // does not blank on every change.
    placeholderData: keepPreviousData,
    queryFn: () =>
      client.list<ExperimentWire>(
        'records',
        `?${experimentListFilters(filter).join('&')}&${EXPERIMENT_SELECT}&order=${
          sort === 'id'
            ? 'created_at.desc,identifier.desc'
            : 'updated_at.desc,id.asc'
        }&limit=${limit}`,
      ),
    staleTime: 15_000,
  })
}

export type ExperimentTabCounts = Record<ExperimentTabKey, number>

/** The tabs in strip order. `useExperimentTabCounts` zips its counts with this
 * list, so it must cover every key exactly once. */
const EXPERIMENT_TAB_KEYS: readonly ExperimentTabKey[] = [
  'all',
  'mine',
  'inprogress',
  'onhold',
  'inreview',
  'approved',
  'planned',
  'drafts',
  'archived',
]

interface TabCountWire {
  status: string
  archived: boolean
  total: number | string
  mine: number | string
}

/**
 * Exact per-tab totals (and the workspace total on `all`). The list itself
 * loads one page at a time, so counting the loaded rows would understate a
 * busy workspace; these counts come from the database instead. One grouped
 * read (`api.experiment_tab_counts`) replaces a request per tab, and the
 * status table above files each status under its tab, so the status tabs add
 * up to `all` and match what their lists show.
 */
export function useExperimentTabCounts(
  userId: string | undefined,
  scope: ExperimentListScope = {},
  enabled = true,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: experimentListQueryKeys.tabCounts(userId, scope),
    enabled: enabled && Boolean(userId),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ExperimentTabCounts> => {
      const params = [`p_user_id=${encodeURIComponent(userId ?? '')}`]
      if (scope.projectId)
        params.push(`p_project_id=${encodeURIComponent(scope.projectId)}`)
      if (scope.since) params.push(`p_since=${encodeURIComponent(scope.since)}`)
      if (scope.query?.trim()) {
        params.push(`p_query=${encodeURIComponent(scope.query.trim())}`)
        if (scope.matchProjectIds?.length)
          params.push(
            `p_match_project_ids=${encodeURIComponent(`{${scope.matchProjectIds.join(',')}}`)}`,
          )
        if (scope.matchOwnerIds?.length)
          params.push(
            `p_match_owner_ids=${encodeURIComponent(`{${scope.matchOwnerIds.map((id) => `"${id}"`).join(',')}}`)}`,
          )
      }
      const rows = await client.list<TabCountWire>(
        'rpc/experiment_tab_counts',
        `?${params.join('&')}&select=status,archived,total,mine`,
      )
      const counts = Object.fromEntries(
        EXPERIMENT_TAB_KEYS.map((tab) => [tab, 0]),
      ) as ExperimentTabCounts
      for (const row of rows) {
        const total = Number(row.total)
        if (row.archived) {
          counts.archived += total
          continue
        }
        counts.all += total
        counts.mine += Number(row.mine)
        const tab = STATUS[row.status]?.tab
        if (tab) counts[tab] += total
      }
      return counts
    },
    staleTime: 15_000,
  })
}

interface OpenIssueWire {
  record_id: string
  open_issues: number | string
}

/**
 * RM-119: open-issue counts per experiment, the uncleared dataset value flags
 * on the datasets the experiment produced (see `api.experiment_open_issue_counts`).
 */
export function useExperimentOpenIssues(
  workspaceId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'experiments', 'open-issues', workspaceId],
    queryFn: async () => {
      const rows = await client.list<OpenIssueWire>(
        'rpc/experiment_open_issue_counts',
        '?select=record_id,open_issues',
      )
      return new Map(rows.map((r) => [r.record_id, Number(r.open_issues)]))
    },
    staleTime: 15_000,
  })
}

/** The workspace's people, for matching a search against owner names. */
export function useWorkspaceMemberNames() {
  return useQuery({
    queryKey: workspaceMemberQueryKeys.identities,
    queryFn: async () =>
      (await fetchWorkspaceMemberIdentities()).map((m) => ({
        userId: m.user_id,
        name: m.name,
      })),
    staleTime: 60_000,
  })
}

export function useProjectNameMap(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: ['ui-port', 'experiments', 'projects'],
    queryFn: async () => {
      const rows = await client.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title',
      )
      return new Map(rows.map((r) => [r.id, r.title]))
    },
    staleTime: 60_000,
  })
}

interface ProtocolLinkWire {
  source_record_id: string
  target_record_id: string | null
  target_identifier: string | null
  link_metadata?: { version?: unknown } | null
}

export interface ExperimentProtocol {
  identifier: string
  recordId: string | null
  version: number | null
}

/** The protocol each experiment follows, from `record_links` (link_type
 * 'protocol', experiment as source). */
export function useExperimentProtocols(
  experimentIds: string[],
  client: DataClient = notebookDataClient,
) {
  const key = experimentIds.join(',')
  return useQuery({
    queryKey: ['ui-port', 'experiments', 'protocols', key],
    enabled: experimentIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, ExperimentProtocol>()
      // One request per group of ids, all at once: the groups used to be read
      // one after another, which put a dozen round trips between the list and
      // its Protocol column.
      const rows = await listByIds(experimentIds, (inList) =>
        client.list<ProtocolLinkWire>(
          'record_links',
          `?source_record_id=in.(${inList})&link_type=eq.protocol&select=source_record_id,target_record_id,target_identifier,link_metadata`,
        ),
      )
      for (const row of rows) {
        if (!row.target_identifier) continue
        map.set(row.source_record_id, {
          identifier: row.target_identifier,
          recordId: row.target_record_id,
          version:
            typeof row.link_metadata?.version === 'number'
              ? row.link_metadata.version
              : null,
        })
      }
      return map
    },
    staleTime: 30_000,
  })
}
