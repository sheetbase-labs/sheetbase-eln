import { t } from '#/copy'
import { suggestImportMappings } from '#/lib/import-mapping'
import type { ImportTargetField } from '#/lib/import-mapping'
import type {
  ImportMappingDocument,
  ImportParserSummary,
} from '#/lib/import/types'

export type ImportMappingValues = Record<string, string>

export function uploadTargetState({
  mode,
  datasetCount,
  structureCount,
  datasetId,
  schemaVersionId,
  newName,
}: {
  mode: 'append' | 'new' | 'file' | null
  datasetCount: number
  structureCount: number
  datasetId: string
  schemaVersionId: string
  newName: string
}) {
  const defaultMode =
    datasetCount > 0 ? 'append' : structureCount > 0 ? 'new' : 'file'

  const effectiveMode = mode ?? defaultMode

  const targetReady =
    effectiveMode === 'append'
      ? Boolean(datasetId)
      : effectiveMode === 'new'
        ? Boolean(schemaVersionId) && newName.trim().length > 0
        : true

  return { effectiveMode, targetReady }
}

/** A filename hint only. The server still decides what reads the file. */
export function suggestParserFromFilename(
  filename: string,
  options: ImportParserSummary[],
): ImportParserSummary | null {
  const name = filename.toLowerCase()

  return (
    options.find((option) => {
      const label = option.label
        .toLowerCase()
        .replace(/ v[\d.]+$/, '')
        .split(' ')[0]

      return label.length >= 3 && name.includes(label)
    }) ?? null
  )
}

export function suggestDatasetFromFilename<
  T extends { id: string; name: string; display_id?: string | null },
>(filename: string, datasets: readonly T[]): T | null {
  const stem = filename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')

  const scored = datasets
    .flatMap((dataset) => {
      const id = (dataset.display_id ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')

      if (id.trim() && stem.includes(id.trim()))
        return [{ dataset, score: 100 }]

      const words = dataset.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3)

      const hits = words.filter((word) => stem.includes(word)).length
      const score = words.length > 0 ? hits : 0

      return score >= 2 ? [{ dataset, score }] : []
    })
    .sort((a, b) => b.score - a.score)

  const best = scored.at(0)
  const next = scored.at(1)

  if (!best || (next && next.score === best.score)) return null

  return best.dataset
}

/** URL pins are authoritative, including explicit omissions. Saved defaults
 * and suggestions each retain their first matching entry. */
export function initialMappingValues(
  headers: string[],
  fields: ImportTargetField[],
  savedMapping: ImportMappingDocument | null,
  urlMapping: ImportMappingValues,
) {
  const values: ImportMappingValues = {}

  if (Object.keys(urlMapping).length > 0) {
    for (const header of headers) values[header] = urlMapping[header] ?? ''

    return values
  }

  const saved = new Map<string, ImportMappingDocument['sources'][number]>()

  for (const entry of savedMapping?.sources ?? []) {
    if (!saved.has(entry.source)) saved.set(entry.source, entry)
  }

  const suggested = new Map<
    string,
    ReturnType<typeof suggestImportMappings>[number]
  >()

  for (const entry of suggestImportMappings(headers, fields)) {
    if (!suggested.has(entry.source)) suggested.set(entry.source, entry)
  }

  for (const source of headers) {
    const savedEntry = saved.get(source)
    const suggestedEntry = suggested.get(source)

    values[source] = savedEntry
      ? (savedEntry.fieldId ?? '')
      : suggestedEntry?.kind === 'field'
        ? suggestedEntry.field.id
        : ''
  }

  return values
}

/** The mapping and review steps ask different questions of the same reads. */
export function importViewState({
  step,
  parsed,
  worksheetReady,
  datasetId,
  datasetAvailable,
  datasetsLoading,
  hasParser,
  manual,
  mappedCount,
}: {
  step: 'map' | 'check'
  parsed: boolean
  worksheetReady: boolean
  datasetId: string
  datasetAvailable: boolean
  datasetsLoading: boolean
  hasParser: boolean
  manual: boolean
  mappedCount: number
}) {
  const datasetPending = Boolean(datasetId) && datasetsLoading

  const datasetUnavailable =
    Boolean(datasetId) && !datasetsLoading && !datasetAvailable

  const showMapping =
    step === 'map' &&
    parsed &&
    worksheetReady &&
    datasetAvailable &&
    (hasParser || manual)

  const showReview =
    step === 'check' && parsed && datasetAvailable && mappedCount > 0

  const showParserChoice =
    step === 'map' &&
    parsed &&
    worksheetReady &&
    Boolean(datasetId) &&
    !datasetUnavailable &&
    !hasParser &&
    !manual

  return {
    datasetPending,
    datasetUnavailable,
    showMapping,
    showReview,
    showParserChoice,
  }
}

/** A reload submits the same file, target and mapping with the same key. */
export function commitIdempotencyKey(
  fileId: string,
  datasetId: string,
  mapping: ImportMappingDocument,
): string {
  const canonical = JSON.stringify([
    mapping.sheetName,
    mapping.sources.map((source) => [
      source.source,
      source.fieldId,
      source.unit,
      source.sourceUnit,
    ]),
  ])

  let hash = 2166136261

  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return `import-${fileId}-${datasetId}-${(hash >>> 0).toString(16)}`
}

export function outcomeTone(outcome: string): 'ok' | 'warn' | 'bad' | 'stored' {
  if (outcome === 'flagged') return 'warn'

  if (outcome === 'skipped') return 'stored'

  if (outcome === 'planned') return 'ok'

  return 'stored'
}

export function outcomeLabel(row: {
  outcome: string
  plannedRowId: string | null
  flags: Array<{ reason: string }>
}): string {
  if (row.outcome === 'skipped') return t('data.importFlow.controlImported')

  if (row.outcome === 'flagged')
    return (
      row.flags.map((flag) => flag.reason).join('; ') ||
      t('data.importFlow.flagged')
    )

  if (row.outcome === 'planned') return t('data.importFlow.fillsPlannedRow')

  return t('data.importFlow.newRow')
}

/** Match the server's first three non-empty values in its first six rows. */
export function columnExamples(
  source: string,
  sampleRows: Array<Record<string, string>>,
): string[] {
  return sampleRows
    .slice(0, 6)
    .flatMap((row) => {
      const value = (row[source] ?? '').trim()

      return value.length > 0 ? [value] : []
    })
    .slice(0, 3)
}

export function columnNote(
  source: string,
  sampleRows: Array<Record<string, string>>,
  rowCount: number,
  mapped: boolean,
): string {
  if (!mapped) return t('data.importFlow.matchingField')

  const matched = sampleRows
    .slice(0, 6)
    .filter((row) => (row[source] ?? '').trim().length > 0).length

  return t('data.importFlow.matchedOf', { matched, min: Math.min(rowCount, 6) })
}
