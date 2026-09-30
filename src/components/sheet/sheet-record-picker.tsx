import { Icon } from '#/components/v3/icons'

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
  CommandLoading,
} from '#/components/v3/ui/command'
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
    <Command label={label} shouldFilter={false} loop>
      <CommandInput
        placeholder={label}
        onValueChange={onSearch}
        aria-label={label}
        icon="search"
      />
      <CommandList>
        <CommandLoading loading={loading} />
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-4 text-sm text-danger-text"
          >
            <Icon
              name="warn"
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden
            />
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
                  <span className="font-mono text-xs text-fg-muted">
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
