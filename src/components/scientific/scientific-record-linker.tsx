/**
 * ScientificRecordLinker — the minimal SCI-001 integration that lets a
 * notebook workflow find and link a sample, material or protocol record.
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
import { t } from '#/copy'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useId, useState } from 'react'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Tabs } from '#/components/ui/tabs'
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
  { kind: 'sample', label: t('notebook.scientificRecordLinker.label') },
  {
    kind: 'material',
    label: t('notebook.scientificRecordLinker.materialLabel'),
  },
  {
    kind: 'protocol_template',
    label: t('notebook.scientificRecordLinker.protocolLabel'),
  },
]

/**
 * Whether the kind tab may be offered for the source Model. Record-backed
 * model keys align with record kinds by canonical seed, so the kind
 * addresses the rule's target model directly.
 */
function isLinkerKindAllowed(
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

/** Why creating the link failed, in the words the person needs. */
function LinkFailureNotice({ error }: { error: Error }) {
  return (
    <p role="alert" className="px-2 py-1 text-xs text-danger">
      {linkFailureMessage(error)}
    </p>
  )
}

/** The message for one failed link creation. */
function linkFailureMessage(error: Error): string {
  if (isDuplicateLinkError(error)) return DUPLICATE_SCIENTIFIC_LINK_MESSAGE

  if (isRelationshipNotAllowedError(error))
    return (
      (error instanceof DataClientError && error.message) ||
      RELATIONSHIP_NOT_ALLOWED_MESSAGE
    )

  if (isRelationshipCardinalityError(error))
    return (
      (error instanceof DataClientError && error.message) ||
      RELATIONSHIP_CARDINALITY_MESSAGE
    )

  if (error instanceof DataClientError) return error.message

  return t('notebook.scientificRecordLinker.couldNotCreateLink')
}

/** The kind a fresh picker opens on: Sample when the rule allows it. */
function preferredKind(
  allowedKinds: readonly { kind: ScientificRecordKind }[],
): ScientificRecordKind {
  if (allowedKinds.some((option) => option.kind === 'sample')) return 'sample'

  return allowedKinds[0]?.kind ?? 'sample'
}

/** What one tab's rule says about the links already made. */
interface ActiveRuleStatus {
  activeRule: ModelRelationshipRule | undefined
  activeStatus: ReturnType<typeof relationshipRuleStatus> | undefined
}

/** Capacity context for one tab, from the declared rule and the current edges. */
function activeRuleStatus(
  links: NotebookLink[],
  sourceModelKey: string | undefined,
  rules: ModelRelationshipRule[] | undefined,
  activeKind: ScientificRecordKind,
): ActiveRuleStatus {
  if (!sourceModelKey || !rules)
    return { activeRule: undefined, activeStatus: undefined }

  const activeLinkType = linkTypeForKind(activeKind)

  const activeRule = rulesForLinkType(
    rules,
    sourceModelKey,
    activeLinkType,
  ).find((rule) => rule.targetModelKey === activeKind)

  if (activeRule?.maxLinks == null)
    return { activeRule, activeStatus: undefined }

  return {
    activeRule,
    activeStatus: relationshipRuleStatus(
      activeRule,
      countLinksForRule(links, {
        linkType: activeLinkType,
        targetModelKey: activeKind,
      }),
    ),
  }
}

/** Which kinds this link's rule accepts, and which it does not. */
function LinkerRestrictionNote({
  accepted,
  notAccepted,
}: {
  accepted: string
  notAccepted: string
}) {
  return (
    <p className="px-2 text-[0.65rem] text-muted-foreground">
      {t('notebook.scientificRecordLinker.accepts', {
        kinds: accepted || t('notebook.scientificRecordLinker.noKinds'),
      })}
      {notAccepted
        ? t('notebook.scientificRecordLinker.notAccepted', {
            kinds: notAccepted,
          })
        : null}
      .
    </p>
  )
}

/** That the rule's ceiling on this link type has been reached. */
function LinkerMaximumNote({
  count,
  maxLinks,
  kind,
}: {
  count: number
  maxLinks: number | ''
  kind: ScientificRecordKind
}) {
  return (
    <p className="px-2 text-[0.65rem] text-muted-foreground">
      {t('notebook.scientificRecordLinker.maximumReached', {
        count,
        maxLinks,
        kind:
          kind === 'protocol_template'
            ? t('notebook.scientificRecordLinker.protocolLabel')
            : kind,
      })}
    </p>
  )
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
  const pickerId = useId()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const allowedKinds = KIND_OPTIONS.filter((opt) =>
    isLinkerKindAllowed(opt.kind, sourceModelKey, rules),
  )

  // The kinds this link's rule does not accept, named so the person knows why.
  const acceptedKinds = new Set(allowedKinds.map((opt) => opt.kind))
  const notAccepted = KIND_OPTIONS.filter((opt) => !acceptedKinds.has(opt.kind))

  const [kind, setKind] = useState<ScientificRecordKind>(() =>
    preferredKind(allowedKinds),
  )

  const [query, setQuery] = useState('')
  const restricted = allowedKinds.length < KIND_OPTIONS.length

  // Rules can arrive after mount (async fetch); never strand the picker on
  // a tab the Model does not accept.
  const activeKind = allowedKinds.some((option) => option.kind === kind)
    ? kind
    : preferredKind(allowedKinds)

  const { activeRule, activeStatus } = activeRuleStatus(
    links,
    sourceModelKey,
    rules,
    activeKind,
  )

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
      void queryClient.invalidateQueries({
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
          variant="quiet"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={open ? pickerId : undefined}
        >
          <Icon name="plus" size={12} />{' '}
          {t('notebook.scientificRecordLinker.linkRecord')}
        </Button>
      </div>

      {open && (
        <div
          id={pickerId}
          className="space-y-2 rounded-md border bg-popover p-2"
        >
          <Tabs
            mode="state"
            variant="segment"
            label={t('notebook.scientificRecordLinker.recordKindLabel')}
            value={activeKind}
            onValueChange={(next) => {
              const chosen = allowedKinds.find((option) => option.kind === next)

              if (chosen) setKind(chosen.kind)

              setQuery('')
            }}
            items={allowedKinds.map((option) => ({
              key: option.kind,
              label: option.label,
            }))}
          />
          {restricted ? (
            <LinkerRestrictionNote
              accepted={allowedKinds.map((option) => option.label).join(', ')}
              notAccepted={notAccepted.map((option) => option.label).join(', ')}
            />
          ) : null}
          {activeStatus?.atMaximum ? (
            <LinkerMaximumNote
              count={activeStatus.count}
              maxLinks={activeRule?.maxLinks ?? ''}
              kind={activeKind}
            />
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
            <LinkFailureNotice error={linkMutation.error} />
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
                title={t('notebook.scientificRecordLinker.title')}
              >
                {t(
                  'notebook.scientificRecordLinker.targetidentifierUnavailable',
                  { targetIdentifier: link.targetIdentifier },
                )}
              </p>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
