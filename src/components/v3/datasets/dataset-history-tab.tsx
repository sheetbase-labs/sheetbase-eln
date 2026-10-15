/**
 * R5-SURF-01 — the dataset History tab.
 *
 * Result shape: the authoritative `api.change_events` stream for the dataset
 * (`entity_type = 'dataset'`, plus events whose payload names the dataset),
 * read through the same `api.audit_events` RPC as the sheet history dialog and
 * rendered by the shared `ObjectHistoryTimeline`. This is a real change stream,
 * not a seeded array: the design's History column (When · Who · Action ·
 * Detail) is exactly what the timeline's semantic events describe, and the
 * timeline additionally deep-links and paginates deterministically.
 *
 * States are explicit: loading skeletons, a denied message for non-members,
 * an error message, and the timeline's own honest empty state.
 */
import { useInfiniteQuery } from '@tanstack/react-query'

import { ObjectHistoryTimeline } from '#/components/audit/object-history-timeline'
import { classifyDatasetTabAccess } from '#/components/v3/datasets/dataset-detail-tabs'
import {
  auditHistoryDataClient,
  auditHistoryQueryKeys,
  fetchAuditEvents,
} from '#/lib/audit-history'

export function DatasetHistoryTab({ datasetId }: { datasetId: string }) {
  const historyQuery = useInfiniteQuery({
    queryKey: auditHistoryQueryKeys.events({ object: datasetId }),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      fetchAuditEvents(auditHistoryDataClient, {
        object: datasetId,
        limit: 50,
        ...(pageParam === undefined ? {} : { beforeSequence: pageParam }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })

  const events = historyQuery.data?.pages.flatMap((page) => page.events) ?? []
  const access = classifyDatasetTabAccess(historyQuery.error)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-5 md:px-6">
      <ObjectHistoryTimeline
        events={events}
        loading={historyQuery.isLoading}
        error={
          access === 'denied'
            ? 'History is not available for this dataset.'
            : access === 'error'
              ? 'History could not be loaded.'
              : null
        }
        hasMore={Boolean(historyQuery.hasNextPage)}
        onLoadMore={() => void historyQuery.fetchNextPage()}
        loadingMore={historyQuery.isFetchingNextPage}
        maxHeight="52vh"
      />
    </div>
  )
}
