import { z } from 'zod'

import {
  BOOKING_CANCEL_TOOL,
  BOOKING_CREATE_TOOL,
  BOOKING_MOVE_TOOL,
  describeSlot,
  findFreeGaps,
  instantFromLocal,
  localFromInstant,
  proposeBookingCancelSchema,
  proposeBookingCreateSchema,
  proposeBookingMoveSchema,
} from './assistant-booking'
import type { AssistantProposal } from './assistant-proposals'
import { describeMinutes } from './booking-rules'
import type { CalendarBookingWire } from './calendar'
import type { DataClient } from './data-client'
import type { ProviderToolDef } from './ai-providers/types'

/**
 * The assistant's view of the lab's day-to-day features: the schedule, free
 * time on an instrument, and the lists behind Requests, Shipments, Incidents,
 * Registry and the rest. Everything here reads under the person's own access
 * (row-level security decides what they see) and finds things by the names
 * people use, so the model never has to ask anyone for an id. Bookings are
 * proposed as cards; see `assistant-booking.ts`.
 */

export const SCHEDULE_TOOL = 'sheetbase.schedule.read'
export const FREE_TIME_TOOL = 'sheetbase.schedule.free_time'
export const LAB_LIST_TOOL = 'sheetbase.lab.list'

export const LAB_READ_TOOL_NAMES = [
  SCHEDULE_TOOL,
  FREE_TIME_TOOL,
  LAB_LIST_TOOL,
] as const

export const BOOKING_PROPOSE_TOOL_NAMES = [
  BOOKING_CREATE_TOOL,
  BOOKING_MOVE_TOOL,
  BOOKING_CANCEL_TOOL,
] as const

export type BookingProposeToolName = (typeof BOOKING_PROPOSE_TOOL_NAMES)[number]

const DAY = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export const scheduleReadSchema = z
  .object({
    instrument: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Only this instrument, by name or INS number.'),
    from: z
      .string()
      .regex(DAY)
      .optional()
      .describe('First day, YYYY-MM-DD. Defaults to today.'),
    days: z.number().int().min(1).max(31).optional(),
    mine: z.boolean().optional().describe('Only the person’s own bookings.'),
  })
  .strict()

export const freeTimeSchema = z
  .object({
    instrument: z
      .string()
      .min(1)
      .max(200)
      .describe('The instrument, by name or INS number.'),
    from: z
      .string()
      .regex(DAY)
      .optional()
      .describe('First day, YYYY-MM-DD. Defaults to today.'),
    days: z.number().int().min(1).max(14).optional(),
    durationMinutes: z
      .number()
      .int()
      .min(5)
      .max(1_440)
      .optional()
      .describe('How long the person needs it. Defaults to 60.'),
    dayStart: z
      .string()
      .regex(HHMM)
      .optional()
      .describe('Earliest start each day, HH:MM. Defaults to 08:00.'),
    dayEnd: z
      .string()
      .regex(HHMM)
      .optional()
      .describe('Latest finish each day, HH:MM. Defaults to 18:00.'),
    weekends: z.boolean().optional().describe('Include Saturday and Sunday.'),
  })
  .strict()

/**
 * The lab areas the assistant can list. Each is a page in the app; the model
 * reads the list, then opens the page or a record when the person wants to
 * act on it.
 */
export const LAB_AREAS = {
  instruments: 'Instruments: status, location, out of service, booking rules',
  requests: 'Requests sent to the lab through request forms, and their status',
  shipments: 'Sample shipments in and out, with carrier and status',
  incidents: 'Incidents, deviations and near misses (incident log models)',
  registry: 'Registry entries: constructs, cell lines, antibodies and so on',
  sample_workflows: 'Sample workflows: stages samples move through',
  spec_limits: 'Result limits on model fields (specification and alert)',
  reagent_orders: 'Reagent orders and their status',
  recurring_work: 'Recurring experiments and bookings',
  stocktakes: 'Stocktakes of storage',
  instrument_service: 'Instrument service and repair visits',
  label_templates: 'Label templates for printing',
  legal_holds: 'Legal holds keeping records from deletion',
  retention_rules: 'How long each kind of record is kept',
} as const

export type LabArea = keyof typeof LAB_AREAS

