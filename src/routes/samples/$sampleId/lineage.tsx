import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import { sampleStatus } from '#/components/v3/samples/samples-data'
import { toast } from '#/components/v3/ui/sonner'
import {
  computeSampleHold,
  formatHoldDate,
} from '#/components/v3/samples/sample-hold-meter'
import {
  fetchLineageGraph,
  getLineageSummary,
  LINEAGE_MINI_DEPTH,
  lineageNodeDestination,
  lineageQueryKeys,
  lineageDataClient,
} from '#/lib/lineage-data'
import type { LineageGraph, LineageNode } from '#/lib/lineage-data'
import { deriveSampleVolumeSummary, fetchSampleEvents } from '#/lib/samples'
import type { SampleRecord, SampleVolumeSummary } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import { sampleEventsQueryKey, useSampleRecord } from '../$sampleId'

/**
 * LAB-03 — the sample Lineage tab (SampleLineage). Reads the real relationship
 * graph (`record_links` plus reviews, decisions, signatures and change events)
 * through the RLS-filtered `fetchLineageGraph` boundary and renders it as the
 * design's indented tree, with the derivation relation each writer recorded.
 * "Where this lot went" summarises the custody ledger: what was used, what was
 * retained and what remains. Restricted or missing neighbours render as honest
 * text, never links.
 */
export const Route = createFileRoute('/samples/$sampleId/lineage')({
  component: SampleLineage,
})

const INDENT_PX = 22

