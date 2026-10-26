/**
 * Analysis version history: earlier saves of an analysis, read from the copy
 * the database keeps each time a save replaces a version.
 */
import type { ChartSpec } from './chart-spec'
import type { DataClient } from './data-client'

export interface AnalysisVersionWire {
  version: number
  charts: ChartSpec[]
  saved_at: string
}

export function listAnalysisVersions(
  client: DataClient,
  viewId: string,
): Promise<AnalysisVersionWire[]> {
  return client.list<AnalysisVersionWire>(
    'analysis_view_versions',
    `?view_id=eq.${encodeURIComponent(viewId)}&select=version,charts,saved_at&order=version.desc`,
  )
}

/** One line on what a save changed in the charts, for the Versions list. */
export function describeAnalysisChange(
  before: readonly ChartSpec[] | null,
  after: readonly ChartSpec[],
): string {
  if (!before) return `${count(after.length)} saved`
  const changed: number[] = []
  const shared = Math.min(before.length, after.length)
  for (let i = 0; i < shared; i += 1) {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i]))
      changed.push(i + 1)
  }
  const parts: string[] = []
  if (after.length > before.length)
    parts.push(
      `Added ${count(after.length - before.length)} (now ${after.length})`,
    )
  if (after.length < before.length)
    parts.push(
      `Removed ${count(before.length - after.length)} (now ${after.length})`,
    )
  if (changed.length)
    parts.push(
      `Changed ${changed.length === 1 ? 'chart' : 'charts'} ${changed.join(', ')}`,
    )
  return parts.length ? parts.join('; ') : 'Re-saved, charts unchanged'
}

function count(n: number): string {
  return `${n} ${n === 1 ? 'chart' : 'charts'}`
}
