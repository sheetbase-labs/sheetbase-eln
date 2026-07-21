/**
 * ScientificRecordLinker — the minimal SCI-001 integration that lets a
 * notebook workflow find and link a sample, reagent or protocol record.
 *
 * Combines the RecordPicker with the existing `create_record_link` RPC. The
 * caller provides the source notebook record id and the active links; the
 * linker drives the kind selector, debounced search, and link creation, then
 * invalidates the caller's links query so the inspector updates. Cross-
 * workspace records are invisible under RLS, so the picker cannot offer one.
 *
 * Decision 0026; follows DESIGN.md and the concept system. This is the
 * picker/summary foundation — not the full protocol/material notebook blocks
 * (SCI-002).
 */
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { RecordPicker } from './record-picker'
import { ScientificRecordSummary } from './scientific-record-summary'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import {
  createScientificLink,
  fetchFieldDefinitions,
  fetchRecordById,
  isScientificRecordKind,
  scientificRecordQueryKeys,
  searchRecords,
} from '#/lib/scientific-records'
import type { ScientificRecordKind } from '#/lib/scientific-records'
import type { NotebookLink } from '#/lib/notebook-data'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'

export interface ScientificRecordLinkerProps {
  /** The notebook record that owns the outgoing links. */
  sourceRecordId: string
  /** Current outgoing links (from the inspector's links query). */
  links: NotebookLink[]
  /** DataClient for search/link creation. Defaults to the notebook client. */
  client?: DataClient
  /** Called after a link is created so the caller can refetch. */
  onLinked?: () => void
}

const KIND_OPTIONS: { kind: ScientificRecordKind; label: string }[] = [
  { kind: 'sample', label: 'Sample' },
  { kind: 'reagent', label: 'Reagent' },
  { kind: 'protocol_template', label: 'Protocol' },
]

export function ScientificRecordLinker({
  sourceRecordId,
  links,
  client = notebookDataClient,
  onLinked,
}: ScientificRecordLinkerProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ScientificRecordKind>('sample')
  const [query, setQuery] = useState('')

  const searchQuery = useQuery({
    queryKey: scientificRecordQueryKeys.search(kind, query),
    queryFn: () =>
      searchRecords(client, kind, query, { includeArchived: true }),
    enabled: open,
    staleTime: 15_000,
  })

  const defsQuery = useQuery({
    queryKey: scientificRecordQueryKeys.fieldDefinitions(kind),
    queryFn: () => fetchFieldDefinitions(client, kind),
    enabled: open,
    staleTime: 60_000,
  })

  const linkMutation = useMutation({
    mutationFn: (target: {
      id: string
      kind: ScientificRecordKind
      identifier: string
    }) => createScientificLink(client, sourceRecordId, target),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.links(sourceRecordId),
      })
      onLinked?.()
      setOpen(false)
      setQuery('')
    },
  })

  // Resolve linked scientific records for the summary panel.
  const scientificLinks = links.filter((l) =>
    isScientificRecordKind(l.targetKind),
  )
  const summaryQueries = useQueries({
    queries: scientificLinks.map((l) => ({
      queryKey: scientificRecordQueryKeys.record(l.targetRecordId ?? ''),
      queryFn: () =>
        fetchRecordById(client, l.targetRecordId ?? '').then((r) =>
          r && isScientificRecordKind(r.kind) ? r : null,
        ),
      enabled: Boolean(l.targetRecordId),
      staleTime: 30_000,
    })),
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="sci-001-linker-picker"
        >
          <Plus className="size-4" aria-hidden /> Link scientific record
        </Button>
      </div>

      {open && (
        <div
          id="sci-001-linker-picker"
          className="space-y-2 rounded-md border bg-popover p-2"
        >
          <div className="flex gap-1" role="tablist" aria-label="Record kind">
            {KIND_OPTIONS.map((opt) => (
              <Button
                key={opt.kind}
                type="button"
                variant={kind === opt.kind ? 'default' : 'ghost'}
                size="sm"
                role="tab"
                aria-selected={kind === opt.kind}
                onClick={() => {
                  setKind(opt.kind)
                  setQuery('')
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          {/*
            RecordPicker renders its own cmdk Command root and search input;
            do not wrap it in another Command (that would create a second
            input and a nested cmdk root). The picker's onSearch drives the
            search query state above.
          */}
          <RecordPicker
            kind={kind}
            results={searchQuery.data ?? []}
            loading={searchQuery.isLoading}
            error={searchQuery.error ?? null}
            onSearch={setQuery}
            includeArchived
            onSelect={(result) => {
              if (isScientificRecordKind(result.kind)) {
                linkMutation.mutate({
                  id: result.id,
                  kind,
                  identifier: result.identifier,
                })
              }
            }}
          />

          {linkMutation.isError ? (
            <p role="alert" className="px-2 py-1 text-xs text-danger">
              {linkMutation.error instanceof DataClientError
                ? linkMutation.error.message
                : 'Could not create link.'}
            </p>
          ) : null}
        </div>
      )}

      {scientificLinks.length > 0 ? (
        <div className="space-y-3">
          {scientificLinks.map((link, i) => {
            const record = summaryQueries[i]?.data
            return record ? (
              <ScientificRecordSummary
                key={link.id}
                record={record}
                fieldDefinitions={defsQuery.data ?? []}
                loading={summaryQueries[i]?.isLoading}
              />
            ) : (
              <p
                key={link.id}
                className="text-xs text-muted-foreground"
                title="The linked record is archived, deleted or missing."
              >
                {link.targetIdentifier} — unavailable
              </p>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
