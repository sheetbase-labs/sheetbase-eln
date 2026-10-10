/**
 * WORK-03.1 — notification preferences data layer.
 *
 * Reads the caller's own notification preferences and timing (RLS: own rows)
 * and writes them through the SECURITY DEFINER RPCs, so the user always comes
 * from the request claims.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

export const NOTIFICATION_EVENT_TYPES = [
  'review_requested',
  'review_returned_or_signed',
  'signature_requested',
  'validation_error',
  'comment_or_mention',
  'instrument_booking',
  'material_expiring',
  'protocol_new_version',
] as const

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> =
  {
    review_requested: 'Review requested from you',
    review_returned_or_signed: 'A review you requested is returned or signed',
    signature_requested: 'Signature requested (witness, approval)',
    validation_error: 'Validation error in your data',
    comment_or_mention: 'Comment or mention on your records',
    instrument_booking: 'Instrument booking confirmed or changed',
    material_expiring: 'Material lot expiring in 7 days',
    protocol_new_version: 'Protocol you use has a new version',
  }

export interface NotificationPreference {
  eventType: NotificationEventType
  inApp: boolean
  email: boolean
  digest: boolean
}

interface NotificationPreferenceWire {
  event_type: string
  in_app: boolean
  email: boolean
  digest: boolean
}

export interface NotificationTiming {
  quietHoursStart: string | null
  quietHoursEnd: string | null
  digestTime: string | null
}

interface UserPreferencesWire {
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  digest_time: string | null
}

export const notificationPreferencesQueryKeys = {
  preferences: () => ['notification-preferences'] as const,
  timing: () => ['notification-timing'] as const,
}

const isEventType = (value: string): value is NotificationEventType =>
  (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value)

/** The default when a user has no saved row: in-app and email on. */
export function defaultPreferences(): NotificationPreference[] {
  return NOTIFICATION_EVENT_TYPES.map((eventType) => ({
    eventType,
    inApp: true,
    email: true,
    digest: false,
  }))
}

export async function fetchNotificationPreferences(
  client: DataClient = notebookDataClient,
): Promise<NotificationPreference[]> {
  const rows = await client.list<NotificationPreferenceWire>(
    'notification_preferences',
    '?select=event_type,in_app,email,digest',
  )
  const saved = new Map(
    rows
      .filter((row) => isEventType(row.event_type))
      .map((row) => [
        row.event_type as NotificationEventType,
        {
          eventType: row.event_type as NotificationEventType,
          inApp: row.in_app,
          email: row.email,
          digest: row.digest,
        },
      ]),
  )
  return NOTIFICATION_EVENT_TYPES.map(
    (eventType) =>
      saved.get(eventType) ?? {
        eventType,
        inApp: true,
        email: true,
        digest: false,
      },
  )
}

export async function fetchNotificationTiming(
  client: DataClient = notebookDataClient,
): Promise<NotificationTiming> {
  const rows = await client.list<UserPreferencesWire>(
    'user_preferences',
    '?select=quiet_hours_start,quiet_hours_end,digest_time&limit=1',
  )
  return {
    quietHoursStart: rows[0]?.quiet_hours_start ?? null,
    quietHoursEnd: rows[0]?.quiet_hours_end ?? null,
    digestTime: rows[0]?.digest_time ?? null,
  }
}

export async function saveNotificationPreference(
  preference: NotificationPreference,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('save_notification_preference', {
    p_event_type: preference.eventType,
    p_in_app: preference.inApp,
    p_email: preference.email,
    p_digest: preference.digest,
  })
}

export async function saveNotificationTiming(
  timing: NotificationTiming,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('set_notification_timing', {
    p_quiet_start: timing.quietHoursStart,
    p_quiet_end: timing.quietHoursEnd,
    p_digest_time: timing.digestTime,
  })
}
