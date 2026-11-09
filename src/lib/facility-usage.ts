/**
 * Instrument usage and recharge (migration 0100).
 *
 * A booking is the record of who had an instrument, for what and for how long.
 * Usage adds those bookings up: hours booked against the hours an instrument
 * is open, and what each person or project owes at the instrument's hourly
 * rate. The lines come from `api.report_usage_lines`, already clipped to the
 * period; everything here is arithmetic on them, so the screen and the emailed
 * report agree.
 */
import type { DataClient } from '#/lib/data-client'
import { csvEscape } from '#/lib/export/delimited'
import { addMoney, weekdaysIn } from '#/lib/report-period'
import type { DateRange, MoneyTotals } from '#/lib/report-period'

export const usageKeys = {
  all: ['facility-usage'] as const,
  lines: (workspaceId: string, from: string, to: string) =>
    ['facility-usage', 'lines', workspaceId, from, to] as const,
  rates: ['facility-usage', 'rates'] as const,
}

interface UsageLineWire {
  booking_id: string
  instrument_id: string
  instrument_name: string
  instrument_display_id: string | null
  user_id: string | null
  project_id: string | null
  project_title: string | null
  title: string
  starts_at: string
  ends_at: string
  hours: string | number
  rate_per_hour: string | number | null
  currency: string | null
}

export interface UsageLine {
  bookingId: string
  instrumentId: string
  instrumentName: string
  instrumentCode: string | null
  userId: string | null
  projectId: string | null
  projectTitle: string | null
  title: string
  startsAt: string
  endsAt: string
  hours: number
  ratePerHour: number | null
  currency: string | null
}

export function toUsageLine(row: UsageLineWire): UsageLine {
  return {
    bookingId: row.booking_id,
    instrumentId: row.instrument_id,
    instrumentName: row.instrument_name,
    instrumentCode: row.instrument_display_id,
    userId: row.user_id,
    projectId: row.project_id,
    projectTitle: row.project_title,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    hours: Number(row.hours),
    ratePerHour: row.rate_per_hour === null ? null : Number(row.rate_per_hour),
    currency: row.currency,
  }
}

export async function fetchUsageLines(
  client: DataClient,
  workspaceId: string,
  range: DateRange,
): Promise<UsageLine[]> {
  const rows = await client.rpc<UsageLineWire[]>('report_usage_lines', {
    p_workspace_id: workspaceId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  })

  return rows.map(toUsageLine)
}

/** What a booking is charged at its instrument's rate, or null with no rate. */
export function lineCharge(line: UsageLine): number | null {
  if (line.ratePerHour === null || !line.currency) return null

  return Math.round(line.hours * line.ratePerHour * 100) / 100
}

export interface UsageGroup {
  key: string
  /** The instrument, person or project the row is about. */
  id: string | null
  bookings: number
  hours: number
  /** What was charged, per currency. Empty when nothing carries a rate. */
  charges: MoneyTotals
}

export type UsageGrouping = 'instrument' | 'person' | 'project'

const NONE = '__none__'

function groupKey(line: UsageLine, by: UsageGrouping): string {
  if (by === 'instrument') return line.instrumentId

  if (by === 'person') return line.userId ?? NONE

  return line.projectId ?? NONE
}

/** One row per instrument, person or project, most hours first. */
export function groupUsage(
  lines: readonly UsageLine[],
  by: UsageGrouping,
): UsageGroup[] {
  const groups = new Map<string, UsageGroup>()

  for (const line of lines) {
    const key = groupKey(line, by)
    let group = groups.get(key)

    if (!group) {
      group = {
        key,
        id: key === NONE ? null : key,
        bookings: 0,
        hours: 0,
        charges: {},
      }
      groups.set(key, group)
    }

    group.bookings += 1
    group.hours = Math.round((group.hours + line.hours) * 100) / 100
    const charge = lineCharge(line)

    if (charge !== null && line.currency) {
      addMoney(group.charges, charge, line.currency)
    }
  }

  return [...groups.values()].sort((a, b) => b.hours - a.hours)
}

export interface InstrumentUtilisation extends UsageGroup {
  name: string
  code: string | null
  /** Hours the instrument was open in the period. */
  openHours: number
  /** Booked share of the open hours, 0 to 1 (can pass 1 when booked out of hours). */
  utilisation: number
  people: number
}

/**
 * Booked hours against open hours for every instrument that was booked. An
 * instrument is open `openHoursPerDay` hours on each weekday of the period, so
 * 10 hours a day over a 5-day week is 50 hours.
 */
