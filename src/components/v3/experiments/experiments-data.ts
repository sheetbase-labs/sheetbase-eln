import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (roadmap-4/ui-app3): the experiments list, mapped from real
 * experiment records. Protocol version and open issues are design fields the
 * data model does not carry yet and render as gaps; the model carries no
 * experiment start date either, so the list shows when the record was created.
 *
 * The list loads one page at a time (`EXPERIMENT_LIST_PAGE_SIZE`) and reads the
 * exact total separately, so a workspace with more experiments than one page
 * states how many are loaded instead of dropping the rest silently. */

export interface ExperimentListRow {
  uuid: string
  id: string
  title: string
  projectId: string | null
  project: string
  ownerId: string
  owner: string
  status: { tone: Tone; label: string }
  protocol: string
  protocolRecordId: string | null
  created: string
  updated: string
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
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'draft', label: 'Draft' },
  planned: { tone: 'draft', label: 'Planned' },
  in_progress: { tone: 'progress', label: 'In progress' },
  in_review: { tone: 'review', label: 'In review' },
  approved: { tone: 'ok', label: 'Approved' },
  locked: { tone: 'stored', label: 'Locked' },
  paused: { tone: 'warn', label: 'On hold' },
  failed: { tone: 'bad', label: 'Failed' },
}

export function experimentStatus(status: string): {
  tone: Tone
  label: string
} {
  return (
    STATUS[status] ?? {
      tone: 'none',
      label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }
  )
}

export const experimentListQueryKeys = {
  page: (workspaceId: string | undefined, limit: number) =>
    ['ui-port', 'experiments', workspaceId, limit] as const,
  tabCounts: (userId: string | undefined) =>
    ['ui-port', 'experiments', 'tab-counts', userId] as const,
}

/** One page of the experiments list. Loading is explicit: the route raises the
 * limit to load more, and the exact totals come from `useExperimentTabCounts`. */
export const EXPERIMENT_LIST_PAGE_SIZE = 300

/** The record filter every experiment read and count shares. */
const EXPERIMENT_FILTER = 'kind=eq.experiment&deleted_at=is.null'

const EXPERIMENT_SELECT =
  'select=id,project_id,identifier,title,status,created_by_user_id,created_at,updated_at'

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
    protocol: '—',
    protocolRecordId: null,
    created: row.created_at.slice(0, 10),
    updated: row.updated_at.slice(0, 10),
    recent: !Number.isNaN(updated) && Date.now() - updated <= 30 * 86_400_000,
  }
}

export function useExperimentRecords(
  workspaceId: string | undefined,
  limit: number = EXPERIMENT_LIST_PAGE_SIZE,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: experimentListQueryKeys.page(workspaceId, limit),
    queryFn: () =>
      client.list<ExperimentWire>(
        'records',
        `?${EXPERIMENT_FILTER}&${EXPERIMENT_SELECT}&order=updated_at.desc&limit=${limit}`,
      ),
    staleTime: 15_000,
  })
}

/** The list's tabs. `experiments.tsx` renders exactly these. */
export type ExperimentTabKey =
  | 'all'
  | 'mine'
  | 'inprogress'
  | 'inreview'
  | 'approved'
  | 'drafts'

export type ExperimentTabCounts = Record<ExperimentTabKey, number>

/** Each tab's record filter, mirroring the statuses `experimentStatus` maps to
 * the tab's tone — so a tab's count is the same predicate its rows come from. */
const EXPERIMENT_TAB_FILTER: Record<
  ExperimentTabKey,
  (userId: string) => string
> = {
  all: () => '',
  mine: (userId) => `&created_by_user_id=eq.${encodeURIComponent(userId)}`,
  inprogress: () => '&status=eq.in_progress',
  inreview: () => '&status=eq.in_review',
  approved: () => '&status=eq.approved',
  drafts: () => '&status=in.(draft,planned)',
}

const EXPERIMENT_TAB_KEYS = Object.keys(
  EXPERIMENT_TAB_FILTER,
) as ExperimentTabKey[]

/**
 * Exact per-tab totals (and the workspace total on `all`). The list itself
 * loads one page at a time, so counting the loaded rows would understate a
 * busy workspace; these counts come from the database instead.
 */
export function useExperimentTabCounts(
  userId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: experimentListQueryKeys.tabCounts(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<ExperimentTabCounts> => {
      const totals = await Promise.all(
        EXPERIMENT_TAB_KEYS.map((tab) =>
          client.count(
            'records',
            `?${EXPERIMENT_FILTER}${EXPERIMENT_TAB_FILTER[tab](userId ?? '')}`,
          ),
        ),
      )
      return Object.fromEntries(
        EXPERIMENT_TAB_KEYS.map((tab, index) => [tab, totals[index]]),
      ) as ExperimentTabCounts
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
}

export interface ExperimentProtocol {
  identifier: string
  recordId: string | null
}

/** Chunk ids so the proxy's 500-char single-value cap is never exceeded. */
function chunkIds(ids: string[], size = 12): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
  return chunks
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
      for (const chunk of chunkIds(experimentIds)) {
        const filter = chunk.map((id) => encodeURIComponent(id)).join(',')
        const rows = await client.list<ProtocolLinkWire>(
          'record_links',
          `?source_record_id=in.(${filter})&link_type=eq.protocol&select=source_record_id,target_record_id,target_identifier`,
        )
        for (const row of rows) {
          if (!row.target_identifier) continue
          map.set(row.source_record_id, {
            identifier: row.target_identifier,
            recordId: row.target_record_id,
          })
        }
      }
      return map
    },
    staleTime: 30_000,
  })
}
