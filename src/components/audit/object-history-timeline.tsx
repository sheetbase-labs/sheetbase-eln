import { History } from 'lucide-react'

import {
  AUDIT_ENTITY_ICONS,
  AUDIT_OPERATION_ICONS,
  HistoryTimeline,
} from './history-timeline'
import type { HistoryEntry } from './history-timeline'
import { Badge } from '#/components/v3/ui/badge'
import {
  auditLinkFor,
  describeAuditEvent,
  groupAuditEvents,
} from '#/lib/audit-history'
import type { AuditEventWire } from '#/lib/audit-history'
import { formatNotebookDateTime, formatRelativeTime } from '#/lib/notebook-data'

/**
 * ObjectHistoryTimeline — GOV-03 reusable history surface for any object
 * class backed by authoritative `api.change_events` rows. Events render as
 * semantic phrases (who / when / what / before → after) with deep links to
 * canonical surfaces; a per-event raw view exposes the exact payload for
 * technical inspection without making raw JSON the primary UX.
 *
 * The component is purely presentational: pages arrive from
 * `fetchAuditEvents` (workspace-isolated, permission-aware RPC), the caller
 * owns pagination state, and the shared `history-timeline.tsx` owns the rows,
 * the before→after chips, the raw disclosure and every state.
 */

export interface ObjectHistoryTimelineProps {
  events: AuditEventWire[]
  loading?: boolean
  error?: string | null
  hasMore?: boolean
  onLoadMore?: () => void
  loadingMore?: boolean
  maxHeight?: string
  className?: string
}

function actorLabel(event: AuditEventWire): string {
  if (event.actorCredentialId) return 'API credential'
  if (event.actorName) return event.actorName
  if (event.actorUserId) return event.actorUserId.slice(0, 8)
  return 'System'
}

function iconFor(event: AuditEventWire) {
  return (
    AUDIT_OPERATION_ICONS[event.operation] ??
    AUDIT_ENTITY_ICONS[event.entityType] ??
    History
  )
}

/** The event's own identity facts, as the "Raw event" disclosure prints them. */
function rawPayload(event: AuditEventWire) {
  return {
    sequence: event.sequence,
    entityType: event.entityType,
    operation: event.operation,
    actorUserId: event.actorUserId,
    payload: event.payload,
  }
}

function toEntry(group: {
  primary: AuditEventWire
  related: AuditEventWire[]
}): HistoryEntry {
  const described = describeAuditEvent(group.primary)
  const correlated =
    group.related.length > 0 && group.primary.entityType === 'api_credential'

  return {
    id: group.primary.id,
    icon: iconFor(group.primary),
    title: (
      <>
        <span className="font-medium">{actorLabel(group.primary)}</span>
        <span className="text-fg-muted">{described.action}</span>
        <span className="truncate font-medium">{described.subject}</span>
      </>
    ),
    badge: correlated ? (
      <Badge variant="kind" className="h-4 px-1 text-[10px]">
        rotation
      </Badge>
    ) : undefined,
    time: formatRelativeTime(group.primary.createdAt),
    dateTime: group.primary.createdAt,
    detail: formatNotebookDateTime(group.primary.createdAt),
    changes: described.changes,
    related: group.related.map((related) => {
      const relatedDescribed = describeAuditEvent(related)
      return {
        id: related.id,
        text: `${relatedDescribed.action} ${relatedDescribed.subject}`,
      }
    }),
    link: auditLinkFor(group.primary),
    raw: rawPayload(group.primary),
  }
}

export function ObjectHistoryTimeline({
  events,
  loading = false,
  error = null,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  maxHeight = '32rem',
  className,
}: ObjectHistoryTimelineProps) {
  const entries = groupAuditEvents(events).map(toEntry)

  return (
    <HistoryTimeline
      entries={entries}
      ariaLabel="Object history"
      emptyMessage="No recorded activity for this object yet."
      loading={loading}
      error={error}
      maxHeight={maxHeight}
      className={className}
      loadMore={
        hasMore && onLoadMore
          ? { onClick: onLoadMore, busy: loadingMore }
          : undefined
      }
    />
  )
}
