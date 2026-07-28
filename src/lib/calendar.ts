/**
 * OPS-004 — Lab Calendar domain model and persistence boundary.
 *
 * Wire mappers, typed wrappers around the calendar RPCs (migration 0050),
 * and timezone-aware calendar navigation helpers for the day/week/month
 * views. PostgreSQL and RLS remain the authoritative access-control
 * boundary; these helpers drive the UI, normalise wire shapes and map RPC
 * error codes to actionable messages.
 */
import type { DataClient } from './data-client'
import { DataClientError } from './data-client'

// ---------------------------------------------------------------------------
// Wire shapes (PostgREST snake_case).
// ---------------------------------------------------------------------------

export type CalendarResourceType = 'instrument' | 'room' | 'equipment'
export type CalendarResourceStatus = 'active' | 'inactive'
export type CalendarBookingStatus = 'tentative' | 'confirmed' | 'cancelled'
export type CalendarParticipantRole = 'owner' | 'participant'
export type CalendarView = 'day' | 'week' | 'month'

export interface CalendarResourceWire {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  code: string
  resource_type: CalendarResourceType
  location: string | null
  capacity: number
  timezone: string
  status: CalendarResourceStatus
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}

export interface CalendarBookingWire {
  id: string
  workspace_id: string
  resource_id: string
  project_id: string | null
  title: string
  status: CalendarBookingStatus
  all_day: boolean
  starts_at: string
  ends_at: string
  timezone: string
  location: string | null
  color: string | null
  notes: string | null
  linked_experiment_record_id: string | null
  linked_experiment_identifier: string | null
  linked_experiment_title: string | null
  metadata_version: number
  cancelled_at: string | null
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}

export interface CalendarBookingParticipantWire {
  id: string
  workspace_id: string
  booking_id: string
  user_id: string | null
  display_name: string | null
  role: CalendarParticipantRole
  created_at: string
}

