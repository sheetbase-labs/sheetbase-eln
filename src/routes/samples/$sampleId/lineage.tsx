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
  LINEAGE_MINI_DEPTH,
  lineageNodeDestination,
  lineageQueryKeys,
  lineageDataClient,
} from '#/lib/lineage-data'
import {
  rowIdentifier,
  rowTitle,
  sampleLineageRows,
  sampleLineageSummary,
} from '#/lib/sample-lineage-tree'
import { deriveSampleVolumeSummary, fetchSampleEvents } from '#/lib/samples'
import type { SampleRecord, SampleVolumeSummary } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  downloadLineageCsv,
  sampleEventsQueryKey,
  useSampleRecord,
} from '../$sampleId'
import { t } from '#/copy'

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
  const summary = graph ? sampleLineageSummary(graph, sampleId) : null
  const rows = graph ? sampleLineageRows(graph, sampleId) : []
  const volume = sample.data
    ? deriveSampleVolumeSummary(sample.data, events.data ?? [])
    : null

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      {graph?.truncated ? (
        <Notice tone="warn">
          {t('library.samples.lineage.thisSampleHasALarge')}
        </Notice>
      ) : null}

      <Section
        title={t('library.samples.lineage.lineage')}
        action={
          <Button
            size="sm"
            onClick={() => {
              try {
                const wrote = downloadLineageCsv(
                  sample.data?.identifier ?? 'sample',
                  rows.map((row) => ({
                    identifier: rowIdentifier(row),
                    title: rowTitle(row),
                    relation: row.relation,
                    status: sampleStatus(row.node.status).label,
                  })),
                )
                if (!wrote)
                  toast(t('library.samples.lineage.nothingToExportNoLineage'))
              } catch (error) {
                toast(t('library.samples.lineage.couldNotExportLineage'), {
                  description:
                    error instanceof Error
                      ? error.message
                      : t('library.samples.lineage.theDownloadFailed'),
                })
              }
            }}
          >
            {t('library.samples.lineage.exportLineage')}
          </Button>
        }
      >
        <p className="-mt-0.5 text-caption text-fg-muted">
          {summary
            ? t('library.samples.lineage.parentChainsAndDerived', {
                parentChains: t('library.samples.lineage.parentChains', {
                  count: summary.parentChains,
                }),
                derived: t('library.samples.lineage.derivedSamples', {
                  count: summary.derived,
                }),
              })
            : t('library.samples.lineage.everyDerivationLinksToThe')}
        </p>
        {rows.length ? (
          <div className="overflow-hidden rounded-md border border-border text-body">
            <div className="grid h-[31px] grid-cols-[minmax(0,1fr)_220px_170px] items-center border-b border-border bg-surface-muted px-3 text-label font-medium text-fg-muted">
              <span>{t('library.samples.lineage.sample')}</span>
              <span>{t('library.samples.lineage.relation')}</span>
              <span>{t('library.samples.lineage.status')}</span>
            </div>
            {rows.map((row) => {
              const status = sampleStatus(row.node.status)
              const destination = row.group
                ? null
                : lineageNodeDestination(row.node)
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
                    <span className="mono">{rowIdentifier(row)}</span>
                    <span className="truncate">
                      {destination ? (
                        <Link to={destination} className="text-link">
                          {rowTitle(row)}
                        </Link>
                      ) : (
                        rowTitle(row)
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
            title={t('library.samples.lineage.noLineageLinksYet')}
            description={t(
              'library.samples.lineage.parentsAndDerivedSamplesAppear',
            )}
          />
        )}
      </Section>

      {sample.data ? (
        <Section title={t('library.samples.lineage.whereThisLotWent')}>
          <WhereThisLotWent sample={sample.data} volume={volume} />
        </Section>
      ) : null}
    </div>
  )
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
          label: t('library.samples.lineage.used'),
          value: `${used.toLocaleString('en-GB')}${unit}`,
          note: t('library.samples.lineage.withdrawnFromThisLot'),
        }
      : null,
    {
      label: t('library.samples.lineage.remaining'),
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