export function utilisationByInstrument(
  lines: readonly UsageLine[],
  range: DateRange,
  openHoursPerDay: number,
  timeZone: string,
): InstrumentUtilisation[] {
  const open = weekdaysIn(range, timeZone) * openHoursPerDay
  const people = new Map<string, Set<string>>()
  const names = new Map<string, { name: string; code: string | null }>()

  for (const line of lines) {
    names.set(line.instrumentId, {
      name: line.instrumentName,
      code: line.instrumentCode,
    })

    if (line.userId) {
      const set = people.get(line.instrumentId) ?? new Set<string>()
      set.add(line.userId)
      people.set(line.instrumentId, set)
    }
  }

  return groupUsage(lines, 'instrument').map((group) => {
    const info = names.get(group.key)

    return {
      ...group,
      name: info?.name ?? '',
      code: info?.code ?? null,
      openHours: open,
      utilisation: open > 0 ? group.hours / open : 0,
      people: people.get(group.key)?.size ?? 0,
    }
  })
}

export interface UsageLabels {
  person: (userId: string | null) => string
  project: (line: UsageLine) => string
}

const LINE_HEADER = [
  'Booking',
  'Instrument',
  'Instrument ID',
  'Person',
  'Project',
  'Starts',
  'Ends',
  'Hours',
  'Rate per hour',
  'Currency',
  'Charge',
]

function csv(rows: readonly (readonly string[])[]): string {
  return (
    rows
      .map((row) => row.map((cell) => csvEscape(cell, ',')).join(','))
      .join('\r\n') + '\r\n'
  )
}

function money(value: number | null): string {
  return value === null ? '' : value.toFixed(2)
}

/** Every booking in the period, one row each, for a finance office to check. */
export function bookingsCsv(
  lines: readonly UsageLine[],
  labels: UsageLabels,
): string {
  return csv([
    LINE_HEADER,
    ...lines.map((line) => [
      line.title,
      line.instrumentName,
      line.instrumentCode ?? '',
      labels.person(line.userId),
      labels.project(line),
      line.startsAt,
      line.endsAt,
      String(line.hours),
      money(line.ratePerHour),
      line.currency ?? '',
      money(lineCharge(line)),
    ]),
  ])
}

/**
 * The recharge: who owes what for which instrument. Each row is one person or
 * project on one instrument, with the hours, the rate and the charge, ready to
 * pass to whoever raises the invoices.
 */
export function rechargeCsv(
  lines: readonly UsageLine[],
  by: 'person' | 'project',
  labels: UsageLabels,
): string {
  const rows = new Map<
    string,
    {
      who: string
      line: UsageLine
      bookings: number
      hours: number
      charge: number | null
    }
  >()

  for (const line of lines) {
    const who =
      by === 'person' ? labels.person(line.userId) : labels.project(line)

    const key = `${who}\u0000${line.instrumentId}`

    const entry = rows.get(key) ?? {
      who,
      line,
      bookings: 0,
      hours: 0,
      charge: null,
    }

    entry.bookings += 1
    entry.hours = Math.round((entry.hours + line.hours) * 100) / 100
    const charge = lineCharge(line)

    if (charge !== null) entry.charge = (entry.charge ?? 0) + charge
    rows.set(key, entry)
  }

  const sorted = [...rows.values()].sort(
    (a, b) =>
      a.who.localeCompare(b.who) ||
      a.line.instrumentName.localeCompare(b.line.instrumentName),
  )

  return csv([
    [
      by === 'person' ? 'Person' : 'Project',
      'Instrument',
      'Instrument ID',
      'Bookings',
      'Hours',
      'Rate per hour',
      'Currency',
      'Charge',
    ],
    ...sorted.map((r) => [
      r.who,
      r.line.instrumentName,
      r.line.instrumentCode ?? '',
      String(r.bookings),
      String(r.hours),
      money(r.line.ratePerHour),
      r.line.currency ?? '',
      money(r.charge === null ? null : Math.round(r.charge * 100) / 100),
    ]),
  ])
}

// Rates -----------------------------------------------------------------------

export interface InstrumentRate {
  instrumentId: string
  ratePerHour: number
  currency: string
}

interface RateWire {
  instrument_id: string
  rate_per_hour: string | number
  currency: string
}

export async function fetchInstrumentRates(
  client: DataClient,
): Promise<InstrumentRate[]> {
  const rows = await client.list<RateWire>('instrument_rates', '?limit=1000')

  return rows.map((row) => ({
    instrumentId: row.instrument_id,
    ratePerHour: Number(row.rate_per_hour),
    currency: row.currency,
  }))
}

export function setInstrumentRate(
  client: DataClient,
  input: {
    instrumentId: string
    ratePerHour: number | null
    currency: string | null
  },
): Promise<void> {
  return client.rpc('set_instrument_rate', {
    p_instrument_id: input.instrumentId,
    p_rate_per_hour: input.ratePerHour,
    p_currency: input.currency,
  })
}
