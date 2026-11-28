/**
 * FIND-03 — Related work panel.
 *
 * Dense contextual-discovery list: kind icon + label + transparent reason
 * line per item, as the canonical entity row (`RecordLink`) in a `RowList`.
 * The panel owns its `InspectorSection` chrome and stays completely silent
 * (renders null) when there is nothing to show — mounts never need an
 * empty-state branch.
 */
import { useState } from 'react'

import { notebookDataClient } from '#/lib/notebook-data'
import { useRecordKindNames } from '#/lib/record-kind-names'
import { LoadingBlock } from '#/components/ui/page-skeleton'
import type { IconName } from '#/components/icons'

import { InspectorSection } from '#/components/ui/layout'
import { RecordLink } from '#/components/scientific/record-link'
import { RowList } from '#/components/ui/row'
import { relatedKindLabel, useRelatedWork } from '#/lib/related-work'
import type { RelatedWorkItem, RelatedWorkKind } from '#/lib/related-work'
import { t } from '#/copy'

const KIND_ICON: Record<RelatedWorkKind, IconName> = {
  record: 'box',
  dataset: 'database',
  sheet: 'table',
  template: 'template',
  project: 'folder',
}

/** The icon each record kind shows; kinds with none fall back to the generic one. */
const RECORD_KIND_ICON = new Map<string, IconName>([
  ['experiment', 'flask'],
  ['sample', 'tube'],
  ['material', 'box'],
  ['protocol_template', 'protocol'],
  ['report', 'download'],
  ['file', 'download'],
  ['notebook_template', 'template'],
])

/** Pure render of resolved items — the unit under the component test. */
export function RelatedWorkList({
  items,
  typeInMeta = false,
}: {
  items: RelatedWorkItem[]
  /** Say each row's kind beside its reason, as a record page's Links do. */
  typeInMeta?: boolean
}) {
  return (
    <RowList>
      {items.map((item) => (
        <RecordLink
          key={`${item.kind}:${item.id}`}
          density="list"
          type={relatedKindLabel(item.kind, item.recordKind)}
          title={item.label}
          meta={item.reason}
          to={item.destination}
          typeInMeta={typeInMeta}
          icon={
            item.kind === 'record' && item.recordKind
              ? (RECORD_KIND_ICON.get(item.recordKind) ?? KIND_ICON.record)
              : KIND_ICON[item.kind]
          }
        />
      ))}
    </RowList>
  )
}

/**
 * Live panel for a canonical object. Shows a loading hint while fetching
 * and renders nothing when the list is empty.
 */
export function RelatedWorkPanel({
  kind,
  id,
  title = t('projects.relatedWork.title'),
  exclude,
  limit,
}: {
  kind: RelatedWorkKind
  id: string
  /** The section's heading; a record page calls it Links. */
  title?: string
  /** Ids the page already shows elsewhere (its header's project). */
  exclude?: readonly string[]
  /**
   * Show this many and fold the rest behind "Show all", for a side panel that
   * also holds properties and activity. Rows then say their kind beside the
   * reason rather than above the title.
   */
  limit?: number
}) {
  useRecordKindNames(notebookDataClient)
  const { data, isLoading } = useRelatedWork(kind, id)
  const [expanded, setExpanded] = useState(false)

  if (isLoading) {
    return (
      <InspectorSection title={title}>
        <LoadingBlock label={t('projects.relatedWork.loading')} />
      </InspectorSection>
    )
  }

  const excluded = new Set(exclude)

  const items = excluded.size
    ? data?.filter((item) => !excluded.has(item.id))
    : data

  if (!items || items.length === 0) return null

  const folded = limit !== undefined && !expanded && items.length > limit

  return (
    <InspectorSection
      title={title}
      action={
        folded ? (
          <button
            type="button"
            className="text-link"
            onClick={() => setExpanded(true)}
          >
            {t('projects.relatedWork.showAll', { count: items.length })}
          </button>
        ) : undefined
      }
    >
      <RelatedWorkList
        items={folded ? items.slice(0, limit) : items}
        typeInMeta={limit !== undefined}
      />
    </InspectorSection>
  )
}
