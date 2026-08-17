import { AlertCircle, Loader2, Search } from 'lucide-react'

import type { ScientificRecordKind } from '#/lib/scientific-records'
import { RecordPicker } from '#/components/scientific/record-picker'
import type { RecordPickerResult } from '#/components/scientific/record-picker'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
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
  if (kind) {
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
  const label = `Search ${modelKey} Records by Record ID or Name. Selection persists the UUID.`
  const visible = includeArchived
    ? results
    : results.filter((record) => !record.archivedAt)
  return (
    <Command shouldFilter={false} loop>
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <CommandInput
          placeholder={label}
          onValueChange={onSearch}
          aria-label={label}
        />
        {loading ? (
          <Loader2
            className="size-4 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>
      <CommandList>
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-4 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error.message}
          </div>
        ) : null}
        {!error && !loading && visible.length === 0 ? (
          <CommandEmpty>No {modelKey} Records match your search.</CommandEmpty>
        ) : null}
        {visible.length > 0 ? (
          <CommandGroup heading={modelKey}>
            {visible.map((record) => (
              <CommandItem
                key={record.id}
                value={`${record.identifier} ${record.title}`}
                onSelect={() =>
                  onSelect({
                    id: record.id,
                    kind: record.kind,
                    identifier: record.identifier,
                    title: record.title,
                    status: record.status,
                    archived: Boolean(record.archivedAt),
                  })
                }
                aria-selected={record.id === selectedId}
              >
                <div className="min-w-0">
                  <span className="font-mono text-xs text-muted-foreground">
                    {record.identifier}
                  </span>
                  <p className="truncate text-sm font-medium">{record.title}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  )
}

export function sheetRecordSelectionLabel(result: RecordPickerResult): string {
  return formatRecordReferenceLabel({
    identifier: result.identifier,
    title: result.title,
  })
}
