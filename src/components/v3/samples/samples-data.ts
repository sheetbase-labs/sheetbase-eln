import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchSamplesPage } from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import type { RegistryQuery } from '#/lib/registry'

/** UI port (roadmap-4/ui-app3): the sample registry, mapped from real sample
 * records onto the app-3 list shape. */

export interface SampleListRow {
  uuid: string
  id: string
  name: string
  type: string
  project: string
  quantity: string
  location: string
  status: { tone: Tone; label: string }
  tabs: string[]
  ownerId: string
}

const EMPTY_QUERY: RegistryQuery = {
  pageIndex: 0,
  pageSize: 200,
  sorting: [],
  grouping: [],
  filters: [],
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  available: { tone: 'ok', label: 'Available' },
  reserved: { tone: 'progress', label: 'Reserved' },
  frozen: { tone: 'stored', label: 'Frozen' },
  quarantined: { tone: 'warn', label: 'Quarantine' },
  expired: { tone: 'bad', label: 'Expired' },
  hold_exceeded: { tone: 'bad', label: 'Hold exceeded' },
  consumed: { tone: 'stored', label: 'Consumed' },
  disposed: { tone: 'stored', label: 'Disposed' },
}

export function sampleStatus(status: string): { tone: Tone; label: string } {
  return (
    STATUS[status] ?? {
      tone: 'none',
      label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }
  )
}

export function toSampleListRow(
  record: SampleRecord,
  projectNames: Map<string, string>,
  meId: string | undefined,
): SampleListRow {
  const quantity =
    record.quantity != null
      ? `${record.quantity.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${record.quantityUnit ? ` ${record.quantityUnit}` : ''}`
      : '—'
  const tabs: string[] = []
  if (record.status === 'consumed' || record.status === 'disposed') {
    // Both are terminal states kept for lineage and audit. The registry's
    // terminal tab is "Consumed"; a dedicated Disposed tab would live in
    // src/routes/samples.tsx and is outside this slice, so a disposed row is
    // grouped with consumed rather than shown as in stock or hidden entirely.
    tabs.push('consumed')
  } else {
    tabs.push('instock')
    if (record.status === 'quarantined') tabs.push('quarantine')
    if (record.status === 'reserved') tabs.push('awaiting')
  }
  if (meId && record.createdByUserId === meId) tabs.push('mine')
  return {
    uuid: record.id,
    id: record.identifier,
    name: record.title,
    type: record.sampleType ?? '—',
    project: record.projectId
      ? (projectNames.get(record.projectId) ?? '—')
      : '—',
    quantity,
    location: record.storageLocation ?? '—',
    status: sampleStatus(record.status),
    tabs,
    ownerId: record.createdByUserId,
  }
}

export const sampleListQueryKeys = {
  page: ['ui-port', 'samples', 'page'] as const,
  projects: ['ui-port', 'samples', 'projects'] as const,
}

/**
 * The registry searches, filters and counts tabs in memory, so it reads every
 * sample rather than the first page: a 200-row read hid sample 201 onward and
 * made search report a false "no match" while the header showed the real total.
 */
export async function fetchAllSamples(
  client: DataClient,
): Promise<{ rows: SampleRecord[]; totalCount: number }> {
  const rows: SampleRecord[] = []
  let totalCount = 0
  for (;;) {
    const page = await fetchSamplesPage(client, {
      ...EMPTY_QUERY,
      pageIndex: Math.floor(rows.length / EMPTY_QUERY.pageSize),
    })
    totalCount = page.totalCount
    rows.push(...page.rows)
    if (page.rows.length < EMPTY_QUERY.pageSize) break
  }
  return { rows, totalCount }
}

export function useSamplePage(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: sampleListQueryKeys.page,
    queryFn: () => fetchAllSamples(client),
    staleTime: 15_000,
  })
}

export function useProjectNames(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: sampleListQueryKeys.projects,
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