function SampleLineage() {
  const { sampleId } = Route.useParams()
  const sample = useSampleRecord(sampleId)
  const query = useQuery({
    queryKey: lineageQueryKeys.graphFor(sampleId, LINEAGE_MINI_DEPTH),
    queryFn: () =>
      fetchLineageGraph(lineageDataClient, sampleId, LINEAGE_MINI_DEPTH),
    staleTime: 15_000,
  })
  const events = useQuery({
    queryKey: sampleEventsQueryKey(sampleId),
    queryFn: () => fetchSampleEvents(notebookDataClient, sampleId),
  })
  const graph = query.data
  const seed = graph?.nodes.find((node) => node.recordId === sampleId)
  const summary = graph && seed ? getLineageSummary(graph, seed.id) : null
  const rows = graph ? lineageTreeRows(graph, sampleId) : []
  const volume = sample.data
    ? deriveSampleVolumeSummary(sample.data, events.data ?? [])
    : null

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      {graph?.truncated ? (
        <Notice tone="warn">
          This sample has a large lineage; only the nearest neighbours are
          shown.
        </Notice>
      ) : null}

      <Section
        title="Lineage"
        action={
          <Button
            size="sm"
            onClick={() =>
              toast('Export started. You will get a link when it is ready.')
            }
          >
            Export lineage
          </Button>
        }
      >
        <p className="-mt-0.5 text-caption text-fg-muted">
          {summary
            ? `${summary.upstreamCount} parent chain · ${summary.downstreamCount} derived samples.`
            : 'Every derivation links to the experiment that made it.'}
        </p>
        {rows.length ? (
          <div className="overflow-hidden rounded-md border border-border text-body">
            <div className="grid h-[31px] grid-cols-[minmax(0,1fr)_220px_170px] items-center border-b border-border bg-surface-muted px-3 text-label font-medium text-fg-muted">
              <span>Sample</span>
              <span>Relation</span>
              <span>Status</span>
            </div>
            {rows.map((row) => {
              const status = sampleStatus(row.node.status)
              const destination = lineageNodeDestination(row.node)
              return (
                <div
                  key={row.node.id}
                  className="grid h-[34px] grid-cols-[minmax(0,1fr)_220px_170px] items-center border-b border-border-subtle px-3 last:border-b-0"
                >
                  <div
                    className="flex items-center gap-2"
                    style={{ paddingLeft: row.indent * INDENT_PX }}
                  >
                    {row.indent > 0 ? (
                      <span
                        aria-hidden="true"
                        className="muted font-mono text-fg-muted"
                      >
                        {row.branch}
                      </span>
                    ) : null}
                    <span className="mono">{row.node.identifier}</span>
                    <span className="truncate">
                      {destination ? (
                        <Link to={destination} className="text-link">
                          {row.node.title}
                        </Link>
                      ) : (
                        row.node.title
                      )}
                    </span>
                  </div>
                  <span className="truncate text-caption text-fg-muted">
                    {row.relation ?? '—'}
                  </span>
                  <span>
                    <Status tone={status.tone}>{status.label}</Status>
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            className="py-2"
            icon="folder"
            title="No lineage links yet"
            body="Parents and derived samples appear here once records are linked."
          />
        )}
      </Section>

      {sample.data ? (
        <Section title="Where this lot went">
          <WhereThisLotWent sample={sample.data} volume={volume} />
        </Section>
      ) : null}
    </div>
  )
}

interface TreeRow {
  node: LineageNode
  relation: string | null
  indent: number
  branch: string
}

/**
 * Order the graph into the design's tree: ancestors top-down, then this
 * sample, then its derivations by depth. Indentation is derived from the
 * node's distance from the root of the fetched slice.
 */
function lineageTreeRows(graph: LineageGraph, sampleId: string): TreeRow[] {
  const upstream = graph.nodes
    .filter((node) => node.direction === 'upstream')
    .sort((a, b) => a.identifier.localeCompare(b.identifier))
  const seed = graph.nodes.filter(
    (node) => node.recordId === sampleId || node.direction === 'seed',
  )
  const downstream = graph.nodes
    .filter((node) => node.direction === 'downstream')
    .sort((a, b) => a.identifier.localeCompare(b.identifier))

  const relationFor = (node: LineageNode, incoming: boolean): string | null => {
    const edge = graph.edges.find((candidate) =>
      incoming
        ? candidate.targetId === node.id
        : candidate.sourceId === node.id,
    )
    return edge?.relationLabel ?? edge?.label ?? null
  }

  const depthById = new Map(graph.nodes.map((node) => [node.id, node.depth]))
  const seedDepth = seed[0] ? (depthById.get(seed[0].id) ?? 0) : 0

  const ordered: TreeRow[] = []
  upstream.forEach((node, index) => {
    ordered.push({
      node,
      relation: relationFor(node, false),
      indent: index,
      branch: '├',
    })
  })
  for (const node of seed) {
    ordered.push({
      node,
      relation: relationFor(node, true) ?? 'This sample',
      indent: 0,
      branch: '└',
    })
  }
  for (const node of downstream) {
    const depth = depthById.get(node.id) ?? 1
    ordered.push({
      node,
      relation: relationFor(node, true),
      indent: Math.max(1, depth - seedDepth),
      branch: '├',
    })
  }
  return ordered
}

function WhereThisLotWent({
  sample,
  volume,
}: {
  sample: SampleRecord
  volume: SampleVolumeSummary | null
}) {
  const hold = computeSampleHold(sample)
  const remaining = volume?.current
  const used = volume?.used
  const unit = volume?.unit ? ` ${volume.unit}` : ''
  const cards = [
    used != null
      ? {
          label: 'Used',
          value: `${used.toLocaleString('en-GB')}${unit}`,
          note: 'Withdrawn from this lot',
        }
      : null,
    {
      label: 'Remaining',
      value:
        remaining != null ? `${remaining.toLocaleString('en-GB')}${unit}` : '—',
      note: hold
        ? `${sample.storageLocation ?? '—'} · hold until ${formatHoldDate(hold.expiry)}`
        : (sample.storageLocation ?? '—'),
    },
  ].filter((card): card is { label: string; value: string; note: string } =>
    Boolean(card),
  )
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-md border border-border p-3">
          <div className="text-caption text-fg-muted">{card.label}</div>
          <div className="num mt-0.5 text-[20px] font-medium">{card.value}</div>
          <div className="text-caption text-fg-muted">{card.note}</div>
        </div>
      ))}
    </div>
  )
}