export const labListSchema = z
  .object({
    area: z.enum(Object.keys(LAB_AREAS) as [LabArea, ...LabArea[]]),
    query: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('Words in the name, number or title to narrow the list.'),
    openOnly: z
      .boolean()
      .optional()
      .describe('Leave out finished, cancelled or closed items.'),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()

export function toolDef(
  name: string,
  description: string,
  schema: z.ZodType,
): ProviderToolDef {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(schema, {
    io: 'input',
  })
  return { name: name.replaceAll('.', '__'), description, parameters }
}

export function labToolDefs(): ProviderToolDef[] {
  return [
    toolDef(
      SCHEDULE_TOOL,
      'Read the instrument schedule: bookings in a date range, for one instrument or all, or only the person’s own. Times are on the person’s clock. Each booking has an id for moving or cancelling it.',
      scheduleReadSchema,
    ),
    toolDef(
      FREE_TIME_TOOL,
      'Find when an instrument is free: gaps long enough for the time asked, inside working hours, with the instrument’s booking rules and anything that would stop the person booking it (out of service, missing training).',
      freeTimeSchema,
    ),
    toolDef(
      LAB_LIST_TOOL,
      `List what is in one area of the lab, optionally narrowed by name. Areas: ${Object.entries(
        LAB_AREAS,
      )
        .map(([key, text]) => `${key} (${text})`)
        .join('; ')}.`,
      labListSchema,
    ),
  ]
}

export function bookingProposalDefs(): ProviderToolDef[] {
  const note =
    'The person sees a card and presses a button to do it; nothing changes until they do.'
  return [
    toolDef(
      BOOKING_CREATE_TOOL,
      `Propose booking an instrument. Name the instrument as the person does. Check free time first. ${note}`,
      proposeBookingCreateSchema,
    ),
    toolDef(
      BOOKING_MOVE_TOOL,
      `Propose moving one of the person’s bookings to a new time. Read the schedule first for the booking id. ${note}`,
      proposeBookingMoveSchema,
    ),
    toolDef(
      BOOKING_CANCEL_TOOL,
      `Propose cancelling one of the person’s bookings. Read the schedule first for the booking id. ${note}`,
      proposeBookingCancelSchema,
    ),
  ]
}

export function isLabReadTool(name: string): boolean {
  return (LAB_READ_TOOL_NAMES as readonly string[]).includes(name)
}

export function isBookingProposalTool(
  name: string,
): name is BookingProposeToolName {
  return (BOOKING_PROPOSE_TOOL_NAMES as readonly string[]).includes(name)
}

// ---------------------------------------------------------------------------
// Shared lookups.
// ---------------------------------------------------------------------------

export interface InstrumentRow {
  id: string
  display_id: string | null
  name: string
  location: string | null
  instrument_type: string
  retired_at: string | null
  out_of_service_at: string | null
}

const INSTRUMENT_COLUMNS =
  'id,display_id,name,location,instrument_type,retired_at,out_of_service_at'

/** PostgREST `ilike` value: `*` wildcards; reserved characters stripped. */
export function likeValue(text: string): string {
  const clean = text.replaceAll(/[*,()"\\]/g, ' ').trim()
  return encodeURIComponent(`*${clean.replaceAll(/\s+/g, '*')}*`)
}

export function instrumentLabel(row: InstrumentRow): string {
  return row.display_id ? `${row.name} (${row.display_id})` : row.name
}

type InstrumentMatch =
  { ok: true; instrument: InstrumentRow } | { ok: false; message: string }

/** The one instrument a person means by a name or INS number. */
export async function resolveInstrument(
  client: DataClient,
  workspaceId: string,
  name: string,
): Promise<InstrumentMatch> {
  const ws = encodeURIComponent(workspaceId)
  const wanted = name.trim()
  const all = await client.list<InstrumentRow>(
    'instruments',
    `?workspace_id=eq.${ws}&retired_at=is.null&select=${INSTRUMENT_COLUMNS}&order=position.asc,name.asc&limit=500`,
  )
  const lower = wanted.toLowerCase()
  const exact = all.filter(
    (row) =>
      row.name.toLowerCase() === lower ||
      row.display_id?.toLowerCase() === lower ||
      row.id === wanted,
  )
  if (exact.length === 1) return { ok: true, instrument: exact[0] }
  const words = lower.split(/\s+/).filter(Boolean)
  const partial = all.filter((row) => {
    const hay = `${row.name} ${row.display_id ?? ''} ${row.location ?? ''}`
      .toLowerCase()
      .trim()
    return words.every((word) => hay.includes(word))
  })
  if (partial.length === 1) return { ok: true, instrument: partial[0] }
  if (partial.length > 1) {
    return {
      ok: false,
      message: `More than one instrument matches "${wanted}": ${partial
        .slice(0, 8)
        .map(instrumentLabel)
        .join(
          ', ',
        )}. Ask the person which one they mean, naming these, or pick the one that clearly fits.`,
    }
  }
  return {
    ok: false,
    message: `No instrument matches "${wanted}". The bookable instruments are: ${
      all.length > 0
        ? all.slice(0, 20).map(instrumentLabel).join(', ')
        : 'none yet'
    }.`,
  }
}

/** Today's date on the person's clock, plus `days` more. */
function dayList(from: string, count: number, weekends = true): string[] {
  const out: string[] = []
  const [y, m, d] = from.split('-').map(Number) as [number, number, number]
  let cursor = Date.UTC(y, m - 1, d)
  // Look far enough ahead to fill `count` working days when weekends are skipped.
  for (let guard = 0; out.length < count && guard < count * 3; guard++) {
    const date = new Date(cursor)
    const weekday = date.getUTCDay()
    if (weekends || (weekday !== 0 && weekday !== 6)) {
      out.push(date.toISOString().slice(0, 10))
    }
    cursor += 86_400_000
  }
  return out
}

function today(timeZone: string, now: Date): string {
  return localFromInstant(now, timeZone).slice(0, 10)
}

export async function memberNames(
  client: DataClient,
): Promise<Map<string, string>> {
  try {
    const members = await client.rpc<Array<{ user_id: string; name: string }>>(
      'workspace_members_list',
      {},
    )
    return new Map(members.map((member) => [member.user_id, member.name]))
  } catch {
    return new Map()
  }
}

export async function bookingsBetween(
  client: DataClient,
  workspaceId: string,
  start: Date,
  end: Date,
  resourceId?: string,
): Promise<CalendarBookingWire[]> {
  const params = [
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    `cancelled_at=is.null`,
    `status=neq.cancelled`,
    `starts_at=lt.${encodeURIComponent(end.toISOString())}`,
    `ends_at=gt.${encodeURIComponent(start.toISOString())}`,
    `order=starts_at.asc`,
    `limit=500`,
  ]
  if (resourceId)
    params.push(`resource_id=eq.${encodeURIComponent(resourceId)}`)
  return client.list<CalendarBookingWire>(
    'calendar_bookings',
    `?${params.join('&')}`,
  )
}

// ---------------------------------------------------------------------------
// Read tools.
// ---------------------------------------------------------------------------

export interface LabToolContext {
  client: DataClient
  workspaceId: string
  userId: string
  timeZone: string
  now?: Date
}

export function invalid(error: z.ZodError): string {
  return `The arguments were not valid: ${error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'} ${issue.message}`)
    .join('; ')}`
}

export async function runLabReadTool(
  name: string,
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  try {
    switch (name) {
      case SCHEDULE_TOOL: {
        const parsed = scheduleReadSchema.safeParse(args)
        if (!parsed.success)
          return { text: invalid(parsed.error), isError: true }
        return {
          text: await readSchedule(parsed.data, context),
          isError: false,
        }
      }
      case FREE_TIME_TOOL: {
        const parsed = freeTimeSchema.safeParse(args)
        if (!parsed.success)
          return { text: invalid(parsed.error), isError: true }
        return {
          text: await readFreeTime(parsed.data, context),
          isError: false,
        }
      }
      case LAB_LIST_TOOL: {
        const parsed = labListSchema.safeParse(args)
        if (!parsed.success)
          return { text: invalid(parsed.error), isError: true }
        return { text: await listLabArea(parsed.data, context), isError: false }
      }
      default:
        return { text: 'That tool is not available.', isError: true }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return {
      text: message.startsWith('No instrument')
        ? message
        : 'The lookup failed.',
      isError: true,
    }
  }
}

async function readSchedule(
  input: z.infer<typeof scheduleReadSchema>,
  context: LabToolContext,
): Promise<string> {
  const { client, workspaceId, timeZone } = context
  const now = context.now ?? new Date()
  const from = input.from ?? today(timeZone, now)
  const days = input.days ?? 7
  const start = instantFromLocal(`${from}T00:00`, timeZone)
  const lastDay = dayList(from, days).at(-1) ?? from
  const end = new Date(
    instantFromLocal(`${lastDay}T00:00`, timeZone).getTime() + 86_400_000,
  )

  let instrument: InstrumentRow | undefined
  if (input.instrument) {
    const match = await resolveInstrument(client, workspaceId, input.instrument)
    if (!match.ok) return match.message
    instrument = match.instrument
  }
  const [rows, instruments, names] = await Promise.all([
    bookingsBetween(client, workspaceId, start, end, instrument?.id),
    client.list<InstrumentRow>(
      'instruments',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=${INSTRUMENT_COLUMNS}&limit=500`,
    ),
    memberNames(client),
  ])
  const byId = new Map(instruments.map((row) => [row.id, row] as const))
  const bookings = rows
    .filter((row) => !input.mine || row.created_by_user_id === context.userId)
    .map((row) => {
      const on = byId.get(row.resource_id)
      return {
        bookingId: row.id,
        instrument: on ? instrumentLabel(on) : 'Another resource',
        title: row.title,
        when: describeSlot(
          new Date(row.starts_at),
          new Date(row.ends_at),
          timeZone,
        ),
        start: localFromInstant(new Date(row.starts_at), timeZone),
        end: localFromInstant(new Date(row.ends_at), timeZone),
        bookedBy:
          row.created_by_user_id === context.userId
            ? 'you'
            : (names.get(row.created_by_user_id ?? '') ?? 'someone else'),
        status: row.status,
        experiment: row.linked_experiment_identifier
          ? `${row.linked_experiment_identifier} ${row.linked_experiment_title ?? ''}`.trim()
          : null,
      }
    })
  return JSON.stringify({
    timeZone,
    range: `${from} for ${days} day${days === 1 ? '' : 's'}`,
    instrument: instrument ? instrumentLabel(instrument) : 'all',
    bookings,
    bookingCount: bookings.length,
    schedulePage: '/schedule',
  })
}