export interface CalendarBookingSampleWire {
  id: string
  workspace_id: string
  booking_id: string
  sample_record_id: string | null
  sample_identifier: string | null
  sample_title: string | null
  quantity_value: string | null
  quantity_unit: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Domain types (camelCase, used by the UI).
// ---------------------------------------------------------------------------

export interface CalendarResource {
  id: string
  workspaceId: string
  projectId: string | null
  name: string
  code: string
  resourceType: CalendarResourceType
  location: string | null
  capacity: number
  timezone: string
  status: CalendarResourceStatus
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CalendarBookingParticipant {
  id: string
  bookingId: string
  userId: string | null
  displayName: string | null
  role: CalendarParticipantRole
  createdAt: string
}

export interface CalendarBookingSample {
  id: string
  bookingId: string
  sampleRecordId: string | null
  sampleIdentifier: string | null
  sampleTitle: string | null
  quantityValue: number | null
  quantityUnit: string | null
  createdAt: string
}

export interface CalendarBooking {
  id: string
  workspaceId: string
  resourceId: string
  projectId: string | null
  title: string
  status: CalendarBookingStatus
  allDay: boolean
  startsAt: string
  endsAt: string
  timezone: string
  location: string | null
  color: string | null
  notes: string | null
  linkedExperimentRecordId: string | null
  linkedExperimentIdentifier: string | null
  linkedExperimentTitle: string | null
  metadataVersion: number
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  participants: CalendarBookingParticipant[]
  samples: CalendarBookingSample[]
}

export interface CalendarBookingInput {
  resourceId: string
  title: string
  startsAt: string
  endsAt: string
  timezone?: string
  status?: 'tentative' | 'confirmed'
  allDay?: boolean
  location?: string | null
  color?: string | null
  notes?: string | null
  projectId?: string | null
  linkedExperimentRecordId?: string | null
  participants?: Array<{
    userId?: string | null
    displayName?: string | null
    role?: CalendarParticipantRole
  }>
  samples?: Array<{
    sampleRecordId?: string | null
    sampleIdentifier?: string | null
    sampleTitle?: string | null
    quantityValue?: number | null
    quantityUnit?: string | null
  }>
}

// ---------------------------------------------------------------------------
// Wire → domain mappers.
// ---------------------------------------------------------------------------

export function toCalendarResource(
  wire: CalendarResourceWire,
): CalendarResource {
  return {
    id: wire.id,
    workspaceId: wire.workspace_id,
    projectId: wire.project_id,
    name: wire.name,
    code: wire.code,
    resourceType: wire.resource_type,
    location: wire.location,
    capacity: wire.capacity,
    timezone: wire.timezone,
    status: wire.status,
    metadata: wire.metadata,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  }
}

export function toCalendarParticipant(
  wire: CalendarBookingParticipantWire,
): CalendarBookingParticipant {
  return {
    id: wire.id,
    bookingId: wire.booking_id,
    userId: wire.user_id,
    displayName: wire.display_name,
    role: wire.role,
    createdAt: wire.created_at,
  }
}

export function toCalendarSample(
  wire: CalendarBookingSampleWire,
): CalendarBookingSample {
  return {
    id: wire.id,
    bookingId: wire.booking_id,
    sampleRecordId: wire.sample_record_id,
    sampleIdentifier: wire.sample_identifier,
    sampleTitle: wire.sample_title,
    quantityValue:
      wire.quantity_value == null ? null : Number(wire.quantity_value),
    quantityUnit: wire.quantity_unit,
    createdAt: wire.created_at,
  }
}

export function toCalendarBooking(
  booking: CalendarBookingWire,
  participants: CalendarBookingParticipantWire[] = [],
  samples: CalendarBookingSampleWire[] = [],
): CalendarBooking {
  return {
    id: booking.id,
    workspaceId: booking.workspace_id,
    resourceId: booking.resource_id,
    projectId: booking.project_id,
    title: booking.title,
    status: booking.status,
    allDay: booking.all_day,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    timezone: booking.timezone,
    location: booking.location,
    color: booking.color,
    notes: booking.notes,
    linkedExperimentRecordId: booking.linked_experiment_record_id,
    linkedExperimentIdentifier: booking.linked_experiment_identifier,
    linkedExperimentTitle: booking.linked_experiment_title,
    metadataVersion: booking.metadata_version,
    cancelledAt: booking.cancelled_at,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at,
    participants: participants.map(toCalendarParticipant),
    samples: samples.map(toCalendarSample),
  }
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const calendarQueryKeys = {
  resources: (workspaceId: string) =>
    ['ops-004', 'resources', workspaceId] as const,
  bookings: (workspaceId: string, start: string, end: string) =>
    ['ops-004', 'bookings', workspaceId, start, end] as const,
  bookingDetail: (bookingId: string) =>
    ['ops-004', 'booking-detail', bookingId] as const,
  participants: (bookingId: string) =>
    ['ops-004', 'participants', bookingId] as const,
  samples: (bookingId: string) => ['ops-004', 'samples', bookingId] as const,
}

// ---------------------------------------------------------------------------
// Data fetchers.
// ---------------------------------------------------------------------------

export async function fetchCalendarResources(
  client: DataClient,
  workspaceId: string,
): Promise<CalendarResource[]> {
  const rows = await client.list<CalendarResourceWire>(
    'calendar_resources',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=name`,
  )
  return rows.map(toCalendarResource)
}

/** Fetch bookings overlapping a [start, end) window (ISO UTC instants). */
export async function fetchCalendarBookings(
  client: DataClient,
  workspaceId: string,
  start: string,
  end: string,
): Promise<CalendarBookingWire[]> {
  return client.list<CalendarBookingWire>(
    'calendar_bookings',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&or=(starts_at.lte.${encodeURIComponent(end)},ends_at.gte.${encodeURIComponent(start)})` +
      `&order=starts_at.asc`,
  )
}

export async function fetchBookingParticipants(
  client: DataClient,
  bookingId: string,
): Promise<CalendarBookingParticipant[]> {
  const rows = await client.list<CalendarBookingParticipantWire>(
    'calendar_booking_participants',
    `?booking_id=eq.${encodeURIComponent(bookingId)}&order=role,created_at`,
  )
  return rows.map(toCalendarParticipant)
}

export async function fetchBookingSamples(
  client: DataClient,
  bookingId: string,
): Promise<CalendarBookingSample[]> {
  const rows = await client.list<CalendarBookingSampleWire>(
    'calendar_booking_samples',
    `?booking_id=eq.${encodeURIComponent(bookingId)}&order=created_at`,
  )
  return rows.map(toCalendarSample)
}

// ---------------------------------------------------------------------------
// RPC wrappers.
// ---------------------------------------------------------------------------

export async function createCalendarResource(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    code: string
    resourceType?: CalendarResourceType
    location?: string | null
    capacity?: number
    timezone?: string
    projectId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<CalendarResource> {
  const wire = await client.rpc<CalendarResourceWire>(
    'create_calendar_resource',
    {
      p_workspace_id: input.workspaceId,
      p_name: input.name,
      p_code: input.code,
      p_resource_type: input.resourceType ?? 'instrument',
      p_location: input.location ?? null,
      p_capacity: input.capacity ?? 1,
      p_timezone: input.timezone ?? 'UTC',
      p_project_id: input.projectId ?? null,
      p_metadata: input.metadata ?? {},
    },
  )
  return toCalendarResource(wire)
}

function serializeParticipants(
  participants: CalendarBookingInput['participants'] = [],
) {
  return participants.map((p) => ({
    userId: p.userId ?? null,
    displayName: p.displayName ?? null,
    role: p.role ?? 'participant',
  }))
}

function serializeSamples(samples: CalendarBookingInput['samples'] = []) {
  return samples.map((s) => ({
    sampleRecordId: s.sampleRecordId ?? null,
    sampleIdentifier: s.sampleIdentifier ?? null,
    sampleTitle: s.sampleTitle ?? null,
    quantityValue: s.quantityValue == null ? null : String(s.quantityValue),
    quantityUnit: s.quantityUnit ?? null,
  }))
}

export async function createBooking(
  client: DataClient,
  workspaceId: string,
  input: CalendarBookingInput,
): Promise<CalendarBookingWire> {
  return client.rpc('create_booking', {
    p_workspace_id: workspaceId,
    p_resource_id: input.resourceId,
    p_title: input.title,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_timezone: input.timezone ?? 'UTC',
    p_status: input.status ?? 'tentative',
    p_all_day: input.allDay ?? false,
    p_location: input.location ?? null,
    p_color: input.color ?? null,
    p_notes: input.notes ?? null,
    p_project_id: input.projectId ?? null,
    p_linked_experiment_record_id: input.linkedExperimentRecordId ?? null,
    p_participants: serializeParticipants(input.participants),
    p_samples: serializeSamples(input.samples),
  })
}

export async function editBooking(
  client: DataClient,
  input: {
    bookingId: string
    title?: string
    startsAt?: string
    endsAt?: string
    timezone?: string
    status?: CalendarBookingStatus
    allDay?: boolean
    location?: string | null
    color?: string | null
    notes?: string | null
    projectId?: string | null
    linkedExperimentRecordId?: string | null
    participants?: CalendarBookingInput['participants']
    samples?: CalendarBookingInput['samples']
    expectedMetadataVersion?: number
  },
): Promise<CalendarBookingWire> {
  return client.rpc('edit_booking', {
    p_booking_id: input.bookingId,
    p_title: input.title ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
    p_timezone: input.timezone ?? null,
    p_status: input.status ?? null,
    p_all_day: input.allDay ?? null,
    p_location: input.location ?? null,
    p_color: input.color ?? null,
    p_notes: input.notes ?? null,
    p_project_id: input.projectId ?? null,
    p_linked_experiment_record_id: input.linkedExperimentRecordId ?? null,
    p_participants: input.participants
      ? serializeParticipants(input.participants)
      : null,
    p_samples: input.samples ? serializeSamples(input.samples) : null,
    p_expected_metadata_version: input.expectedMetadataVersion ?? null,
  })
}

export async function duplicateBooking(
  client: DataClient,
  input: {
    bookingId: string
    startsAt: string
    endsAt: string
    title?: string
  },
): Promise<CalendarBookingWire> {
  return client.rpc('duplicate_booking', {
    p_booking_id: input.bookingId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_title: input.title ?? null,
  })
}

export async function cancelBooking(
  client: DataClient,
  input: { bookingId: string; expectedMetadataVersion?: number },
): Promise<CalendarBookingWire> {
  return client.rpc('cancel_booking', {
    p_booking_id: input.bookingId,
    p_expected_metadata_version: input.expectedMetadataVersion ?? null,
  })
}

// ---------------------------------------------------------------------------
// Error mapping.
// ---------------------------------------------------------------------------

export function describeCalendarError(error: unknown): string {
  if (!(error instanceof DataClientError))
    return 'Could not complete the calendar operation. Try again.'
  const messages: Record<string, string> = {
    SB001: 'This booking was edited by someone else. Refresh and try again.',
    SB005: 'The booking input is invalid. Check the details and try again.',
    SB009: 'The linked record is not the expected type.',
    SB016: 'The selected item belongs to a different workspace.',
    SB020: 'This time overlaps with an existing booking for that resource.',
    SB021: 'The resource was not found in this workspace.',
    SB022: 'The booking was not found in this workspace.',
    SB023: 'The end time must be after the start time.',
    SB024: 'This booking is already cancelled.',
    '42501': 'You do not have access to this calendar.',
  }
  return messages[error.code] ?? error.message
}

// ---------------------------------------------------------------------------
// Calendar navigation helpers (timezone-aware).
//
// All ranges are computed in the viewer's IANA timezone so DST boundaries
// fall on the correct wall-clock day. We rely on the platform Intl API; no
// date library dependency is introduced.
// ---------------------------------------------------------------------------

/** Local midnight in the given timezone as a UTC instant. */
export function startOfDayInZone(date: Date, timeZone: string): Date {
  // Format the wall-clock date, then construct a UTC midnight and shift by
  // the timezone offset for that instant.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value)
  const d = Number(parts.find((p) => p.type === 'day')!.value)
  // Build the wall-clock midnight, then find the UTC instant whose offset
  // maps back to it. Round-trip via the formatter to get the offset.
  const wallMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  const offsetMs = wallClockOffsetMs(wallMidnight, timeZone)
  return new Date(wallMidnight.getTime() - offsetMs)
}

/** Offset (ms) of the timezone at the given UTC instant. */
function wallClockOffsetMs(instant: Date, timeZone: string): number {
  const utcParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (t: string) => Number(utcParts.find((p) => p.type === t)!.value)
  const wallMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  )
  return wallMs - instant.getTime()
}

/** Monday of the week containing `date` (in timezone). */
export function startOfWeekInZone(date: Date, timeZone: string): Date {
  const start = startOfDayInZone(date, timeZone)
  const day = start.getUTCDay() // 0=Sun … 6=Sat
  const diff = (day + 6) % 7 // days since Monday
  return new Date(start.getTime() - diff * 86_400_000)
}

/** First of the month containing `date` (in timezone). */
export function startOfMonthInZone(date: Date, timeZone: string): Date {
  const start = startOfDayInZone(date, timeZone)
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

export function addMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  )
}

/** The [start, end) window for a view centred on `cursor`. */
export function viewRange(
  view: CalendarView,
  cursor: Date,
  timeZone: string,
): { start: Date; end: Date } {
  if (view === 'day') {
    const start = startOfDayInZone(cursor, timeZone)
    return { start, end: addDays(start, 1) }
  }
  if (view === 'week') {
    const start = startOfWeekInZone(cursor, timeZone)
    return { start, end: addDays(start, 7) }
  }
  const start = startOfMonthInZone(cursor, timeZone)
  return { start, end: addMonths(start, 1) }
}

/** Weekday labels starting Monday. */
export const WEEKDAY_LABELS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const

/** Format an instant as a wall-clock time in the timezone (e.g. 08:00). */
export function formatTimeInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant)
}

