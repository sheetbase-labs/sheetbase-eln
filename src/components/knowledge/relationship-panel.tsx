/**
 * KNOW-01 — Relationship panel.
 *
 * Complete bidirectional typed traversal for one record, complementing (not
 * duplicating) FIND-03's Related Work panel: Related Work is ranked discovery
 * with reasons; this panel is the full incoming/outgoing edge list with typed
 * labels, lifecycle states and stable-ID destinations. Outgoing creation
 * stays with the existing linker — this panel is exploration, not a second
 * linker.
 *
 * Rows reuse the honest `RecordLink` states: only `available` rows navigate;
 * archived/deleted/missing/permission-restricted targets render distinctly
 * and never as links. Historical revisions render the pinned outgoing
 * snapshot without actions.
 */
import { InspectorSection } from '#/components/record'
import { RecordLink } from '#/components/scientific/record-link'
import { relationshipLabel } from '#/lib/lineage-data'
import { recordKindLabel } from '#/lib/notebook-data'
import type { NotebookLink } from '#/lib/notebook-data'
import { useRelationships } from '#/lib/relationships'
import type { RelationshipRow } from '#/lib/relationships'

function RelationshipRowView({ row }: { row: RelationshipRow }) {
  return (
    <RecordLink
      to={row.destination ?? undefined}
      type={row.label}
      title={row.title}
      meta={row.identifier ?? undefined}
      state={row.state}
    />
  )
}

function DirectionSection({
  heading,
  rows,
}: {
  heading: string
  rows: RelationshipRow[]
}) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-foreground">{heading}</h4>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.linkId}>
            <RelationshipRowView row={row} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Pure render of resolved rows — the unit under the component test. */
export function RelationshipList({
  outgoing,
  incoming,
}: {
  outgoing: RelationshipRow[]
  incoming: RelationshipRow[]
}) {
  return (
    <div className="space-y-2">
      <DirectionSection
        heading={`Outgoing (${outgoing.length})`}
        rows={outgoing}
      />
      <DirectionSection
        heading={`Incoming (${incoming.length})`}
        rows={incoming}
      />
    </div>
  )
}

/**
 * Live bidirectional panel for a record. Shows a loading hint while
 * fetching and renders nothing when there are no relationships in either
 * direction.
 */
export function RelationshipPanel({ recordId }: { recordId: string }) {
  const { outgoing, incoming, isLoading } = useRelationships(recordId)
  if (isLoading) {
    return (
      <InspectorSection title="Relationships">
        <p className="py-1 text-xs text-muted-foreground">
          Loading relationships…
        </p>
      </InspectorSection>
    )
  }
  if (outgoing.length === 0 && incoming.length === 0) return null
  return (
    <InspectorSection title="Relationships">
      <RelationshipList outgoing={outgoing} incoming={incoming} />
    </InspectorSection>
  )
}

/**
 * Historical (`?revision=`) panel: the pinned outgoing link snapshot as
 * non-interactive rows. Incoming edges cannot be pinned — the revision
 * snapshot only carries the links that existed at submission time — so only
 * the outgoing snapshot renders, typed via the same label vocabulary, with
 * no destinations and no actions.
 */
export function PinnedRelationshipPanel({ links }: { links: NotebookLink[] }) {
  if (links.length === 0) return null
  return (
    <InspectorSection title="Relationships">
      <ul className="space-y-1">
        {links.map((link) => (
          <li key={link.id}>
            <RecordLink
              type={relationshipLabel(link.linkType)}
              title={link.targetIdentifier}
              meta={recordKindLabel(link.targetKind)}
            />
          </li>
        ))}
      </ul>
    </InspectorSection>
  )
}
