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

/** Index rows by a key, keeping the first row for a repeated key. */
function firstBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
): Map<string, T> {
  const index = new Map<string, T>()

  for (const row of rows) {
    const value = key(row)

    if (!index.has(value)) index.set(value, row)
  }

  return index
}

/** Every field id a spec refers to: its bindings and its filters. */
export function specFieldIds(spec: ChartSpec): string[] {
  return [
    ...new Set([
      ...chartUsedFieldIds(spec),
      ...spec.filters.map((filter) => filter.fieldId),
    ]),
  ]
}

/**
 * Replace exact field-id strings anywhere in a spec, keeping every other value.
 *
 * This is a structural walk of a saved spec, not a decoder: only string leaves
 * can name a field, and every other primitive, array and object is copied
 * unchanged so the spec keeps the shape the chart editor gave it.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Structural walk of a saved spec: any value is either a string to substitute or a container to copy, and the result is the caller's ChartSpec shape.
function replaceIds(value: unknown, map: ReadonlyMap<string, string>): unknown {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A saved spec's leaf is either a string field id or a container; the walk reads no contract from the value itself.
  if (typeof value === 'string') return map.get(value) ?? value

  if (Array.isArray(value)) return value.map((item) => replaceIds(item, map))

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- A saved spec's records are plain objects; null and primitives are returned unchanged below.
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

  const sourceById = firstBy(sourceColumns, (column) => column.id)
  const targetById = firstBy(target.columns, (column) => column.id)

  const targetByLabel = firstBy(
    target.columns,
    (column) => `${norm(column.label)}\u0000${column.logicalType}`,
  )

  for (const fieldId of specFieldIds(spec)) {
    const from = sourceById.get(fieldId)
    const same = targetById.get(fieldId)

    const byLabel = from
      ? targetByLabel.get(`${norm(from.label)}\u0000${from.logicalType}`)
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

  // SAFETY: replaceIds only substitutes string leaves, so the walked copy keeps exactly the ChartSpec members and value types it was given.
  const moved = replaceIds(spec, map) as ChartSpec

  return {
    spec: { ...moved, datasets: [{ datasetId: target.datasetId }] },
    matches,
    unmatched,
  }
}
