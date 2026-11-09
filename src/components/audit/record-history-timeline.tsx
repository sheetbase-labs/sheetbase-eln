import { useMemo } from 'react'

import { useUserNames } from '#/lib/user-names'
import { AuditTrail } from './audit-trail'
import type { AuditEvent } from './audit-trail'
import { AUDIT_DECISION_ICONS, AUDIT_OPERATION_ICONS } from './history-timeline'
import { Button } from '#/components/ui/button'
import { formatRelativeTime } from '#/lib/notebook-data'
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

function actorLabel(
  actorUserId: string | null | undefined,
  currentUserId?: string,
  currentUserName?: string,
  nameOf?: (userId: string) => string | undefined,
): string {
  if (!actorUserId) return t('projects.recordHistory.system')

  if (currentUserId && actorUserId === currentUserId && currentUserName) {
    return currentUserName
  }

  return nameOf?.(actorUserId) ?? actorUserId.slice(0, 8)
}

const PAST_TENSE: Record<string, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  archive: 'archived',
  restore: 'restored',
  move: 'moved',
  link: 'linked',
  unlink: 'unlinked',
  lock: 'locked',
  amend: 'amended',
  quarantine: 'quarantined',
  resolve: 'resolved',
  reopen: 'reopened',
  suspend: 'suspended',
  revoke: 'revoked',
}

function words(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim()
}

function sentence(value: string): string {
  const text = words(value)

  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The timeline names events the way the database stores them ("registry_entry
 * create", "review approve"). Said in plain words: "Registry entry created".
 */
function friendlyTitle(event: TimelineEventWire): string {
  if (event.type === 'change_event') {
    const entity =
      typeof event.eventType === 'string'
        ? event.eventType
        : (event.title.split(' ')[0] ?? '')

    const operation = String(event.operation ?? '')
    const done = PAST_TENSE[operation] ?? words(operation)

    return sentence(`${words(entity)} ${done}`.trim()) || sentence(event.title)
  }

  return sentence(event.title)
}

function pickIcon(event: TimelineEventWire) {
  switch (event.type) {
    case 'signature':
      return 'edit'
    case 'comment':
      return 'comment'
    case 'check':
      return 'listChecks'
    case 'submission':
      return 'clipboardList'
    case 'decision':
      return AUDIT_DECISION_ICONS[String(event.decision)] ?? 'history'
    case 'revision':
      return 'gitCommit'
    case 'change_event':
      return AUDIT_OPERATION_ICONS[String(event.operation)] ?? 'history'
    default:
      return 'history'
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

      // The title already says what happened.
      return ''
    }

    case 'revision':
      return String(event.reason ?? '')
    case 'submission':
      return String(event.state ?? '')
    case 'decision':
      return words(String(event.decision ?? ''))
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

/**
 * A record made from a model is logged twice: once as the model's own entry
 * ("Incident created") and once as the generic "Record created". Said once is
 * enough, so the generic one goes when a specific one is there.
 */
function withoutGenericCreate(
  events: TimelineEventWire[],
): TimelineEventWire[] {
  const isCreate = (event: TimelineEventWire, generic: boolean) =>
    event.type === 'change_event' &&
    event.operation === 'create' &&
    (event.eventType === 'record') === generic

  // Every event here already belongs to the one record.
  if (!events.some((event) => isCreate(event, false))) return events

  return events.filter((event) => !isCreate(event, true))
}

/** Map RPC timeline events to the presentational AuditTrail events. */
export function mapTimelineEvents(
  events: TimelineEventWire[],
  currentUserId?: string,
  currentUserName?: string,
  nameOf?: (userId: string) => string | undefined,
): AuditEvent[] {
  return withoutGenericCreate(events).map((event) => ({
    id: `${event.type}-${event.id}`,
    type: event.type,
    title: friendlyTitle(event),
    actor: {
      name: actorLabel(
        event.actorUserId,
        currentUserId,
        currentUserName,
        nameOf,
      ),
      userId: event.actorUserId,
    },
    timestamp: formatRelativeTime(event.ts),
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
