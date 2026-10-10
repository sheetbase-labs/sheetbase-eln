import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import { ObjectHistoryTimeline } from './object-history-timeline'
import { auditHistoryDataClient, fetchAuditEvents } from '#/lib/audit-history'
import { DataClientError } from '#/lib/data-client'

/**
 * ObjectHistoryDialog — GOV-03 history surface for objects whose main
 * workspace is a full-bleed editor (Sheet Instances) or a catalogue row.
 * Shows the authoritative change_events stream for one object through the
 * shared semantic timeline; read-only, deterministic pages.
 */
export function ObjectHistoryDialog({
  objectId,
  objectLabel,
  triggerLabel = 'History',
}: {
  objectId: string
  /** Human noun used in copy, e.g. "Sheet". */
  objectLabel: string
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)

  const historyQuery = useInfiniteQuery({
    queryKey: ['audit-events', 'object', objectId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      fetchAuditEvents(auditHistoryDataClient, {
        object: objectId,
        limit: 50,
        ...(pageParam === undefined ? {} : { beforeSequence: pageParam }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: open,
  })

  const events = historyQuery.data?.pages.flatMap((page) => page.events) ?? []
  const denied =
    historyQuery.error instanceof DataClientError &&
    (historyQuery.error.code === 'permission_denied' ||
      historyQuery.error.code === 'unauthenticated')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" variant="secondary" icon="clock" />}
      >
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={`${objectLabel} history`}
          description={`Authoritative record of who changed this ${objectLabel.toLowerCase()}, when, how, and what changed — frozen after the fact.`}
        />
        <DialogBody className="max-h-[60vh] overflow-y-auto pr-1">
          <ObjectHistoryTimeline
            events={events}
            loading={historyQuery.isLoading}
            error={
              historyQuery.isError
                ? denied
                  ? `History is not available for this ${objectLabel.toLowerCase()}.`
                  : 'History could not be loaded.'
                : null
            }
            hasMore={Boolean(historyQuery.hasNextPage)}
            onLoadMore={() => void historyQuery.fetchNextPage()}
            loadingMore={historyQuery.isFetchingNextPage}
            maxHeight="52vh"
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
