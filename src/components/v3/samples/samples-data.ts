import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { toSampleRecord } from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import type { RecordWire } from '#/lib/notebook-data'
import { containsPattern } from '#/lib/postgrest-contains'

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

/**
 * How the registry words a sample's state. A sample that is in stock reads
 * "Stored", or "Released" once it carries a release record; one waiting for a
 * reading reads "Awaiting measurement". The stored status stays the lifecycle
 * the database enforces.
 */
export function sampleStatus(
  status: string,
  releasedAt?: string | null,
): { tone: Tone; label: string } {
  if (status === 'available') {
    return releasedAt
      ? { tone: 'ok', label: 'Released' }
      : { tone: 'stored', label: 'Stored' }
  }
  if (status === 'reserved') {
    return { tone: 'progress', label: 'Awaiting measurement' }
  }
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
    status: sampleStatus(record.status, record.releasedAt),
    tabs,
    ownerId: record.createdByUserId,
  }
}

export const sampleListQueryKeys = {
  /** Every sample list and count read starts with this key, so invalidating it
   * refreshes the rows and the tab numbers together. */
  page: ['ui-port', 'samples', 'page'] as const,
  projects: ['ui-port', 'samples', 'projects'] as const,
}

export const SAMPLE_TABS = [
  'instock',
  'mine',
  'awaiting',
  'quarantine',
  'consumed',
] as const
export type SampleTabKey = (typeof SAMPLE_TABS)[number]

/** How many samples the list loads at a time; the footer says how many more
 * the open tab holds and loads them on request. */
export const SAMPLE_LIST_PAGE_SIZE = 200

const SAMPLE_BASE = 'kind=eq.sample&deleted_at=is.null&archived_at=is.null'

const SAMPLE_SELECT =
  'select=id,workspace_id,project_id,kind,identifier,title,status,tags,structure_version,metadata_version,created_at,updated_at,archived_at,deleted_at,created_by_user_id,updated_by_user_id,properties,custom_fields'

/** The PostgREST filters for a sample tab and search. These put the tabs of
 * `toSampleListRow` in the database: a terminal sample (consumed or disposed)
 * leaves stock, quarantined and reserved samples are in stock and also have
 * their own tab, and Mine is the caller's own samples in any state. */
export function sampleListFilters(
  tab: SampleTabKey,
  userId: string | undefined,
  query: string | undefined,
): string[] {
  const clauses = [SAMPLE_BASE]
  if (tab === 'instock') clauses.push('status=not.in.(consumed,disposed)')
  else if (tab === 'quarantine') clauses.push('status=eq.quarantined')
  else if (tab === 'awaiting') clauses.push('status=eq.reserved')
  else if (tab === 'consumed') clauses.push('status=in.(consumed,disposed)')
  else clauses.push(`created_by_user_id=eq.${encodeURIComponent(userId ?? '')}`)
  const term = (query ?? '').trim()
  if (term) {
    const pattern = encodeURIComponent(containsPattern(term))
    clauses.push(
      `or=(identifier.ilike.${pattern},title.ilike.${pattern},properties->>sampleType.ilike.${pattern},properties->>storageLocation.ilike.${pattern})`,
    )
  }
  return clauses
}

/** One page of the open tab, newest first (identifiers are issued in order, so
 * the registration time is the same order without sorting the text). */
export function useSampleList(
  tab: SampleTabKey,
  userId: string | undefined,
  query: string | undefined,
  limit: number = SAMPLE_LIST_PAGE_SIZE,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: [...sampleListQueryKeys.page, 'rows', tab, userId, query, limit],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SampleRecord[]> =>
      (
        await client.list<RecordWire>(
          'records',
          `?${sampleListFilters(tab, userId, query).join('&')}&order=created_at.desc,identifier.desc&limit=${limit}&${SAMPLE_SELECT}`,
        )
      ).map(toSampleRecord),
    staleTime: 15_000,
  })
}

/** How many samples each tab holds under the current search, counted by the
 * database so the numbers stay right past the first page. */
export function useSampleTabCounts(
  userId: string | undefined,
  query: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: [...sampleListQueryKeys.page, 'counts', userId, query],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Record<SampleTabKey, number>> => {
      const totals = await Promise.all(
        SAMPLE_TABS.map((tab) =>
          client.count(
            'records',
            `?${sampleListFilters(tab, userId, query).join('&')}`,
          ),
        ),
      )
      return Object.fromEntries(
        SAMPLE_TABS.map((tab, i) => [tab, totals[i]]),
      ) as Record<SampleTabKey, number>
    },
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

/** The distinct, non-empty locations in a list, sorted for a picker. */
export function distinctLocations(
  values: readonly (string | null | undefined)[],
): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed && !seen.has(trimmed.toLowerCase()))
      seen.set(trimmed.toLowerCase(), trimmed)
  }
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, 'en-GB', { numeric: true, sensitivity: 'base' }),
  )
}

export const storageLocationsQueryKey = [
  'ui-port',
  'samples',
  'locations',
] as const

/** Every location a sample is already stored at, so a move or a registration
 * can pick one instead of retyping it. The database lists each place once, so
 * a large registry is not cut off. */
export async function fetchStorageLocations(
  client: DataClient,
): Promise<string[]> {
  const rows = await client.list<{ location: string | null }>(
    'rpc/sample_storage_locations',
    '?select=location',
  )
  return distinctLocations(rows.map((row) => row.location))
}

export function useStorageLocations(
  client: DataClient = notebookDataClient,
  enabled = true,
) {
  return useQuery({
    queryKey: storageLocationsQueryKey,
    queryFn: () => fetchStorageLocations(client),
    staleTime: 60_000,
    enabled,
  })
}
