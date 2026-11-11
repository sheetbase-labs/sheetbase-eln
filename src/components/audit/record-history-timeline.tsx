import { useMemo } from 'react'

import { useUserNames } from '#/lib/user-names'
import { AuditTrail } from './audit-trail'
import { mapTimelineEvents } from './record-history-events'
import { Button } from '#/components/ui/button'
import type { TimelineEventWire } from '#/lib/sign-002'
import { t } from '#/copy'

/**
 * RecordHistoryTimeline — SIGN-002 complete chronological history of a
 * record. Aggregates change_events, revisions, review submissions,
 * decisions, check results, signatures and comments (returned by the
 * `api.record_timeline` RPC) into a readable AuditTrail.
 *
 * Purely presentational: the data is fetched by the caller via
 * `fetchRecordTimeline` and invalidated after review/sign/amendment actions.
 * Actor attribution uses the current user's name when the event's actor is
 * the viewer, and falls back to a terse user-id label for collaborators
 * (actor names live in `internal.user`, which is not exposed to PostgREST).
 */
export interface RecordHistoryTimelineProps {
  events: TimelineEventWire[]
  loading?: boolean
  error?: unknown
  /** Revision id rendered in the footer integrity line, when available. */
  revisionId?: string | null
  /** Integrity digest rendered in the footer, when available. */
  integrityDigest?: string | null
  currentUserId?: string
  currentUserName?: string
  onRefresh?: () => void
  refreshing?: boolean
}

export function RecordHistoryTimeline({
  events,
  loading = false,
  error,
  revisionId,
  integrityDigest,
  currentUserId,
  currentUserName,
  onRefresh,
  refreshing = false,
}: RecordHistoryTimelineProps) {
  const actorIds = useMemo(
    () =>
      events.flatMap((event) => (event.actorUserId ? [event.actorUserId] : [])),
    [events],
  )

  const { names } = useUserNames(
    actorIds,
    currentUserId && currentUserName
      ? { id: currentUserId, name: currentUserName }
      : undefined,
  )

  const mapped = mapTimelineEvents(
    events,
    currentUserId,
    currentUserName,
    (userId) => names[userId],
  )

  return (
    <section
      aria-label={t('projects.recordHistory.label')}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {t('projects.recordHistory.title')}
          </h2>
          <p className="text-xs text-fg-muted">
            {t('projects.recordHistory.description')}
          </p>
        </div>
        {onRefresh ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing
              ? t('projects.recordHistory.refreshing')
              : t('common.actions.refresh')}
          </Button>
        ) : null}
      </div>
      <AuditTrail
        events={mapped}
        totalCount={mapped.length}
        loading={loading}
        error={error ? t('projects.recordHistory.loadFailed') : null}
        retry={onRefresh ? { onClick: onRefresh, busy: refreshing } : undefined}
      />
      {revisionId ? (
        <p className="font-mono text-xs text-fg-muted">
          {t('projects.recordHistory.revision', {
            id: revisionId.slice(0, 12),
          })}
          {integrityDigest
            ? ` · ${t('projects.recordHistory.integrity', { digest: integrityDigest.slice(0, 16) })}`
            : ''}
        </p>
      ) : null}
    </section>
  )
}