async function readFreeTime(
  input: z.infer<typeof freeTimeSchema>,
  context: LabToolContext,
): Promise<string> {
  const { client, workspaceId, timeZone } = context
  const now = context.now ?? new Date()
  const match = await resolveInstrument(client, workspaceId, input.instrument)
  if (!match.ok) return match.message
  const instrument = match.instrument
  const minutes = input.durationMinutes ?? 60
  const from = input.from ?? today(timeZone, now)
  const days = dayList(from, input.days ?? 5, input.weekends === true)
  const start = instantFromLocal(`${days[0] ?? from}T00:00`, timeZone)
  const end = new Date(
    instantFromLocal(`${days.at(-1) ?? from}T00:00`, timeZone).getTime() +
      86_400_000,
  )

  const id = encodeURIComponent(instrument.id)
  const [rows, rules, gaps] = await Promise.all([
    bookingsBetween(client, workspaceId, start, end, instrument.id),
    client.list<{
      max_booking_minutes: number | null
      max_advance_days: number | null
    }>(
      'instrument_booking_rules',
      `?instrument_id=eq.${id}&select=max_booking_minutes,max_advance_days`,
    ),
    client
      .rpc<Array<{ identifier: string; title: string }>>(
        'my_instrument_training_gaps',
        { p_instrument_id: instrument.id },
      )
      .catch(() => []),
  ])
  const rule = rules.at(0)
  const free = findFreeGaps({
    busy: rows.map((row) => ({
      start: new Date(row.starts_at),
      end: new Date(row.ends_at),
    })),
    days,
    dayStart: input.dayStart ?? '08:00',
    dayEnd: input.dayEnd ?? '18:00',
    minutes: minutes,
    timeZone,
    now,
  }).filter(
    (gap) =>
      !rule?.max_advance_days ||
      gap.start.getTime() <= now.getTime() + rule.max_advance_days * 86_400_000,
  )

  const blockers: string[] = []
  if (instrument.out_of_service_at) {
    blockers.push(
      'It is out of service, so it cannot be booked until it is back.',
    )
  }
  if (gaps.length > 0) {
    blockers.push(
      `The person needs training first: ${gaps
        .map((gap) => `${gap.identifier} ${gap.title}`)
        .join(', ')}.`,
    )
  }
  if (rule?.max_booking_minutes && minutes > rule.max_booking_minutes) {
    blockers.push(
      `It can be booked for at most ${describeMinutes(rule.max_booking_minutes)} at a time.`,
    )
  }
  return JSON.stringify({
    instrument: instrumentLabel(instrument),
    timeZone,
    lookingFor: describeMinutes(minutes),
    free: free.map((gap) => ({
      when: describeSlot(gap.start, gap.end, timeZone),
      from: localFromInstant(gap.start, timeZone),
      until: localFromInstant(gap.end, timeZone),
    })),
    rules: {
      longestBooking: rule?.max_booking_minutes
        ? describeMinutes(rule.max_booking_minutes)
        : null,
      furthestAhead: rule?.max_advance_days
        ? `${rule.max_advance_days} days`
        : null,
    },
    cannotBookBecause: blockers,
  })
}

