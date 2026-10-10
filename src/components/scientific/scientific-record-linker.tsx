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
import { useState } from 'react'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { RecordPicker } from './record-picker'
import { ScientificRecordSummary } from './scientific-record-summary'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import {
  DUPLICATE_SCIENTIFIC_LINK_MESSAGE,
  createScientificLink,
  fetchFieldDefinitions,
  fetchRecordById,
  isDuplicateLinkError,
  isScientificRecordKind,
  linkTypeForKind,
  scientificRecordQueryKeys,
  searchRecords,
} from '#/lib/scientific-records'
import type { ScientificRecordKind } from '#/lib/scientific-records'
import type { NotebookLink } from '#/lib/notebook-data'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import {
  RELATIONSHIP_CARDINALITY_MESSAGE,
  RELATIONSHIP_NOT_ALLOWED_MESSAGE,
  countLinksForRule,
  isLinkAllowed,
  isRelationshipCardinalityError,
  isRelationshipNotAllowedError,
  relationshipRuleStatus,
  rulesForLinkType,
} from '#/lib/model-relationships'
import type { ModelRelationshipRule } from '#/lib/model-relationships'

export interface ScientificRecordLinkerProps {
  /** The notebook record that owns the outgoing links. */
  sourceRecordId: string
  /** Current outgoing links (from the inspector's links query). */
  links: NotebookLink[]
  /** DataClient for search/link creation. Defaults to the notebook client. */
  client?: DataClient
  /** Called after a link is created so the caller can refetch. */
  onLinked?: () => void
  /** Suppress the per-record summary cards. Use when the caller renders
   * its own compact link summary (e.g. the notebook inspector's "Link to"
   * count pills) and doesn't want the detailed properties dumped into the
   * same scroll. */
  hideSummaries?: boolean
  /**
   * MODEL-03: the source record's Model key. With `rules`, kind tabs the
   * Model does not accept are not offered; omitted leaves every kind
   * available as today.
   */
  sourceModelKey?: string
  /** MODEL-03: declared relationship rules for the source Model. */
  rules?: ModelRelationshipRule[]
}

const KIND_OPTIONS: { kind: ScientificRecordKind; label: string }[] = [
  { kind: 'sample', label: 'Sample' },
  { kind: 'reagent', label: 'Reagent' },
  { kind: 'protocol_template', label: 'Protocol' },
]

/**
 * Whether the kind tab may be offered for the source Model. Record-backed
 * model keys align with record kinds by canonical seed, so the kind
 * addresses the rule's target model directly.
 */
export function isLinkerKindAllowed(
  kind: ScientificRecordKind,
  sourceModelKey: string | undefined,
  rules: ModelRelationshipRule[] | undefined,
): boolean {
  if (!sourceModelKey || !rules) return true
  return isLinkAllowed(rules, {
    sourceModelKey,
    linkType: linkTypeForKind(kind),
    targetModelKey: kind,
  })
}

