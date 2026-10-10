import {
  CheckCircle2,
  ClipboardList,
  GitCommit,
  History,
  ListChecks,
  Undo2,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AuditTrail } from './audit-trail'
import type { AuditEvent } from './audit-trail'
import type { IconName } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
import { Skeleton } from '#/components/v3/ui/skeleton'
import type { TimelineEventWire } from '#/lib/sign-002'

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

const DECISION_ICONS: Partial<Record<string, IconName | LucideIcon>> = {
  approve: CheckCircle2,
  reject: XCircle,
  request_changes: Undo2,
  withdraw: Undo2,
}

const OPERATION_ICONS: Partial<Record<string, IconName | LucideIcon>> = {
  create: 'upload',
  update: History,
  move: History,
  delete: History,
  archive: History,
  restore: History,
  link: History,
  unlink: History,
  quarantine: History,
  resolve: History,
  reopen: History,
  lock: 'lock',
  amend: GitCommit,
}

function actorLabel(
  actorUserId: string | null | undefined,
  currentUserId?: string,
  currentUserName?: string,
): string {
  if (!actorUserId) return 'System'
  if (currentUserId && actorUserId === currentUserId && currentUserName) {
    return currentUserName
  }
  return actorUserId.slice(0, 8)
}

function relativeTime(ts: string): string {
  const then = Date.parse(ts)
  if (!Number.isFinite(then)) return ts
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  // Older than a month — show the calendar date for traceability.
  return new Date(then).toLocaleDateString()
}

function pickIcon(event: TimelineEventWire): IconName | LucideIcon {
  switch (event.type) {
    case 'signature':
      return 'edit'
    case 'comment':
      return 'comment'
    case 'check':
      return ListChecks
    case 'submission':
      return ClipboardList
    case 'decision':
      return DECISION_ICONS[String(event.decision)] ?? CheckCircle2
    case 'revision':
      return GitCommit
    case 'change_event':
      return OPERATION_ICONS[String(event.operation)] ?? History
    default:
      return History
  }
}

function detailPhrase(event: TimelineEventWire): string {
  switch (event.type) {
    case 'change_event': {
      // Captured facts (for example a protocol deviation's frozen and recorded
      // step text) name themselves, so the row says what changed rather than
      // repeating the operation.
      const payload = event.payload
      const captured =
        typeof payload === 'object' &&
        payload !== null &&
        'changes' in payload &&
        typeof payload.changes === 'object' &&
        payload.changes !== null
          ? payload.changes
          : null
      if (captured !== null) {
        const labels: string[] = []
        for (const change of Object.values(captured)) {
          if (
            typeof change === 'object' &&
            change !== null &&
            'label' in change &&
            typeof change.label === 'string'
          ) {
            labels.push(change.label)
          }
        }
        if (labels.length > 0) return labels.join(', ')
      }
      return String(event.operation ?? '')
    }
    case 'revision':
      return String(event.reason ?? '')
    case 'submission':
      return String(event.state ?? '')
    case 'decision':
      return String(event.decision ?? '')
    case 'check':
      return String(event.overallStatus ?? '')
    case 'signature':
      return String(event.signatureMeaning ?? '')
    case 'comment':
      return String(event.state ?? '')
    default:
      return ''
  }
}

/** Map RPC timeline events to the presentational AuditTrail events. */
export function mapTimelineEvents(
  events: TimelineEventWire[],
  currentUserId?: string,
  currentUserName?: string,
): AuditEvent[] {
  return events.map((event) => ({
    id: `${event.type}-${event.id}`,
    type: event.type,
    title: event.title,
    actor: {
      name: actorLabel(event.actorUserId, currentUserId, currentUserName),
    },
    timestamp: relativeTime(event.ts),
    icon: pickIcon(event),
    target: detailPhrase(event) || undefined,
  }))
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
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
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

  if (error) {
    return (
      <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <p role="alert" className="text-sm text-danger-text">
          Could not load the record history.
        </p>
        {onRefresh ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Retrying…' : 'Try again'}
          </Button>
        ) : null}
      </div>
    )
  }

  const mapped = mapTimelineEvents(events, currentUserId, currentUserName)

  return (
    <section aria-label="Record history" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Complete history</h2>
          <p className="text-xs text-fg-muted">
            Creation, edits, submissions, comments, checks, signatures and
            amendments — in the order they happened.
          </p>
        </div>
        {onRefresh ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        ) : null}
      </div>
      <AuditTrail events={mapped} totalCount={mapped.length} />
      {revisionId ? (
        <p className="font-mono text-xs text-fg-muted/70">
          Revision {revisionId.slice(0, 12)}…
          {integrityDigest
            ? ` · integrity ${integrityDigest.slice(0, 16)}…`
            : ''}
        </p>
      ) : null}
    </section>
  )
}
