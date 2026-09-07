/**
 * KNOW-02 — Per-object lineage section.
 *
 * Seeds the existing `buildLineageGraph` BFS from the viewed object at a
 * bounded depth (`LINEAGE_MINI_DEPTH`) and renders the existing lineage
 * table representation (`buildTableData`) in miniature — not a new renderer.
 * Nodes link out via `lineageNodeDestination`: submitted/frozen evidence
 * nodes to the frozen evidence workspace, live nodes to their canonical
 * surface; restricted/missing nodes render as honest plain text, never links.
 * `Open full lineage` deep-links to the `/lineage` explorer with the same
 * seed at full depth.
 *
 * No second graph authority: every read goes through the RLS-filtered
 * `fetchLineageGraph` boundary, and pinned evidence is never mutated.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { EmptyHint, InspectorSection } from '#/components/record'
import {
  buildTableData,
  fetchLineageGraph,
  LINEAGE_MINI_DEPTH,
  lineageDataClient,
  lineageNodeDestination,
  lineageQueryKeys,
} from '#/lib/lineage-data'
import type { LineageGraph, LineageNode } from '#/lib/lineage-data'

/** Pure miniature render of a seeded graph — the unit under the component test. */
export function RecordLineageList({
  graph,
  seedRecordId,
}: {
  graph: LineageGraph
  seedRecordId: string
}) {
  const items = useMemo(() => {
    const nodeForRow = (rowId: string): LineageNode | null => {
      const direct = graph.nodes.find((node) => rowId === node.id)
      if (direct) return direct
      return graph.nodes.find((node) => rowId.startsWith(`${node.id}:`)) ?? null
    }
    // The seed's own row (direction `seed`, no relationship) describes the
    // viewed object itself, not its lineage — exclude it from the miniature.
    return buildTableData(graph)
      .map((row) => ({ row, node: nodeForRow(row.id) }))
      .filter(
        (item): item is { row: (typeof item)['row']; node: LineageNode } =>
          item.node !== null && item.node.id !== seedRecordId,
      )
  }, [graph, seedRecordId])

  if (items.length === 0) {
    return <EmptyHint>No lineage links yet</EmptyHint>
  }

  return (
    <div>
      <ul className="space-y-1">
        {items.map(({ row, node }) => {
          const destination = lineageNodeDestination(node)
          return (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
            >
              <span className="min-w-0">
                {destination ? (
                  <a
                    href={destination}
                    className="font-mono font-medium underline-offset-4 hover:underline"
                  >
                    {row.identifier}
                  </a>
                ) : (
                  <span className="font-mono font-medium text-muted-foreground">
                    {row.identifier}
                    {!node.accessible
                      ? ` (${node.status === 'missing' ? 'missing' : 'restricted'})`
                      : null}
                  </span>
                )}{' '}
                <span className="text-muted-foreground">
                  {row.relationshipLabel} · {row.entityTypeLabel}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground">
                {row.direction}
              </span>
            </li>
          )
        })}
      </ul>
      <a
        href={`/lineage?seed=${encodeURIComponent(seedRecordId)}`}
        className="mt-2 inline-block text-xs font-medium underline-offset-4 hover:underline"
      >
        Open full lineage
      </a>
    </div>
  )
}
/**
 * Live per-object lineage section for the record inspector. Silent while
 * loading via a hint; honest on error; empty hint when the seed has no
 * lineage neighbours.
 */
export function RecordLineageSection({ recordId }: { recordId: string }) {
  const lineageQuery = useQuery({
    queryKey: lineageQueryKeys.graphFor(recordId, LINEAGE_MINI_DEPTH),
    queryFn: () =>
      fetchLineageGraph(lineageDataClient, recordId, LINEAGE_MINI_DEPTH),
    staleTime: 15_000,
  })

  const graph = lineageQuery.data ?? null

  return (
    <InspectorSection title="Lineage">
      {lineageQuery.isLoading ? (
        <EmptyHint>Loading lineage…</EmptyHint>
      ) : lineageQuery.error ? (
        <p className="text-xs text-destructive">
          Could not load lineage.{' '}
          {(lineageQuery.error as Error | undefined)?.message ?? ''}
        </p>
      ) : !graph ? (
        <EmptyHint>No lineage links yet</EmptyHint>
      ) : (
        <RecordLineageList graph={graph} seedRecordId={recordId} />
      )}
    </InspectorSection>
  )
}