export function ScientificRecordLinker({
  sourceRecordId,
  links,
  client = notebookDataClient,
  onLinked,
  hideSummaries = false,
  sourceModelKey,
  rules,
}: ScientificRecordLinkerProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const allowedKinds = KIND_OPTIONS.filter((opt) =>
    isLinkerKindAllowed(opt.kind, sourceModelKey, rules),
  )
  const [kind, setKind] = useState<ScientificRecordKind>(() =>
    allowedKinds.some((opt) => opt.kind === 'sample')
      ? 'sample'
      : (allowedKinds[0]?.kind ?? 'sample'),
  )
  const [query, setQuery] = useState('')
  const restricted = allowedKinds.length < KIND_OPTIONS.length
  // Rules can arrive after mount (async fetch); never strand the picker on
  // a tab the Model does not accept.
  const activeKind = allowedKinds.some((opt) => opt.kind === kind)
    ? kind
    : (allowedKinds[0]?.kind ?? 'sample')
  const activeLinkType = linkTypeForKind(activeKind)
  // Capacity context for the active tab, from the declared rule and the
  // current outgoing edges (target kinds address model keys by seed).
  const activeRule =
    sourceModelKey && rules
      ? rulesForLinkType(rules, sourceModelKey, activeLinkType).find(
          (rule) => rule.targetModelKey === activeKind,
        )
      : undefined
  const activeStatus =
    activeRule?.maxLinks != null
      ? relationshipRuleStatus(
          activeRule,
          countLinksForRule(links, {
            linkType: activeLinkType,
            targetModelKey: activeKind,
          }),
        )
      : undefined

  const searchQuery = useQuery({
    queryKey: scientificRecordQueryKeys.search(activeKind, query),
    queryFn: () =>
      searchRecords(client, activeKind, query, { includeArchived: true }),
    enabled: open,
    staleTime: 15_000,
  })

  const defsQuery = useQuery({
    queryKey: scientificRecordQueryKeys.fieldDefinitions(activeKind),
    queryFn: () => fetchFieldDefinitions(client, activeKind),
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
    <div className="space-y-1.5">
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="sci-001-linker-picker"
        >
          <Icon name="plus" size={12} /> Link record
        </Button>
      </div>

      {open && (
        <div
          id="sci-001-linker-picker"
          className="space-y-2 rounded-md border bg-popover p-2"
        >
          <div className="flex gap-1" role="tablist" aria-label="Record kind">
            {allowedKinds.map((opt) => (
              <Button
                key={opt.kind}
                type="button"
                variant={activeKind === opt.kind ? 'default' : 'ghost'}
                size="sm"
                role="tab"
                aria-selected={activeKind === opt.kind}
                onClick={() => {
                  setKind(opt.kind)
                  setQuery('')
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          {restricted ? (
            <p className="px-2 text-[0.65rem] text-muted-foreground">
              This Model accepts{' '}
              {allowedKinds.map((opt) => opt.label).join(', ') || 'no'} links
              {KIND_OPTIONS.filter(
                (opt) =>
                  !allowedKinds.some((allowed) => allowed.kind === opt.kind),
              ).length > 0
                ? ` — ${KIND_OPTIONS.filter(
                    (opt) =>
                      !allowedKinds.some(
                        (allowed) => allowed.kind === opt.kind,
                      ),
                  )
                    .map((opt) => opt.label)
                    .join(', ')} not accepted`
                : null}
              .
            </p>
          ) : null}
          {activeStatus?.atMaximum ? (
            <p className="px-2 text-[0.65rem] text-muted-foreground">
              Maximum reached ({activeStatus.count} of {activeRule?.maxLinks}{' '}
              {activeKind === 'protocol_template' ? 'Protocol' : activeKind}{' '}
              links).
            </p>
          ) : null}

          {/*
            RecordPicker renders its own cmdk Command root and search input;
            do not wrap it in another Command (that would create a second
            input and a nested cmdk root). The picker's onSearch drives the
            search query state above.
          */}
          <RecordPicker
            kind={activeKind}
            results={searchQuery.data ?? []}
            loading={searchQuery.isLoading}
            error={searchQuery.error ?? null}
            onSearch={setQuery}
            includeArchived
            onSelect={(result) => {
              if (isScientificRecordKind(result.kind)) {
                linkMutation.mutate({
                  id: result.id,
                  kind: activeKind,
                  identifier: result.identifier,
                })
              }
            }}
          />

          {linkMutation.isError ? (
            <p role="alert" className="px-2 py-1 text-xs text-danger">
              {isDuplicateLinkError(linkMutation.error)
                ? DUPLICATE_SCIENTIFIC_LINK_MESSAGE
                : isRelationshipNotAllowedError(linkMutation.error)
                  ? (linkMutation.error instanceof DataClientError &&
                      linkMutation.error.message) ||
                    RELATIONSHIP_NOT_ALLOWED_MESSAGE
                  : isRelationshipCardinalityError(linkMutation.error)
                    ? (linkMutation.error instanceof DataClientError &&
                        linkMutation.error.message) ||
                      RELATIONSHIP_CARDINALITY_MESSAGE
                    : linkMutation.error instanceof DataClientError
                      ? linkMutation.error.message
                      : 'Could not create link.'}
            </p>
          ) : null}
        </div>
      )}

      {!hideSummaries && scientificLinks.length > 0 ? (
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