// ---------------------------------------------------------------------------
// Lab lists.
// ---------------------------------------------------------------------------

const CLOSED: Partial<Record<LabArea, string>> = {
  shipments: 'status=not.in.(received,cancelled)',
  reagent_orders: 'status=not.in.(received,cancelled)',
  stocktakes: 'status=eq.open',
  legal_holds: 'released_at=is.null',
  recurring_work: 'status=eq.active',
  sample_workflows: 'status=eq.active',
}

interface PlainArea {
  table: string
  select: string
  order: string
  search: string[]
  page: string
}

const PLAIN_AREAS: Partial<Record<LabArea, PlainArea>> = {
  instruments: {
    table: 'instruments',
    select: INSTRUMENT_COLUMNS,
    order: 'position.asc,name.asc',
    search: ['name', 'display_id', 'location'],
    page: '/instruments',
  },
  shipments: {
    table: 'shipments',
    select:
      'id,number,direction,status,counterparty,carrier,tracking_reference,shipped_on,expected_on,received_at,notes',
    order: 'number.desc',
    search: ['counterparty', 'carrier', 'tracking_reference', 'notes'],
    page: '/shipments',
  },
  sample_workflows: {
    table: 'sample_workflows',
    select: 'id,name,description,sample_type,auto_enrol,status',
    order: 'name.asc',
    search: ['name', 'description'],
    page: '/settings/lab/workflows',
  },
  spec_limits: {
    table: 'field_spec_limits',
    select:
      'id,kind,field_name,lower_limit,upper_limit,alert_lower,alert_upper,note',
    order: 'kind.asc,field_name.asc',
    search: ['kind', 'field_name', 'note'],
    page: '/models',
  },
  reagent_orders: {
    table: 'reagent_orders',
    select:
      'id,number,material_title,supplier,catalog_no,quantity,unit,status,expected_on,note',
    order: 'number.desc',
    search: ['material_title', 'supplier', 'catalog_no', 'note'],
    page: '/materials',
  },
  recurring_work: {
    table: 'recurring_schedules',
    select: 'id,kind,title,status,frequency,interval_count,starts_on,ends_on',
    order: 'title.asc',
    search: ['title'],
    page: '/schedule',
  },
  stocktakes: {
    table: 'stocktakes',
    select:
      'id,number,scope_name,scope_path,status,started_at,completed_at,note',
    order: 'number.desc',
    search: ['scope_name', 'scope_path', 'note'],
    page: '/stocktake',
  },
  instrument_service: {
    table: 'instrument_service_log',
    select: 'id,instrument_id,kind,visited_on,summary,details,performed_by',
    order: 'visited_on.desc',
    search: ['summary', 'details', 'performed_by'],
    page: '/instruments',
  },
  label_templates: {
    table: 'label_templates',
    select: 'id,name,record_kind',
    order: 'name.asc',
    search: ['name', 'record_kind'],
    page: '/settings/lab/labels',
  },
  legal_holds: {
    table: 'legal_holds',
    select: 'id,name,reason,kind,created_at,released_at,release_note',
    order: 'created_at.desc',
    search: ['name', 'reason'],
    page: '/settings/lab/retention',
  },
  retention_rules: {
    table: 'retention_rules',
    select: 'id,kind,keep_months,note',
    order: 'kind.asc',
    search: ['kind', 'note'],
    page: '/settings/lab/retention',
  },
}

