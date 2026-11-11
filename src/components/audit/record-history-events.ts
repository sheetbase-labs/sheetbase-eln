/**
 * The record history's wire-to-trail mapping. Kept out of the component module
 * so the timeline's wording can be tested as data and the component module
 * exports only its screen.
 */
import { z } from 'zod'

import { formatRelativeTime } from '#/lib/notebook-data'
import type { StoredJson } from '#/lib/sheet-presentation-view'
import type { TimelineEventWire } from '#/lib/sign-002'
import { t } from '#/copy'
import { AUDIT_DECISION_ICONS, AUDIT_OPERATION_ICONS } from './audit-icons'
import type { AuditEvent } from './audit-trail'

/** The stored change payload's per-field labels, when it captured them. */
const capturedChangesSchema = z.object({
  changes: z.record(z.string(), z.object({ label: z.string() })),
})

/** A loose wire field that reads as one value. */
const primitiveSchema = z.union([z.string(), z.number(), z.boolean()])

/**
 * A loose wire field said as text: a primitive as it reads, a container or an
 * absent field as nothing, so a row never shows `[object Object]`.
 */
function wireText(value: StoredJson | undefined): string {
  const primitive = primitiveSchema.safeParse(value).data

  return primitive === undefined ? '' : String(primitive)
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

/** The operation in past tense, so a title reads as "Registry entry created". */
const PAST_TENSE = new Map<string, string>([
  ['create', 'created'],
  ['update', 'updated'],
  ['delete', 'deleted'],
  ['archive', 'archived'],
  ['restore', 'restored'],
  ['move', 'moved'],
  ['link', 'linked'],
  ['unlink', 'unlinked'],
  ['lock', 'locked'],
  ['amend', 'amended'],
  ['quarantine', 'quarantined'],
  ['resolve', 'resolved'],
  ['reopen', 'reopened'],
  ['suspend', 'suspended'],
  ['revoke', 'revoked'],
])

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
      z.string().safeParse(event.eventType).data ?? event.title.split(' ')[0]

    const operation = wireText(event.operation)
    const done = PAST_TENSE.get(operation) ?? words(operation)

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
      return AUDIT_DECISION_ICONS[wireText(event.decision)] ?? 'history'
    case 'revision':
      return 'gitCommit'
    case 'change_event':
      return AUDIT_OPERATION_ICONS[wireText(event.operation)] ?? 'history'
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
      const captured = capturedChangesSchema.safeParse(event.payload).data
        ?.changes

      const labels = Object.values(captured ?? {}).map((change) => change.label)

      if (labels.length > 0) return labels.join(', ')

      // The title already says what happened.
      return ''
    }

    case 'revision':
      return wireText(event.reason)
    case 'submission':
      return wireText(event.state)
    case 'decision':
      return words(wireText(event.decision))
    case 'check':
      return wireText(event.overallStatus)
    case 'signature':
      return wireText(event.signatureMeaning)
    case 'comment':
      return wireText(event.state)
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
