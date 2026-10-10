/**
 * FIND-03 — Related work panel.
 *
 * Dense contextual-discovery list: kind icon + label + transparent reason
 * line per item, reusing the canonical `LinkedRecordList` row language.
 * The panel owns its `InspectorSection` chrome and stays completely silent
 * (renders null) when there is nothing to show — mounts never need an
 * empty-state branch.
 */
import type { IconName } from '#/components/v3/icons'

import { InspectorSection, LinkedRecordList } from '#/components/record'
import type { LinkedRecordItem } from '#/components/record'
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
  const linked: LinkedRecordItem[] = items.map((item) => ({
    id: `${item.kind}:${item.id}`,
    type: relatedKindLabel(item.kind, item.recordKind),
    title: item.label,
    meta: item.reason,
    href: item.destination,
    icon:
      item.kind === 'record' && item.recordKind
        ? (RECORD_KIND_ICON[item.recordKind] ?? KIND_ICON.record)
        : KIND_ICON[item.kind],
  }))
  return <LinkedRecordList items={linked} />
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
