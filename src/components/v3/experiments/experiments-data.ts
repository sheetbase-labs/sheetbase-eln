import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (roadmap-4/ui-app3): the experiments list, mapped from real
 * experiment records. Protocol version, open issues and started date are
 * design fields the data model does not carry yet and render as gaps. */

export interface ExperimentListRow {
  uuid: string
  id: string
  title: string
  projectId: string | null
  project: string
  ownerId: string
  owner: string
  status: { tone: Tone; label: string }
  started: string
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
  page: (workspaceId: string | undefined) =>
    ['ui-port', 'experiments', workspaceId] as const,
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
    started: row.created_at.slice(0, 10),
    updated: row.updated_at.slice(0, 10),
    recent: !Number.isNaN(updated) && Date.now() - updated <= 30 * 86_400_000,
  }
}

export function useExperimentRecords(
  workspaceId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: experimentListQueryKeys.page(workspaceId),
    queryFn: () =>
      client.list<ExperimentWire>(
        'records',
        '?kind=eq.experiment&deleted_at=is.null&select=id,project_id,identifier,title,status,created_by_user_id,created_at,updated_at&order=updated_at.desc&limit=300',
      ),
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
