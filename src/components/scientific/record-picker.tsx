/**
 * RecordPicker — searchable selector for linking scientific records (samples,
 * materials, protocols) into notebook workflows (SCI-001).
 *
 * The picker searches records of a given kind by identifier or title,
 * distinguishes kind and status with the shared StatusBadge, shows archived
 * records honestly when an existing historical link points to one, and
 * prevents selecting invalid cross-workspace records (RLS makes
 * cross-workspace records invisible, so the caller cannot pick one). It
 * reuses the cmdk-based Command primitive for keyboard-accessible search.
 *
 * Loading, empty, error and permission states are all handled. The picker
 * does not create records or fake counts; it only selects existing records.
 *
 * Decision 0026; follows DESIGN.md and the concept system.
 */
import { Icon } from '#/components/v3/icons'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from '#/components/v3/ui/command'
import { StatusBadge } from '#/components/scientific/status-badge'
import { cn } from '#/lib/utils'
import type { ScientificRecordKind } from '#/lib/scientific-records'
import { KIND_PREFIX } from '#/lib/scientific-records'
import type { NotebookRecord } from '#/lib/notebook-data'

export interface RecordPickerResult {
  id: string
  kind: string
  identifier: string
  title: string
  status: string
  archived: boolean
}

export interface RecordPickerProps {
  /** Which record kind to search. */
  kind: ScientificRecordKind
  /** Controlled search results. Caller drives the query via TanStack Query. */
  results: NotebookRecord[]
  /** Loading state for the search query. */
  loading: boolean
  /** Error state for the search query. */
  error?: Error | null
  /** Called when the user types in the search box. Debounce upstream. */
  onSearch: (query: string) => void
  /** Called when the user selects a record. */
  onSelect: (result: RecordPickerResult) => void
  /** Optional existing target id to highlight as the current selection. */
  selectedId?: string | null
  /** Whether to include archived records in results. */
  includeArchived?: boolean
  /** Accessible label for the search input. */
  searchLabel?: string
  className?: string
}

const KIND_DOMAIN: Record<
  ScientificRecordKind,
  'sample' | 'material' | 'protocol'
> = {
  sample: 'sample',
  material: 'material',
  protocol_template: 'protocol',
}

const KIND_LABEL: Record<ScientificRecordKind, string> = {
  sample: 'Sample',
  material: 'Material',
  protocol_template: 'Protocol',
}

export function RecordPicker({
  kind,
  results,
  loading,
  error,
  onSearch,
  onSelect,
  selectedId,
  includeArchived,
  searchLabel,
  className,
}: RecordPickerProps) {
  const prefix = KIND_PREFIX[kind]
  const label =
    searchLabel ?? `Search ${KIND_LABEL[kind]}s by identifier or title`
  const active = results.filter((r) => !r.archivedAt)
  const archived = results.filter((r) => r.archivedAt)

  return (
    <Command
      label={label}
      className={cn('h-full', className)}
      shouldFilter={false}
      loop
    >
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
            <div>
              <p className="font-medium">
                Couldn’t load {KIND_LABEL[kind].toLowerCase()}s.
              </p>
              <p className="text-fg-muted">{error.message}</p>
            </div>
          </div>
        ) : null}

        {!error && !loading && results.length === 0 ? (
          <CommandEmpty>
            No {KIND_LABEL[kind].toLowerCase()}s match your search.
          </CommandEmpty>
        ) : null}

        {active.length > 0 ? (
          <CommandGroup heading={`${KIND_LABEL[kind]}s`}>
            {active.map((record) => (
              <RecordPickerItem
                key={record.id}
                record={record}
                kind={kind}
                selected={record.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </CommandGroup>
        ) : null}

        {includeArchived && archived.length > 0 ? (
          <CommandGroup heading="Archived">
            {archived.map((record) => (
              <RecordPickerItem
                key={record.id}
                record={record}
                kind={kind}
                selected={record.id === selectedId}
                onSelect={onSelect}
                archived
              />
            ))}
          </CommandGroup>
        ) : null}

        {!error && !loading && results.length === 0 ? (
          <p className="px-3 py-3 text-xs text-fg-muted">
            Identifiers look like{' '}
            <code className="font-mono">{prefix}-YYYY-NNNN</code>.
          </p>
        ) : null}
      </CommandList>
    </Command>
  )
}

interface RecordPickerItemProps {
  record: NotebookRecord
  kind: ScientificRecordKind
  selected: boolean
  onSelect: (result: RecordPickerResult) => void
  archived?: boolean
}

function RecordPickerItem({
  record,
  kind,
  selected,
  onSelect,
  archived,
}: RecordPickerItemProps) {
  const result: RecordPickerResult = {
    id: record.id,
    kind: record.kind,
    identifier: record.identifier,
    title: record.title,
    status: record.status,
    archived: Boolean(record.archivedAt),
  }
  return (
    <CommandItem
      value={`${record.identifier} ${record.title}`}
      onSelect={() => onSelect(result)}
      aria-selected={selected}
      className={cn(archived && 'opacity-60')}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-fg-muted">
              {record.identifier}
            </span>
            {archived ? (
              <span className="text-xs text-fg-muted">Archived</span>
            ) : null}
          </div>
          <p className="truncate text-sm font-medium">{record.title}</p>
        </div>
        <StatusBadge
          status={record.status}
          domain={KIND_DOMAIN[kind]}
          size="sm"
        />
      </div>
    </CommandItem>
  )
}
