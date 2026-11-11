/**
 * The summary a results table shows: per series, the row count and each numeric
 * column's min–max over the rows the figure plots. Pure, so the rule is tested
 * without a DOM.
 */
import { z } from 'zod'

import type { DatasetCellInput, DatasetRowInput } from '#/lib/dataset-product'

/** One row of a summary table: a series and what its values did. */
export interface SeriesSummaryRow {
  series: string
  rows: number
  /** Per numeric column, "min–max". */
  ranges: Record<string, string>
}

/** The number a cell holds, or null when it holds something that is not one. */
function numeric(value: DatasetCellInput | undefined): number | null {
  const direct = z.number().safeParse(value).data

  if (direct !== undefined) return Number.isFinite(direct) ? direct : null

  const text = z.string().safeParse(value).data

  if (text === undefined || text.trim() === '') return null

  const parsed = Number(text)

  return Number.isFinite(parsed) ? parsed : null
}

/** A cell said as the series name it groups under: an empty or untabled cell is "—". */
function seriesKey(value: DatasetCellInput | undefined): string {
  const text = z
    .union([z.string(), z.number(), z.boolean()])
    .safeParse(value).data

  return text === undefined ? '—' : String(text)
}

function trim(n: number): string {
  return Number(n.toFixed(2)).toString()
}

/** "Summary by train": per series, the row count and each numeric column's
 * min–max, over the rows the figure plots. */
export function summariseBySeries(
  rows: readonly DatasetRowInput[],
  seriesFieldId: string,
  columnIds: readonly string[],
): SeriesSummaryRow[] {
  const groups = new Map<string, DatasetRowInput[]>()

  for (const row of rows) {
    const key = seriesKey(row[seriesFieldId])
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([series, members]) => ({
      series,
      rows: members.length,
      ranges: Object.fromEntries(
        columnIds.map((id) => {
          const values = members
            .map((m) => numeric(m[id]))
            .filter((v): v is number => v !== null)

          if (!values.length) return [id, '—']
          const lo = Math.min(...values)
          const hi = Math.max(...values)

          return [id, lo === hi ? trim(lo) : `${trim(lo)}–${trim(hi)}`]
        }),
      ),
    }))
}
