import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  fetchLineageGraph,
  getLineageSummary,
  LINEAGE_MINI_DEPTH,
  lineageNodeDestination,
  lineageQueryKeys,
  lineageDataClient,
} from '#/lib/lineage-data'

/**
 * UI port: the sample Lineage tab. Reads the real relationship graph
 * (`record_links` plus reviews, decisions, signatures and change events)
 * through the RLS-filtered `fetchLineageGraph` boundary — the same data the
 * retired `/lineage` explorer used, now the sample's own tab. Restricted or
 * missing neighbours render as honest text, never links.
 */
export const Route = createFileRoute('/samples/$sampleId/lineage')({
  component: SampleLineage,
})

function SampleLineage() {
  const { sampleId } = Route.useParams()
  const query = useQuery({
    queryKey: lineageQueryKeys.graphFor(sampleId, LINEAGE_MINI_DEPTH),
    queryFn: () =>
      fetchLineageGraph(lineageDataClient, sampleId, LINEAGE_MINI_DEPTH),
    staleTime: 15_000,
  })
  const graph = query.data
  const seed = graph?.nodes.find((n) => n.recordId === sampleId)
  const summary = graph && seed ? getLineageSummary(graph, seed.id) : null
  const neighbours = (graph?.nodes ?? []).filter((n) => n.recordId !== sampleId)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      {graph?.truncated ? (
        <Notice tone="warn">
          This sample has a large lineage; only the nearest neighbours are
          shown.
        </Notice>
      ) : null}
      {summary ? (
        <p className="text-label text-fg-muted">
          Direct links: {summary.upstreamCount} upstream ·{' '}
          {summary.downstreamCount} downstream
        </p>
      ) : null}
      <Section title="Lineage" count={neighbours.length}>
        {neighbours.length ? (
          <TableBox>
            <Table aria-label="Lineage neighbours">
              <TableHeader>
                <TableRow>
                  <TableHead>Record</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Direction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {neighbours.map((node) => {
                  const destination = lineageNodeDestination(node)
                  const edge = graph?.edges.find(
                    (e) => e.sourceId === node.id || e.targetId === node.id,
                  )
                  return (
                    <TableRow key={node.id}>
                      <TableCell className="mono">
                        {destination ? (
                          <Link to={destination} className="text-link">
                            {node.identifier}
                          </Link>
                        ) : (
                          <span className="text-fg-muted">
                            {node.identifier}
                            {!node.accessible
                              ? ` (${node.status === 'missing' ? 'missing' : 'restricted'})`
                              : ''}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{node.title}</TableCell>
                      <TableCell>{node.entityType}</TableCell>
                      <TableCell>{edge?.label ?? '—'}</TableCell>
                      <TableCell>
                        <Status
                          tone={
                            node.direction === 'upstream' ? 'stored' : 'none'
                          }
                        >
                          {node.direction === 'upstream' ? 'Parent' : 'Derived'}
                        </Status>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            icon="folder"
            title="No lineage links yet"
            body="Parents and derived samples appear here once records are linked."
          />
        )}
      </Section>
    </div>
  )
}
