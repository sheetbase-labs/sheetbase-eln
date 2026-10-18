/**
 * FIND-03 — Related work panel.
 *
 * Dense contextual-discovery list: kind icon + label + transparent reason
 * line per item, as the canonical entity row (`RecordLink`) in a `RowList`.
 * The panel owns its `InspectorSection` chrome and stays completely silent
 * (renders null) when there is nothing to show — mounts never need an
 * empty-state branch.
 */
import type { IconName } from '#/components/v3/icons'

import { InspectorSection } from '#/components/record'
import { RecordLink } from '#/components/scientific/record-link'
import { RowList } from '#/components/v3/ui/row'
import { relatedKindLabel, useRelatedWork } from '#/lib/related-work'
import type { RelatedWorkItem, RelatedWorkKind } from '#/lib/related-work'

const KIND_ICON: Record<RelatedWorkKind, IconName> = {
  record: 'box',
  dataset: 'database',
  sheet: 'table',
  template: 'template',
  project: 'folder',
}

const RECORD_KIND_ICON: Record<string, IconName> = {
  experiment: 'flask',
  sample: 'tube',
  material: 'box',
  protocol_template: 'protocol',
  report: 'download',
  file: 'download',
  notebook_template: 'template',
}

/** Pure render of resolved items — the unit under the component test. */
export function RelatedWorkList({ items }: { items: RelatedWorkItem[] }) {
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
          icon={
            item.kind === 'record' && item.recordKind
              ? (RECORD_KIND_ICON[item.recordKind] ?? KIND_ICON.record)
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
}: {
  kind: RelatedWorkKind
  id: string
}) {
  const { data, isLoading } = useRelatedWork(kind, id)
  if (isLoading) {
    return (
      <InspectorSection title="Related work">
        <p className="py-1 text-xs text-muted-foreground">
          Loading related work…
        </p>
      </InspectorSection>
    )
  }
  if (!data || data.length === 0) return null
  return (
    <InspectorSection title="Related work">
      <RelatedWorkList items={data} />
    </InspectorSection>
  )
}