/** Areas made of records: which models count, and where the page is. */
async function recordKinds(
  area: LabArea,
  client: DataClient,
): Promise<{ kinds: string[]; page: string } | null> {
  switch (area) {
    case 'requests': {
      const rows = await client.list<{ model_key: string }>(
        'request_forms',
        '?select=model_key',
      )
      return { kinds: rows.map((row) => row.model_key), page: '/requests' }
    }
    case 'incidents': {
      const rows = await client.list<{ model_key: string }>(
        'model_incident_logs',
        '?select=model_key',
      )
      return { kinds: rows.map((row) => row.model_key), page: '/incidents' }
    }
    case 'registry': {
      const rows = await client.list<{ key: string }>(
        'record_models',
        '?is_registry=eq.true&select=key',
      )
      return { kinds: rows.map((row) => row.key), page: '/registry' }
    }
    default:
      return null
  }
}

const OPEN_RECORD_STATUSES: Partial<Record<LabArea, string>> = {
  requests: 'status=in.(requested,accepted)',
  incidents: 'status=not.in.(closed,done,cancelled)',
  registry: 'archived_at=is.null',
}

async function listLabArea(
  input: z.infer<typeof labListSchema>,
  context: LabToolContext,
): Promise<string> {
  const { client } = context
  const limit = input.limit ?? 20
  const records = await recordKinds(input.area, client)
  if (records) {
    if (records.kinds.length === 0) {
      return JSON.stringify({
        area: input.area,
        items: [],
        note: `This lab has not set up ${input.area} yet. It is set up from Settings > Lab setup.`,
        page: records.page,
      })
    }
    const params = [
      `kind=in.(${records.kinds.map(encodeURIComponent).join(',')})`,
      'deleted_at=is.null',
      'select=id,identifier,title,kind,status,created_at,custom_fields',
      'order=created_at.desc',
      `limit=${limit}`,
    ]
    if (input.query) {
      const like = likeValue(input.query)
      params.push(`or=(title.ilike.${like},identifier.ilike.${like})`)
    }
    const open = OPEN_RECORD_STATUSES[input.area]
    if (input.openOnly && open) params.push(open)
    const rows = await client.list<Record<string, unknown>>(
      'records',
      `?${params.join('&')}`,
    )
    return JSON.stringify({
      area: input.area,
      items: rows,
      returned: rows.length,
      page: records.page,
      note: 'Each item is a record: read more with the record tools, or open it.',
    })
  }

  const spec = PLAIN_AREAS[input.area]
  if (!spec) return JSON.stringify({ area: input.area, items: [] })
  const params = [
    `select=${spec.select}`,
    `order=${spec.order}`,
    `limit=${limit}`,
  ]
  if (input.query) {
    const like = likeValue(input.query)
    params.push(
      `or=(${spec.search.map((column) => `${column}.ilike.${like}`).join(',')})`,
    )
  }
  const closed = CLOSED[input.area]
  if (input.openOnly && closed) params.push(closed)
  if (input.area === 'instruments' && input.openOnly) {
    params.push('retired_at=is.null')
  }
  const rows = await client.list<Record<string, unknown>>(
    spec.table,
    `?${params.join('&')}`,
  )
  return JSON.stringify({
    area: input.area,
    items: rows,
    returned: rows.length,
    page: spec.page,
  })
}

