/**
 * UI port (roadmap-4/ui-app3): data for the searchable record picker. Reads the
 * real search RPC through the same-origin proxy, limited to the kinds the
 * picker offers, and returns per-kind counts. Recents are not built in this
 * deployment, so an empty query returns nothing and the picker says so.
 */
import { executeSearch } from '#/lib/search'
import type { SearchResult } from '#/lib/search'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import type { Tone } from '#/components/v3/ui/status'

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

const pickerClient: DataClient = createDataClient()

const emptyCounts = (): Record<PickerKind, number> => ({
  Sample: 0,
  Material: 0,
  Dataset: 0,
  Experiment: 0,
})

/** Map a search result to a picker item, or null when it is not a picker kind. */
export function toPickerItem(result: SearchResult): PickerItem | null {
  let kind: PickerKind | null = null
  if (result.resultType === 'dataset') kind = 'Dataset'
  else if (result.resultType === 'record') {
    if (result.kind === 'sample') kind = 'Sample'
    else if (result.kind === 'reagent') kind = 'Material'
    else if (result.kind === 'experiment') kind = 'Experiment'
  }
  if (!kind) return null
  return {
    id: result.recordId,
    identifier: result.identifier,
    name: result.title,
    kind,
    status: pickerStatus(result.status),
    project: '',
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

export async function searchPickerRecords(
  input: { q: string; kinds?: PickerKind[] },
  client: DataClient = pickerClient,
): Promise<PickerResult> {
  const q = input.q.trim()
  if (!q) return { recent: true, items: [], counts: emptyCounts(), total: 0 }
  const results = await executeSearch(client, { query: q, limit: 50 })
  const all = results
    .map(toPickerItem)
    .filter((item): item is PickerItem => item !== null)
  const counts = emptyCounts()
  for (const item of all) counts[item.kind] += 1
  const items = input.kinds?.length
    ? all.filter((item) => input.kinds!.includes(item.kind))
    : all
  return { recent: false, items, counts, total: all.length }
}
