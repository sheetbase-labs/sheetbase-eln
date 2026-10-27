import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { DescriptionList, Inspector } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { fetchLineageGraph, lineageDataClient } from '#/lib/lineage-data'
import { notebookDataClient } from '#/lib/notebook-data'
import type { SampleRecord } from '#/lib/samples'
import { sampleStatus } from './samples-data'
import { formatDate } from '#/lib/format-date'

/** The quantity a sample carries, as the registry shows it. */
function quantityLabel(record: SampleRecord): string {
  if (record.quantity == null) return '—'
  const amount = record.quantity.toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })
  return record.quantityUnit ? `${amount} ${record.quantityUnit}` : amount
}

function dayLabel(value: string | null): string | null {
  if (!value) return null
  return formatDate(value)
}

/** The experiments that cite this sample, read from the links they wrote. */
function useSampleCitations(sample: SampleRecord) {
  return useQuery({
    queryKey: ['ui-port', 'sample-inspector', 'citations', sample.id],
    queryFn: async () => {
      const links = await notebookDataClient.list<{
        source_record_id: string
      }>(
        'record_links',
        `?target_record_id=eq.${encodeURIComponent(sample.id)}&link_type=eq.sample&select=source_record_id`,
      )
      const ids = [...new Set(links.map((link) => link.source_record_id))]
      if (ids.length === 0) return []
      return notebookDataClient.list<{
        id: string
        identifier: string
        title: string
      }>(
        'records',
        `?id=in.(${ids.map(encodeURIComponent).join(',')})&deleted_at=is.null&select=id,identifier,title`,
      )
    },
    staleTime: 15_000,
  })
}

/**
 * The right-hand panel of the sample registry: what the selected sample is,
 * how much of it is left, what was made from it and where it was used. The
 * full record, with withdrawals and history, is one click away.
 */
export function SampleInspector({ sample }: { sample: SampleRecord }) {
  const status = sampleStatus(sample.status, sample.releasedAt)
  const lineage = useQuery({
    queryKey: ['ui-port', 'sample-inspector', 'lineage', sample.id],
    queryFn: () => fetchLineageGraph(lineageDataClient, sample.id, 1),
    staleTime: 15_000,
  })
  const citations = useSampleCitations(sample)
  const derived = (lineage.data?.nodes ?? []).filter(
    (node) =>
      node.entityType === 'sample' &&
      node.recordId !== sample.id &&
      node.direction === 'downstream',
  )
  const holdUntil = dayLabel(sample.holdUntil)
  return (
    <Inspector aria-label="Sample" className="gap-0 p-0">
      <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
        <span className="mono text-fg-muted">{sample.identifier}</span>
        <div className="font-heading text-doc font-semibold">
          {sample.title}
        </div>
        <div className="text-label">
          <Status tone={status.tone}>{status.label}</Status>
          {sample.quantity != null ? (
            <span className="text-fg-muted">
              {' '}
              · {quantityLabel(sample)}
              {' left'}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            nativeButton={false}
            render={
              <Link to="/samples/$sampleId" params={{ sampleId: sample.id }} />
            }
          >
            Open record
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link
                to="/samples/$sampleId"
                params={{ sampleId: sample.id }}
                search={{ withdraw: true }}
              />
            }
          >
            Withdraw…
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4 py-3.5">
        <section>
          <h2 className="mb-1.5 font-sans text-label font-semibold">
            Key properties
          </h2>
          <DescriptionList
            labelWidth={88}
            items={[
              ['Type', sample.sampleType ?? '—'],
              ['Quantity', quantityLabel(sample)],
              ['Location', sample.storageLocation ?? '—'],
              ...(holdUntil
                ? ([['Hold limit', holdUntil]] as [string, string][])
                : []),
              ['Registered', dayLabel(sample.createdAt) ?? '—'],
            ]}
          />
        </section>
        <section>
          <h2 className="mb-1.5 font-sans text-label font-semibold">
            Derived samples
          </h2>
          <p className="text-label text-fg-muted">
            {lineage.isLoading
              ? 'Reading lineage…'
              : derived.length === 0
                ? 'Nothing has been made from this sample.'
                : `${derived.length} made from this sample`}
            {derived.length > 0 ? (
              <>
                {' · '}
                <Link
                  to="/samples/$sampleId/lineage"
                  params={{ sampleId: sample.id }}
                  className="text-link"
                >
                  see lineage
                </Link>
              </>
            ) : null}
          </p>
        </section>
        {citations.data?.length ? (
          <section>
            <h2 className="mb-1.5 font-sans text-label font-semibold">
              Used in
            </h2>
            <ul className="flex flex-col gap-1">
              {citations.data.map((experiment) => (
                <li key={experiment.id} className="text-label">
                  <Link
                    to="/experiments/$expId"
                    params={{ expId: experiment.id }}
                    className="text-link mono"
                  >
                    {experiment.identifier}
                  </Link>
                  {' · '}
                  {experiment.title}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Inspector>
  )
}