// ---------------------------------------------------------------------------
// Booking proposals.
// ---------------------------------------------------------------------------

export type BookingProposalOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

export async function findExperiment(
  client: DataClient,
  text: string,
): Promise<{ id: string; identifier: string; title: string } | string> {
  const like = likeValue(text)
  const rows = await client.list<{
    id: string
    identifier: string
    title: string
  }>(
    'records',
    `?kind=eq.experiment&deleted_at=is.null&or=(identifier.ilike.${like},title.ilike.${like})&select=id,identifier,title&order=updated_at.desc&limit=5`,
  )
  const exact = rows.find(
    (row) => row.identifier.toLowerCase() === text.trim().toLowerCase(),
  )
  if (exact) return exact
  if (rows.length === 1) return rows[0]
  if (rows.length === 0) return `No experiment matches "${text}".`
  return `More than one experiment matches "${text}": ${rows
    .map((row) => `${row.identifier} ${row.title}`)
    .join(', ')}. Ask which one.`
}

async function ownBooking(
  client: DataClient,
  bookingId: string,
): Promise<CalendarBookingWire | null> {
  const rows = await client.list<CalendarBookingWire>(
    'calendar_bookings',
    `?id=eq.${encodeURIComponent(bookingId)}&limit=1`,
  )
  return rows[0] ?? null
}

