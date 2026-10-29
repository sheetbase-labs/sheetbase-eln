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
import { RowList } from '#/components/v3/ui/row'
import { relationshipLabel } from '#/lib/lineage-data'
import { recordKindLabel } from '#/lib/notebook-data'
import type { NotebookLink } from '#/lib/notebook-data'
import { useRelationships } from '#/lib/relationships'
import type { RelationshipRow } from '#/lib/relationships'
import { useRelationshipTypeLabels } from '#/lib/model-relationships'
import { t } from '#/copy'

/**
 * Presentation window per direction. The hook always loads the full edge
 * set and headers always show exact counts — only the rendered rows are
 * windowed so relationship-heavy records stay responsive.
 */
export const RELATIONSHIP_RENDER_LIMIT = 25

/** Hover detail for one edge: link creation time and folded-dupe count. */
function rowDetail(row: RelationshipRow): string {
  const createdBy = row.createdByUserId ? ` by ${row.createdByUserId}` : ''
  const dupes =
    row.duplicateCount > 1 ? ` · ${row.duplicateCount} identical links` : ''
  return t('settings.knowledgeRelationshipPanel.linked', {
    createdAt: row.createdAt,
    createdBy,
    dupes,
  })
}

function RelationshipRowView({ row }: { row: RelationshipRow }) {
  return (
    <RecordLink
      to={row.destination ?? undefined}
      type={row.label}
      title={row.title}
      meta={row.identifier ?? undefined}
      state={row.state}
      detail={rowDetail(row)}
      actions={
        row.duplicateCount > 1 ? (
          <span
            title={t(
              'settings.knowledgeRelationshipPanel.identicalLinksCollapsed',
              { duplicateCount: row.duplicateCount },
            )}
            aria-label={t(
              'settings.knowledgeRelationshipPanel.identicalLinksAria',
              { duplicateCount: row.duplicateCount },
            )}
            className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-fg-muted"
          >
            ×{row.duplicateCount}
          </span>
        ) : undefined
      }
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
      <h4 className="text-xs font-semibold text-fg">{heading}</h4>
      <RowList limit={RELATIONSHIP_RENDER_LIMIT}>
        {rows.map((row) => (
          <RelationshipRowView key={row.linkId} row={row} />
        ))}
      </RowList>
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
        heading={t('settings.knowledgeRelationshipPanel.outgoingHeading', {
          length: outgoing.length,
        })}
        rows={outgoing}
      />
      <DirectionSection
        heading={t('settings.knowledgeRelationshipPanel.incomingHeading', {
          length: incoming.length,
        })}
        rows={incoming}
      />
    </div>
  )
}

/**
 * Live bidirectional panel for a record. Shows a loading hint while
 * fetching and renders nothing when there are no relationships in either
 * direction. `sourceModelKey` (the record's Model) lets MODEL-03 rules
 * rename the typed relationships — record-backed model keys align with
 * record kinds by canonical seed, and a miss simply falls back to the
 * canonical vocabulary. Omitted keeps current behaviour.
 */
export function RelationshipPanel({
  recordId,
  sourceModelKey,
}: {
  recordId: string
  sourceModelKey?: string
}) {
  const typeLabels = useRelationshipTypeLabels(sourceModelKey)
  const { outgoing, incoming, isLoading } = useRelationships(
    recordId,
    true,
    typeLabels,
  )
  if (isLoading) {
    return (
      <InspectorSection
        title={t('settings.knowledgeRelationshipPanel.relationships')}
      >
        <p className="py-1 text-xs text-fg-muted">
          {t('settings.knowledgeRelationshipPanel.loadingRelationships')}
        </p>
      </InspectorSection>
    )
  }
  if (outgoing.length === 0 && incoming.length === 0) return null
  return (
    <InspectorSection
      title={t('settings.knowledgeRelationshipPanel.relationships')}
    >
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
    <InspectorSection
      title={t('settings.knowledgeRelationshipPanel.relationships')}
    >
      <RowList>
        {links.map((link) => (
          <RecordLink
            key={link.id}
            type={relationshipLabel(link.linkType)}
            title={link.targetIdentifier}
            meta={recordKindLabel(link.targetKind)}
          />
        ))}
      </RowList>
    </InspectorSection>
  )
}
