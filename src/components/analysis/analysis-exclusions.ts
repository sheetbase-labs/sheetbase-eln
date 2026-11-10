/**
 * How many flagged values the analysis's charts use, for the strip above the
 * charts. Kept apart from `analysis-document.tsx` because it is a calculation,
 * not a screen.
 */
import { chartUsedFieldIds } from '#/lib/chart-data'
import type { ResolvedDataset } from '#/lib/chart-data'
import type { ChartSpec } from '#/lib/chart-spec'

export interface ExclusionCounts {
  values: number
  rows: number
}

/** Flagged values across every field the charts use. */
export function exclusionCounts(
  dataset: ResolvedDataset | null,
  charts: readonly ChartSpec[],
): ExclusionCounts {
  if (!dataset?.flags?.length) return { values: 0, rows: 0 }
  const used = new Set(charts.flatMap((c) => chartUsedFieldIds(c)))
  const hit = dataset.flags.filter((f) => used.has(f.fieldId))

  return {
    values: new Set(hit.map((f) => `${f.rowId}:${f.fieldId}`)).size,
    rows: new Set(hit.map((f) => f.rowId)).size,
  }
}
