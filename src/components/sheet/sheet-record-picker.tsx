import type { ScientificRecordKind } from '#/lib/scientific-records'
import { RecordPicker } from '#/components/scientific/record-picker'
import type { RecordPickerResult } from '#/components/scientific/record-picker'
import type { NotebookRecord } from '#/lib/notebook-data'
import { formatRecordReferenceLabel } from '#/lib/record-reference-cell'

const MODEL_KIND: Record<string, ScientificRecordKind> = {
  sample: 'sample',
  reagent: 'reagent',
  protocol_template: 'protocol_template',
}

export function sheetRecordPickerKind(
  modelKey: string,
): ScientificRecordKind | null {
  return MODEL_KIND[modelKey] ?? null
}

export function SheetRecordPicker({
  modelKey,
  results,
  loading,
  error,
  onSearch,
  onSelect,
  selectedId,
  includeArchived,
}: {
  modelKey: string
  results: NotebookRecord[]
  loading: boolean
  error?: Error | null
  onSearch: (query: string) => void
  onSelect: (result: RecordPickerResult) => void
  selectedId?: string | null
  includeArchived?: boolean
}) {
  const kind = sheetRecordPickerKind(modelKey)
  if (!kind) {
    return (
      <p role="alert" className="px-3 py-2 text-sm text-muted-foreground">
        Model {modelKey} has no Sheet Record picker in CORE-04.
      </p>
    )
  }
  return (
    <RecordPicker
      kind={kind}
      results={results}
      loading={loading}
      error={error}
      onSearch={onSearch}
      onSelect={onSelect}
      selectedId={selectedId}
      includeArchived={includeArchived}
      searchLabel={`Search ${kind} Records by Record ID or Name. Selection persists the UUID.`}
    />
  )
}

export function sheetRecordSelectionLabel(result: RecordPickerResult): string {
  return formatRecordReferenceLabel({
    identifier: result.identifier,
    title: result.title,
  })
}