/** Format an instant as a short date in the timezone (e.g. 14 Jul). */
export function formatDateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
  }).format(instant)
}

/** Format an instant as a long date in the timezone (e.g. Mon 14 Jul 2025). */
export function formatLongDateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(instant)
}

/** Whether two instants fall on the same wall-clock day in the timezone. */
export function isSameDayInZone(a: Date, b: Date, timeZone: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(a) === fmt.format(b)
}

/** Detect whether a booking straddles a DST gap/ambiguity boundary. */
export function dstGapHours(
  startIso: string,
  endIso: string,
  timeZone: string,
): number {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const elapsedH = (end.getTime() - start.getTime()) / 3_600_000
  const startWall = wallHourOnSameDay(start, timeZone)
  const endWall = wallHourOnSameDay(end, timeZone)
  if (startWall == null || endWall == null) return 0
  const wallSpan = endWall - startWall
  return Math.round(elapsedH - wallSpan)
}

function wallHourOnSameDay(instant: Date, timeZone: string): number | null {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    day: '2-digit',
  }).formatToParts(instant)
  const hour = Number(parts.find((p) => p.type === 'hour')!.value)
  return hour === 24 ? 0 : hour
}

/** Colour tokens for booking categories (matches the mockup palette). */
export const BOOKING_COLOR_TOKENS: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-900 border-blue-300',
  green: 'bg-green-100 text-green-900 border-green-300',
  purple: 'bg-purple-100 text-purple-900 border-purple-300',
  orange: 'bg-orange-100 text-orange-900 border-orange-300',
}

export const BOOKING_COLOR_OPTIONS = Object.keys(BOOKING_COLOR_TOKENS)
