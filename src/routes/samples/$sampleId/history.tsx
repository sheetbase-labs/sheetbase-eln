import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import type { SampleEvent } from '#/lib/samples'
import {
  formatSampleEventTime,
  formatSampleEventTimestamp,
  sampleEventAction,
  sampleEventChange,
  sampleEventDetail,
} from '#/components/v3/samples/sample-history'
import { fetchSampleEvents } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'

/**
 * LAB-03 / step 4 — the sample History tab. It renders the canonical,
 * append-only `api.sample_events` chain of custody (who, when, action, detail
 * and the quantity/location change) and nothing else. The recent-history
 * inspector summary lives in the sample frame.
 */
export const Route = createFileRoute('/samples/$sampleId/history')({
  component: SampleHistory,
})

function SampleHistory() {
  const { sampleId } = Route.useParams()
  const events = useQuery({
    queryKey: ['ui-port', 'sample-events', sampleId],
    queryFn: () => fetchSampleEvents(notebookDataClient, sampleId),
  })
  const rows = events.data ?? []
  const names = useUserNames(
    rows.map((e) => e.actorUserId ?? '').filter(Boolean),
  )

  const columns: RegistryColumn<SampleEvent>[] = [
    {
      id: 'when',
      header: t('library.samples.history.when'),
      cell: ({ row }) => (
        <span
          className="text-fg-muted"
          title={formatSampleEventTimestamp(row.original.createdAt)}
        >
          {formatSampleEventTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'who',
      header: t('library.samples.history.who'),
      cell: ({ row }) =>
        row.original.actorUserId
          ? names.userLabel(row.original.actorUserId)
          : t('library.samples.history.system'),
    },
    {
      id: 'action',
      header: t('library.samples.history.action'),
      cell: ({ row }) => (
        <span className="font-medium">
          {sampleEventAction(row.original.operation)}
        </span>
      ),
    },
    {
      id: 'detail',
      header: t('library.samples.history.detail'),
      cell: ({ row }) => sampleEventDetail(row.original) ?? '—',
      meta: { cellClassName: 'max-w-[22rem] whitespace-normal leading-[17px]' },
    },
    {
      id: 'change',
      header: t('library.samples.history.change'),
      cell: ({ row }) => sampleEventChange(row.original) ?? '—',
      meta: { cellClassName: 'num text-fg-muted' },
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section title={t('library.samples.history.history')} count={rows.length}>
        {rows.length ? (
          <>
            <TableBox>
              <RegistryGrid
                label={t('library.samples.history.sampleHistory')}
                rows={rows}
                columns={columns}
                getRowId={(e) => e.id}
                selectable={false}
              />
            </TableBox>
            <p className="m-0 text-label text-fg-muted">
              {t('library.samples.history.historyIsWrittenByThe')}
            </p>
          </>
        ) : (
          <EmptyState
            className="py-2"
            icon="clock"
            title={t('library.samples.history.noHistoryYet')}
            description={t(
              'library.samples.history.receiptsWithdrawalsAndMovesAppear',
            )}
          />
        )}
      </Section>
    </div>
  )
}
