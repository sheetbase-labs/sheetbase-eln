/**
 * WORK-03.4 — per-event email templates.
 *
 * Pure rendering so the outbox worker (and tests) can produce a subject and
 * body for each notification event without a transport.
 */
import { NOTIFICATION_EVENT_LABELS } from './notification-preferences'
import type { NotificationEventType } from './notification-preferences'

export interface EmailContext {
  /** The record or object the event is about. */
  recordIdentifier?: string | null
  recordTitle?: string | null
  /** Who triggered it. */
  actorName?: string | null
  /** Absolute link to the object, when known. */
  url?: string | null
}

export interface RenderedEmail {
  subject: string
  body: string
}

const SUBJECTS: Partial<Record<NotificationEventType, string>> = {
  review_requested: 'Review requested',
  review_returned_or_signed: 'A review you requested is returned or signed',
  signature_requested: 'Signature requested',
  validation_error: 'Validation error in your data',
  comment_or_mention: 'Comment or mention on your records',
  instrument_booking: 'Instrument booking confirmed or changed',
  instrument_service: 'Instrument out of service or back in service',
  storage_alarm: 'A freezer or room is outside its limits',
  material_expiring: 'Material lot expiring in 7 days',
  reagent_order: 'Reagent reorder update',
  request: 'Request made to you, or decided',
  step_timer: 'A step timer has ended',
  protocol_new_version: 'Protocol you use has a new version',
}

export function renderEmail(
  eventType: NotificationEventType,
  context: EmailContext = {},
): RenderedEmail {
  const subject = SUBJECTS[eventType] ?? NOTIFICATION_EVENT_LABELS[eventType]
  const parts: string[] = []
  if (context.actorName) parts.push(`${context.actorName} — ${subject}.`)
  else parts.push(`${subject}.`)
  if (context.recordIdentifier || context.recordTitle) {
    const label = [context.recordIdentifier, context.recordTitle]
      .filter(Boolean)
      .join(' · ')
    parts.push(label)
  }
  if (context.url) parts.push(`Open: ${context.url}`)
  parts.push('Sheetbase')
  return { subject, body: parts.join('\n') }
}
