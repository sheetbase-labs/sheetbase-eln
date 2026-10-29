/**
 * WORK-03.1 — notification preferences data layer.
 *
 * Reads the caller's own notification preferences and timing (RLS: own rows)
 * and writes them through the SECURITY DEFINER RPCs, so the user always comes
 * from the request claims.
 */
import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

/**
 * Every event a person can mute or email, in the order the settings table shows
 * them. The Inbox, the bell, email and the digest all read this one list; the
 * database holds the same keys (api.notification_events) so muting reaches the
 * Inbox and email, and a test keeps the two equal.
 *
 * `source` says where the event comes from: a 'notification' is written when
 * it happens (email and the digest follow it), an 'inbox' event only exists as
 * an Inbox item, which email picks up on a sweep and the digest does not cover.
 */
export interface NotificationEventDef {
  key: string
  label: string
  group: string
  source: 'notification' | 'inbox'
  /** Email is on unless the person turns it off. */
  defaultEmail: boolean
}

const GROUP_REVIEWS = 'Reviews and signatures'
const GROUP_DATA = 'Data and runs'
const GROUP_LAB = 'Samples, materials and instruments'
const GROUP_PROTOCOLS = 'Protocols'
const GROUP_PEOPLE = 'Access and people'
const GROUP_OTHER = 'Comments and agents'

export const NOTIFICATION_EVENTS = [
  {
    key: 'review_requested',
    label: 'Review requested from you',
    group: GROUP_REVIEWS,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'review_returned_or_signed',
    label: 'A review you requested is returned or signed',
    group: GROUP_REVIEWS,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'signature_requested',
    label: 'Signature requested (witness, approval)',
    group: GROUP_REVIEWS,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'approval_requested',
    label: 'Approval requested from you',
    group: GROUP_REVIEWS,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'verification_requested',
    label: 'Someone needs their identity verified before signing',
    group: GROUP_REVIEWS,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'verification_granted',
    label: 'Your identity is verified',
    group: GROUP_REVIEWS,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'validation_error',
    label: 'Validation error in your data',
    group: GROUP_DATA,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'cell_conflict',
    label: 'A cell was changed in two places',
    group: GROUP_DATA,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'run_failed',
    label: 'An instrument run fails',
    group: GROUP_DATA,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'run_waiting',
    label: 'A run is waiting for you',
    group: GROUP_DATA,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'instrument_booking',
    label: 'Instrument booking confirmed or changed',
    group: GROUP_LAB,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'calibration_overdue',
    label: 'An instrument is overdue for calibration',
    group: GROUP_LAB,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'qualification_requested',
    label: 'Someone asks to be qualified on an instrument',
    group: GROUP_LAB,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'qualification_granted',
    label: 'You are qualified on an instrument',
    group: GROUP_LAB,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'material_expiring',
    label: 'Material lot expiring in 7 days',
    group: GROUP_LAB,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'sample_awaiting_release',
    label: 'A sample is awaiting release',
    group: GROUP_LAB,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'sample_hold_exceeded',
    label: 'A sample is held too long',
    group: GROUP_LAB,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'protocol_new_version',
    label: 'Protocol you use has a new version',
    group: GROUP_PROTOCOLS,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'protocol_training_required',
    label: 'A protocol needs you to read and acknowledge it',
    group: GROUP_PROTOCOLS,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'access_requested',
    label: 'Someone requests access',
    group: GROUP_PEOPLE,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'access_decided',
    label: 'Your access request is decided',
    group: GROUP_PEOPLE,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'invitation_accepted',
    label: 'An invitation you sent is accepted',
    group: GROUP_PEOPLE,
    source: 'inbox',
    defaultEmail: false,
  },
  {
    key: 'comment_or_mention',
    label: 'Comment or mention on your records',
    group: GROUP_OTHER,
    source: 'notification',
    defaultEmail: true,
  },
  {
    key: 'agent_proposal',
    label: 'An agent proposes a change for you to approve',
    group: GROUP_OTHER,
    source: 'inbox',
    defaultEmail: false,
  },
] as const satisfies readonly NotificationEventDef[]

export type NotificationEventType = (typeof NOTIFICATION_EVENTS)[number]['key']

export const NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] =
  NOTIFICATION_EVENTS.map((event) => event.key)

export const NOTIFICATION_EVENT_LABELS = Object.fromEntries(
  NOTIFICATION_EVENTS.map((event) => [event.key, event.label]),
) as Record<NotificationEventType, string>

const eventDefinition = (
  eventType: NotificationEventType,
): NotificationEventDef =>
  NOTIFICATION_EVENTS.find((event) => event.key === eventType)!

/** Events the daily digest can include: those that write a notification. */
export const digestCovers = (eventType: NotificationEventType): boolean =>
  eventDefinition(eventType).source === 'notification'

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

/** The default when a user has no saved row: in-app on, email as the event says. */
export function defaultPreference(
  eventType: NotificationEventType,
): NotificationPreference {
  return {
    eventType,
    inApp: true,
    email: eventDefinition(eventType).defaultEmail,
    digest: false,
  }
}

export function defaultPreferences(): NotificationPreference[] {
  return NOTIFICATION_EVENT_TYPES.map(defaultPreference)
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
    (eventType) => saved.get(eventType) ?? defaultPreference(eventType),
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
