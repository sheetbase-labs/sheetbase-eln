import type { ChartColumn, ChartSpec } from './chart-spec'
import { chartUsedFieldIds } from './chart-data'

export interface FieldMatch {
  fromFieldId: string
  fromLabel: string
  toFieldId: string
  toLabel: string
  /** `same` when both datasets share the field; `label` when matched by name and type. */
  by: 'same' | 'label'
}

export interface RebindResult {
  /** The spec pointed at the target dataset; present only when every bound field matched. */
  spec: ChartSpec | null
  matches: FieldMatch[]
  /** Labels of bound fields the target has no matching column for. */
  unmatched: string[]
}

const norm = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ')

/** Every field id a spec refers to: its bindings and its filters. */
export function specFieldIds(spec: ChartSpec): string[] {
  return [
    ...new Set([
      ...chartUsedFieldIds(spec),
      ...spec.filters.map((filter) => filter.fieldId),
    ]),
  ]
}

function replaceIds(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => replaceIds(item, map))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        replaceIds(inner, map),
      ]),
    )
  }
  return value
}

/**
 * Point a saved spec at a different dataset. A bound column is carried over
 * when the target holds the same field, or a column with the same name and
 * type. If any bound column has no counterpart nothing is produced: a chart
 * that silently dropped a column would be a different analysis.
 */
export function rebindSpec(
  spec: ChartSpec,
  sourceColumns: readonly ChartColumn[],
  target: { datasetId: string; columns: readonly ChartColumn[] },
): RebindResult {
  const matches: FieldMatch[] = []
  const unmatched: string[] = []
  for (const fieldId of specFieldIds(spec)) {
    const from = sourceColumns.find((c) => c.id === fieldId)
    const same = target.columns.find((c) => c.id === fieldId)
    const byLabel = from
      ? target.columns.find(
          (c) =>
            norm(c.label) === norm(from.label) &&
            c.logicalType === from.logicalType,
        )
      : undefined
    const to = same ?? byLabel
    if (!to) {
      unmatched.push(from?.label ?? fieldId)
      continue
    }
    matches.push({
      fromFieldId: fieldId,
      fromLabel: from?.label ?? fieldId,
      toFieldId: to.id,
      toLabel: to.label,
      by: same ? 'same' : 'label',
    })
  }
  if (unmatched.length > 0) return { spec: null, matches, unmatched }
  const map = new Map(matches.map((m) => [m.fromFieldId, m.toFieldId]))
  const moved = replaceIds(spec, map) as ChartSpec
  return {
    spec: { ...moved, datasets: [{ datasetId: target.datasetId }] },
    matches,
    unmatched,
  }
}