export async function buildBookingProposal(
  name: BookingProposeToolName,
  args: unknown,
  context: LabToolContext,
): Promise<BookingProposalOutcome> {
  const { client, workspaceId, timeZone } = context
  const now = context.now ?? new Date()
  switch (name) {
    case BOOKING_CREATE_TOOL: {
      const parsed = proposeBookingCreateSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const match = await resolveInstrument(
        client,
        workspaceId,
        input.instrument,
      )
      if (!match.ok) return match
      const instrument = match.instrument
      if (instrument.out_of_service_at) {
        return {
          ok: false,
          message: `${instrumentLabel(instrument)} is out of service, so it cannot be booked until it is back. Tell the person.`,
        }
      }
      const startsAt = instantFromLocal(input.start, timeZone)
      const endsAt = input.end
        ? instantFromLocal(input.end, timeZone)
        : new Date(startsAt.getTime() + (input.durationMinutes ?? 60) * 60_000)
      if (endsAt.getTime() <= startsAt.getTime()) {
        return { ok: false, message: 'The end must be after the start.' }
      }
      if (startsAt.getTime() < now.getTime() - 5 * 60_000) {
        return { ok: false, message: 'That time has already passed.' }
      }
      const id = encodeURIComponent(instrument.id)
      const [clashes, rules, training] = await Promise.all([
        bookingsBetween(client, workspaceId, startsAt, endsAt, instrument.id),
        client.list<{
          max_booking_minutes: number | null
          max_advance_days: number | null
        }>(
          'instrument_booking_rules',
          `?instrument_id=eq.${id}&select=max_booking_minutes,max_advance_days`,
        ),
        client
          .rpc<Array<{ identifier: string; title: string }>>(
            'my_instrument_training_gaps',
            { p_instrument_id: instrument.id },
          )
          .catch(() => []),
      ])
      const clash = clashes.at(0)
      if (clash) {
        return {
          ok: false,
          message: `${instrumentLabel(instrument)} is already booked then (${clash.title}, ${describeSlot(new Date(clash.starts_at), new Date(clash.ends_at), timeZone)}). Find free time and suggest another slot.`,
        }
      }
      if (training.length > 0) {
        return {
          ok: false,
          message: `The person needs training before booking ${instrumentLabel(instrument)}: ${training
            .map((gap) => `${gap.identifier} ${gap.title}`)
            .join(', ')}. Tell them.`,
        }
      }
      const rule = rules.at(0)
      const minutes = (endsAt.getTime() - startsAt.getTime()) / 60_000
      if (rule?.max_booking_minutes && minutes > rule.max_booking_minutes) {
        return {
          ok: false,
          message: `${instrumentLabel(instrument)} can be booked for at most ${describeMinutes(rule.max_booking_minutes)} at a time.`,
        }
      }
      if (
        rule?.max_advance_days &&
        startsAt.getTime() > now.getTime() + rule.max_advance_days * 86_400_000
      ) {
        return {
          ok: false,
          message: `${instrumentLabel(instrument)} can be booked at most ${rule.max_advance_days} days ahead.`,
        }
      }
      let experiment: { id: string; identifier: string; title: string } | null =
        null
      if (input.experiment) {
        const found = await findExperiment(client, input.experiment)
        if (typeof found === 'string') return { ok: false, message: found }
        experiment = found
      }
      const bookingTitle =
        input.bookingTitle ??
        (experiment
          ? `${experiment.identifier} ${experiment.title}`
          : input.title)
      const changes = [
        {
          label: 'When',
          before: null,
          after: describeSlot(startsAt, endsAt, timeZone),
        },
        { label: 'Booking', before: null, after: bookingTitle },
      ]
      if (experiment) {
        changes.push({
          label: 'For',
          before: null,
          after: `${experiment.identifier} · ${experiment.title}`,
        })
      }
      if (input.notes) {
        changes.push({ label: 'Notes', before: null, after: input.notes })
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: instrumentLabel(instrument),
          deepLink: '/schedule',
          changes,
          action: {
            kind: 'booking.create',
            workspaceId,
            instrumentId: instrument.id,
            title: bookingTitle,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            timezone: timeZone,
            notes: input.notes ?? null,
            linkedExperimentRecordId: experiment?.id ?? null,
          },
        },
      }
    }
    case BOOKING_MOVE_TOOL:
    case BOOKING_CANCEL_TOOL: {
      const parsed =
        name === BOOKING_MOVE_TOOL
          ? proposeBookingMoveSchema.safeParse(args)
          : proposeBookingCancelSchema.safeParse(args)
      if (!parsed.success) return { ok: false, message: invalid(parsed.error) }
      const input = parsed.data
      const booking = await ownBooking(client, input.bookingId)
      if (!booking || booking.status === 'cancelled') {
        return {
          ok: false,
          message:
            'That booking was not found. Read the schedule again for its id.',
        }
      }
      if (booking.created_by_user_id !== context.userId) {
        return {
          ok: false,
          message:
            'That booking is someone else’s. Only the person who made it can change it; suggest they ask them.',
        }
      }
      const instruments = await client.list<InstrumentRow>(
        'instruments',
        `?id=eq.${encodeURIComponent(booking.resource_id)}&select=${INSTRUMENT_COLUMNS}`,
      )
      const label = instruments[0]
        ? instrumentLabel(instruments[0])
        : booking.title
      const was = describeSlot(
        new Date(booking.starts_at),
        new Date(booking.ends_at),
        timeZone,
      )
      if (name === BOOKING_CANCEL_TOOL) {
        return {
          ok: true,
          proposal: {
            tool: name,
            title: input.title,
            summary: input.summary,
            target: label,
            deepLink: instruments[0]
              ? `/instruments/${instruments[0].id}`
              : '/schedule',
            changes: [
              { label: booking.title, before: was, after: 'Cancelled' },
            ],
            action: {
              kind: 'booking.cancel',
              bookingId: booking.id,
              expectedMetadataVersion: booking.metadata_version,
            },
          },
        }
      }
      const move = input as z.infer<typeof proposeBookingMoveSchema>
      const startsAt = instantFromLocal(move.start, timeZone)
      const length =
        new Date(booking.ends_at).getTime() -
        new Date(booking.starts_at).getTime()
      const endsAt = move.end
        ? instantFromLocal(move.end, timeZone)
        : new Date(startsAt.getTime() + length)
      if (endsAt.getTime() <= startsAt.getTime()) {
        return { ok: false, message: 'The end must be after the start.' }
      }
      const clash = (
        await bookingsBetween(
          client,
          workspaceId,
          startsAt,
          endsAt,
          booking.resource_id,
        )
      ).find((row) => row.id !== booking.id)
      if (clash) {
        return {
          ok: false,
          message: `${label} is already booked then (${clash.title}, ${describeSlot(new Date(clash.starts_at), new Date(clash.ends_at), timeZone)}). Find free time and suggest another slot.`,
        }
      }
      return {
        ok: true,
        proposal: {
          tool: name,
          title: input.title,
          summary: input.summary,
          target: label,
          deepLink: '/schedule',
          changes: [
            {
              label: booking.title,
              before: was,
              after: describeSlot(startsAt, endsAt, timeZone),
            },
          ],
          action: {
            kind: 'booking.move',
            bookingId: booking.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            expectedMetadataVersion: booking.metadata_version,
          },
        },
      }
    }
  }
}
