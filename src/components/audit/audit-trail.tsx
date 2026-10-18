import type { ReactNode } from 'react'
import { History } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AUDIT_TYPE_ICONS, HistoryTimeline } from './history-timeline'
import type { HistoryEntry, HistoryRetry } from './history-timeline'
import type { IconName } from '#/components/icons'

/**
 * AuditTrail — a presentational timeline of typed audit events. It accepts
 * real events (typed actor, timestamp, target, type) and optional
 * pagination/continuation, and never mutates anything (UI-007: display is
 * separate from the commands that change review state).
 *
 * Icons, row layout, loading, empty and error rendering all live in
 * `history-timeline.tsx`; this module is the mapping from typed audit events
 * onto that surface, and the one place that composes the complete sr-only
 * sentence for an event.
 */

export interface AuditActor {
  name: string
  /** When the actor is unknown/anonymised, e.g. a deleted user. */
  unknown?: boolean
}

export interface AuditEvent {
  id: string
  /** Event kind, used to pick a default icon if `icon` is not provided. */
  type: string
  title: string
  actor?: AuditActor
  /** ISO or relative timestamp label. */
  timestamp: string
  /** Optional target record, e.g. "Protocol 4". */
  target?: string
  icon?: IconName | LucideIcon
}

export interface AuditTrailProps {
  events: AuditEvent[]
  loading?: boolean
  /** A load or permission failure, rendered as its own state. */
  error?: ReactNode
  /** The retry a failed load offers, when one exists. */
  retry?: HistoryRetry
  /** Total events known to exist, for "showing N of M". */
  totalCount?: number
  onLoadMore?: () => void
  loadingMore?: boolean
  /** Max height before the list scrolls; keeps inspectors usable. */
  maxHeight?: string
  className?: string
}

function eventSentence(event: AuditEvent): string {
  const actor = event.actor
    ? event.actor.unknown
      ? 'Someone'
      : event.actor.name
    : 'System'
  const target = event.target ? ` on ${event.target}` : ''
  return `${actor} ${event.title.toLowerCase()}${target} at ${event.timestamp}.`
}

function toEntry(event: AuditEvent): HistoryEntry {
  return {
    id: event.id,
    icon: event.icon ?? AUDIT_TYPE_ICONS[event.type] ?? History,
    title: event.title,
    actor: event.actor?.unknown
      ? 'Unknown user'
      : (event.actor?.name ?? 'System'),
    time: event.timestamp,
    detail: event.target,
    sentence: eventSentence(event),
  }
}

export function AuditTrail({
  events,
  loading = false,
  error = null,
  retry,
  totalCount,
  onLoadMore,
  loadingMore = false,
  maxHeight = '24rem',
  className,
}: AuditTrailProps) {
  const hasMore = totalCount !== undefined && events.length < totalCount

  return (
    <HistoryTimeline
      entries={events.map(toEntry)}
      ariaLabel="Audit trail"
      emptyMessage="No activity yet"
      emptyDescription="Events appear here as this object changes, newest first."
      loading={loading}
      error={error}
      retry={retry}
      maxHeight={maxHeight}
      className={className}
      loadMore={
        hasMore && onLoadMore
          ? {
              onClick: onLoadMore,
              busy: loadingMore,
              label: `Load more (${totalCount - events.length} left)`,
            }
          : undefined
      }
      footer={
        totalCount !== undefined
          ? `Showing ${events.length} of ${totalCount} events`
          : undefined
      }
    />
  )
}
