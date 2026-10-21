/**
 * UI port (roadmap-4/ui-app3): data for the searchable record picker. Reads the
 * real search RPC through the same-origin proxy, limited to the kinds the
 * picker offers, and returns per-kind counts.
 *
 * R5-SHELL-04: an empty query shows the current person's recently viewed
 * records, read from `api.recently_viewed` (FIND-01) — the same per-user record
 * the Home recents surface uses. Nothing is fabricated from a page of results;
 * when the person has no history the picker keeps its honest "Nothing recent".
 */
import { executeSearch } from '#/lib/search'
import type { SearchResult } from '#/lib/search'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import type { Tone } from '#/components/v3/ui/status'
import { listByIds } from '#/lib/chunk-ids'

export type PickerKind = 'Sample' | 'Material' | 'Dataset' | 'Experiment'

export interface PickerItem {
  /** The canonical record id (or dataset id), the stable target identity. */
  id: string
  /** The human identifier (e.g. SMP-2249), preserved on the link. */
  identifier: string
  name: string
  kind: PickerKind
  status: { tone: Tone; label: string }
  project: string
}

export interface PickerResult {
  recent: boolean
  items: PickerItem[]
  counts: Record<PickerKind, number>
  total: number
}

export const pickerKinds: PickerKind[] = [
  'Sample',
  'Material',
  'Dataset',
  'Experiment',
]

/** Record kinds the picker offers, mapped to their picker kind. */
const PICKER_KIND_BY_RECORD_KIND = new Map<string, PickerKind>([
  ['sample', 'Sample'],
  ['material', 'Material'],
  ['experiment', 'Experiment'],
])

const pickerClient: DataClient = createDataClient()

const emptyCounts = (): Record<PickerKind, number> => ({
  Sample: 0,
  Material: 0,
  Dataset: 0,
  Experiment: 0,
})

/**
 * Map a search result to a picker item, or null when it is not a picker kind.
 * `projectNames` resolves the item's project to its display title for the
 * subtitle; without it the subtitle line simply has no project.
 */
export function toPickerItem(
  result: SearchResult,
  projectNames?: Map<string, string>,
): PickerItem | null {
  let kind: PickerKind | null = null
  if (result.resultType === 'dataset') kind = 'Dataset'
  else if (result.resultType === 'record')
    kind = PICKER_KIND_BY_RECORD_KIND.get(result.kind) ?? null
  if (!kind) return null
  return {
    id: result.recordId,
    identifier: result.identifier,
    name: result.title,
    kind,
    status: pickerStatus(result.status),
    project: result.projectId
      ? (projectNames?.get(result.projectId) ?? '')
      : '',
  }
}

export function pickerStatus(status: string): { tone: Tone; label: string } {
  const key = status.toLowerCase()
  if (key.includes('approve') || key.includes('sign'))
    return { tone: 'ok', label: 'Approved' }
  if (key.includes('review')) return { tone: 'review', label: 'In review' }
  if (key.includes('progress'))
    return { tone: 'progress', label: 'In progress' }
  if (key.includes('draft')) return { tone: 'draft', label: 'Draft' }
  if (key.includes('archiv')) return { tone: 'stored', label: 'Archived' }
  if (key.includes('quarant')) return { tone: 'warn', label: 'Quarantine' }
  if (key.includes('consum')) return { tone: 'stored', label: 'Consumed' }
  return { tone: 'none', label: status || '—' }
}

/** Project ids to display titles, for the picker item subtitle. */
async function fetchProjectNames(
  client: DataClient,
): Promise<Map<string, string>> {
  const rows = await client.list<{ id: string; title: string }>(
    'projects',
    '?select=id,title',
  )
  return new Map(rows.map((r) => [r.id, r.title]))
}

interface RecentViewRow {
  object_kind: string
  object_id: string
}

interface RecentRecordRow {
  id: string
  kind: string
  identifier: string
  title: string
  status: string
  project_id: string | null
}

