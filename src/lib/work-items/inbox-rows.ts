import type { WorkItem } from './data'

/**
 * The per-row identity used for selection and the rendered list key. It
 * mirrors the boundary identity the read service gives each item.
 */
export function rowKey(item: WorkItem): string {
  return item.sourceId ?? item.recordId ?? item.identifier ?? item.title
}

/**
 * Move an Inbox selection by `delta`, clamping at both ends. A null or unknown
 * current selection is treated as the first row, so the first `J` advances off
 * the row that is already implicitly highlighted.
 */
export function moveListSelection(
  keys: readonly string[],
  current: string | null,
  delta: number,
): string | null {
  if (keys.length === 0) return null
  const index = current ? keys.indexOf(current) : -1
  const base = index === -1 ? 0 : index
  const next = Math.min(keys.length - 1, Math.max(0, base + delta))

  return keys[next]
}

/** The specific run a failed or waiting item is about, once it is resolved. */
export function runLink(runId: string) {
  return { to: '/pipelines/runs/$runId' as const, params: { runId } }
}

export { itemLink } from './destination'
