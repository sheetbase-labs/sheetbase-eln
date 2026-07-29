import {
  ChevronRight,
  FileCheck2,
  FlaskConical,
  History,
  Upload,
  UserCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button, Skeleton } from '#/components/ui'
import { cn } from '#/lib/utils'

/**
 * AuditTrail — a presentational timeline of typed audit events. It accepts
 * real events (typed actor, timestamp, target, type) and optional
 * pagination/continuation, and never mutates anything (UI-007: display is
 * separate from the commands that change review state).
 *
 * Long histories are handled by a capped scroll region and a "Load more"
 * continuation control; the list stays usable inside an inspector.
 * Connector graphics are decorative; each event exposes a complete
 * sr-only sentence for screen readers.
 */

export interface AuditActor {
  name: string
  initials?: string
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
  icon?: LucideIcon
}

export interface AuditTrailProps {
  events: AuditEvent[]
  loading?: boolean
  /** Total events known to exist, for "showing N of M". */
  totalCount?: number
  onLoadMore?: () => void
  loadingMore?: boolean
  /** Max height before the list scrolls; keeps inspectors usable. */
  maxHeight?: string
  className?: string
}

const typeIcons: Partial<Record<string, LucideIcon>> = {
  created: FlaskConical,
  uploaded: Upload,
  'review-requested': FileCheck2,
  'review-started': UserCheck,
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

export function AuditTrail({
  events,
  loading = false,
  totalCount,
  onLoadMore,
  loadingMore = false,
  maxHeight = '24rem',
  className,
}: AuditTrailProps) {
  const hasMore = totalCount !== undefined && events.length < totalCount

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5 pt-1">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        No activity yet
      </p>
    )
  }

  return (
    <div className={cn('space-y-0', className)}>
      <ol
        className={cn('space-y-0 overflow-y-auto pr-1')}
        style={{ maxHeight }}
        aria-label="Audit trail"
      >
        {events.map((event, i) => {
          const Icon = event.icon ?? typeIcons[event.type] ?? History
          const isLast = i === events.length - 1
          const actor = event.actor
          return (
            <li
              key={event.id}
              className={cn('relative flex gap-3', isLast ? 'pb-0' : 'pb-4')}
            >
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className="absolute left-4 top-8 h-[calc(100%-1.5rem)] w-px bg-border"
                />
              ) : null}
              <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 pt-1">
                <p className="text-sm font-medium">{event.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {actor?.unknown ? 'Unknown user' : (actor?.name ?? 'System')}
                  {' · '}
                  {event.timestamp}
                  {event.target ? ` · ${event.target}` : ''}
                </p>
              </div>
              <span className="sr-only">{eventSentence(event)}</span>
            </li>
          )
        })}
      </ol>
      {hasMore && onLoadMore ? (
        <div className="pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            <ChevronRight className="mr-1 size-3.5" />
            {loadingMore
              ? 'Loading…'
              : `Load more (${totalCount - events.length} left)`}
          </Button>
        </div>
      ) : null}
      {totalCount !== undefined ? (
        <p className="pt-2 text-xs text-muted-foreground">
          Showing {events.length} of {totalCount} events
        </p>
      ) : null}
    </div>
  )
}
