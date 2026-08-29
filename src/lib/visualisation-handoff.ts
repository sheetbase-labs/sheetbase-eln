/**
 * Sheet → visualisation handoff. A Sheet is an interaction surface; durable
 * mappings use the bound Dataset's stable field IDs. Local Sheet columns
 * are never auto-promoted.
 */

export interface SheetVisualisationHandoff {
  datasetId: string | null
  xFieldId: string | null
  yFieldId: string | null
  seriesFieldId: string | null
  localFieldIds: string[]
  boundFieldIds: string[]
}

export function sheetVisualisationHandoff(input: {
  datasetId?: string | null
  columns: Array<{
    id: string
    source: 'dataset' | 'local'
    fieldId?: string | null
    logicalType: string
  }>
  selectedColumnIds?: string[]
}): SheetVisualisationHandoff {
  const bound = input.columns.filter((column) => column.source === 'dataset')
  const localFieldIds = input.columns
    .filter((column) => column.source === 'local')
    .map((column) => column.id)
  const selected = new Set(input.selectedColumnIds ?? [])
  const selectedBound = bound.filter(
    (column) => selected.size === 0 || selected.has(column.id),
  )
  const numeric = selectedBound.filter((column) =>
    ['decimal', 'integer'].includes(column.logicalType),
  )
  const cats = selectedBound.filter((column) =>
    ['category', 'text', 'boolean'].includes(column.logicalType),
  )
  const y = numeric.at(numeric.length > 1 ? 1 : 0)
  const x = numeric.length > 1 ? numeric.at(0) : cats.at(0)
  return {
    datasetId: input.datasetId ?? null,
    xFieldId: x ? (x.fieldId ?? x.id) : null,
    yFieldId: y ? (y.fieldId ?? y.id) : null,
    seriesFieldId: (() => {
      const series = cats.at(0)
      return series ? (series.fieldId ?? series.id) : null
    })(),
    localFieldIds,
    boundFieldIds: bound.map((column) => column.fieldId ?? column.id),
  }
}

export function isDurableDatasetField(fieldId: string, localFieldIds: string[]) {
  return !localFieldIds.includes(fieldId)
}