interface RecentDatasetRow {
  id: string
  display_id: string | null
  name: string
  lifecycle: string
  primary_project_id: string | null
}

/**
 * The current person's most recently viewed pickable records, newest first.
 * Reads the per-user `api.recently_viewed` table under RLS (it is scoped to the
 * caller), resolves each row against its canonical object so only objects that
 * still exist and are not archived survive, and preserves view order.
 */
export async function fetchPickerRecents(
  client: DataClient = pickerClient,
  limit = 5,
): Promise<PickerItem[]> {
  const views = await client.list<RecentViewRow>(
    'recently_viewed',
    `?order=viewed_at.desc&limit=${limit * 4}&select=object_kind,object_id`,
  )
  const recordIds = views
    .filter((v) => v.object_kind === 'record')
    .map((v) => v.object_id)
  const datasetIds = views
    .filter((v) => v.object_kind === 'dataset')
    .map((v) => v.object_id)
  if (!recordIds.length && !datasetIds.length) return []

  const [projectNames, records, datasets] = await Promise.all([
    fetchProjectNames(client),
    recordIds.length
      ? listByIds(recordIds, (ids) =>
          client.list<RecentRecordRow>(
            'records',
            `?id=in.(${ids})&deleted_at=is.null&archived_at=is.null` +
              '&select=id,kind,identifier,title,status,project_id',
          ),
        )
      : Promise.resolve([]),
    datasetIds.length
      ? listByIds(datasetIds, (ids) =>
          client.list<RecentDatasetRow>(
            'datasets',
            `?id=in.(${ids})&lifecycle=eq.active` +
              '&select=id,display_id,name,lifecycle,primary_project_id',
          ),
        )
      : Promise.resolve([]),
  ])

  const byId = new Map<string, PickerItem>()
  for (const r of records) {
    const kind = PICKER_KIND_BY_RECORD_KIND.get(r.kind)
    if (!kind) continue
    byId.set(r.id, {
      id: r.id,
      identifier: r.identifier,
      name: r.title,
      kind,
      status: pickerStatus(r.status),
      project: r.project_id ? (projectNames.get(r.project_id) ?? '') : '',
    })
  }
  for (const d of datasets) {
    byId.set(d.id, {
      id: d.id,
      identifier: d.display_id ?? d.id,
      name: d.name,
      kind: 'Dataset',
      status: pickerStatus(d.lifecycle),
      project: d.primary_project_id
        ? (projectNames.get(d.primary_project_id) ?? '')
        : '',
    })
  }

  const items: PickerItem[] = []
  const seen = new Set<string>()
  for (const view of views) {
    if (seen.has(view.object_id)) continue
    const item = byId.get(view.object_id)
    if (!item) continue
    seen.add(view.object_id)
    items.push(item)
    if (items.length >= limit) break
  }
  return items
}

export async function searchPickerRecords(
  input: { q: string; kinds?: PickerKind[] },
  client: DataClient = pickerClient,
): Promise<PickerResult> {
  const q = input.q.trim()
  // Empty query: the person's own recent records. There is no page of results
  // to fabricate them from, so a person with no history gets nothing and the
  // picker says "Nothing recent".
  if (!q) {
    const all = await fetchPickerRecents(client)
    const counts = emptyCounts()
    for (const item of all) counts[item.kind] += 1
    // A picker that is limited to some kinds must not offer the others.
    const recent = input.kinds?.length
      ? all.filter((item) => input.kinds!.includes(item.kind))
      : all
    return { recent: true, items: recent, counts, total: all.length }
  }
  const [results, projectNames] = await Promise.all([
    executeSearch(client, { query: q, limit: 50 }),
    fetchProjectNames(client),
  ])
  const all = results
    .map((r) => toPickerItem(r, projectNames))
    .filter((item): item is PickerItem => item !== null)
  const counts = emptyCounts()
  for (const item of all) counts[item.kind] += 1
  const items = input.kinds?.length
    ? all.filter((item) => input.kinds!.includes(item.kind))
    : all
  return { recent: false, items, counts, total: all.length }
}
