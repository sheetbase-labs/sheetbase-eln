/**
 * Scheduled reports (migration 0100): a report that is emailed to chosen people
 * on a daily, weekly or monthly rhythm. The schedule lives in the database; the
 * email worker builds each report when it falls due (see
 * `scheduled-reports.server.ts`) and queues one email per person, with the
 * detail attached as a CSV file.
 *
 * Reads go straight to `api.scheduled_reports` under row-level security;
 * every change goes through an RPC.
 */
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'
import { SCHEDULED_PERIODS } from '#/lib/report-period'
import type { ScheduledPeriod } from '#/lib/report-period'

export const REPORT_KINDS = [
  'instrument_usage',
  'spend',
  'project_status',
] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const
export type Frequency = (typeof FREQUENCIES)[number]

export const scheduledReportKeys = {
  all: ['scheduled-reports'] as const,
}

interface ScheduledReportWire {
  id: string
  name: string
  kind: string
  project_id: string | null
  period: string
  open_hours: string | number
  frequency: string
  weekday: number
  month_day: number
  send_hour: number
  time_zone: string
  recipient_user_ids: string[]
  active: boolean
  next_run_at: string
  last_run_at: string | null
  last_result: string | null
  last_recipient_count: number | null
  created_by_user_id: string
}

export interface ScheduledReport {
  id: string
  name: string
  kind: ReportKind
  projectId: string | null
  period: ScheduledPeriod
  openHours: number
  frequency: Frequency
  /** 0 is Sunday. */
  weekday: number
  /** 1 to 28. */
  monthDay: number
  /** 0 to 23, read in `timeZone`. */
  sendHour: number
  timeZone: string
  recipientUserIds: string[]
  active: boolean
  nextRunAt: string
  lastRunAt: string | null
  lastResult: string | null
  lastRecipientCount: number | null
  createdBy: string
}

function asKind(value: string): ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value)
    ? (value as ReportKind)
    : 'spend'
}

function asFrequency(value: string): Frequency {
  return (FREQUENCIES as readonly string[]).includes(value)
    ? (value as Frequency)
    : 'weekly'
}

function asPeriod(value: string): ScheduledPeriod {
  return (SCHEDULED_PERIODS as readonly string[]).includes(value)
    ? (value as ScheduledPeriod)
    : 'previous_week'
}

export function toScheduledReport(row: ScheduledReportWire): ScheduledReport {
  return {
    id: row.id,
    name: row.name,
    kind: asKind(row.kind),
    projectId: row.project_id,
    period: asPeriod(row.period),
    openHours: Number(row.open_hours),
    frequency: asFrequency(row.frequency),
    weekday: row.weekday,
    monthDay: row.month_day,
    sendHour: row.send_hour,
    timeZone: row.time_zone,
    recipientUserIds: row.recipient_user_ids,
    active: row.active,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    lastRecipientCount: row.last_recipient_count,
    createdBy: row.created_by_user_id,
  }
}

export async function fetchScheduledReports(
  client: DataClient,
): Promise<ScheduledReport[]> {
  const rows = await client.list<ScheduledReportWire>(
    'scheduled_reports',
    '?order=name.asc&limit=500',
  )
  return rows.map(toScheduledReport)
}

export interface ScheduledReportInput {
  id: string | null
  name: string
  kind: ReportKind
  projectId: string | null
  period: ScheduledPeriod
  openHours: number
  frequency: Frequency
  weekday: number
  monthDay: number
  sendHour: number
  timeZone: string
  recipientUserIds: string[]
  active: boolean
}

export function saveScheduledReport(
  client: DataClient,
  input: ScheduledReportInput,
): Promise<ScheduledReportWire> {
  return client.rpc<ScheduledReportWire>('save_scheduled_report', {
    p_id: input.id,
    p_name: input.name,
    p_kind: input.kind,
    p_project_id: input.kind === 'instrument_usage' ? null : input.projectId,
    p_period: input.period,
    p_open_hours: input.openHours,
    p_frequency: input.frequency,
    p_weekday: input.weekday,
    p_month_day: input.monthDay,
    p_send_hour: input.sendHour,
    p_time_zone: input.timeZone,
    p_recipient_user_ids: input.recipientUserIds,
    p_active: input.active,
  })
}

export function setScheduledReportActive(
  client: DataClient,
  id: string,
  active: boolean,
): Promise<void> {
  return client.rpc('set_scheduled_report_active', {
    p_id: id,
    p_active: active,
  })
}

export function deleteScheduledReport(
  client: DataClient,
  id: string,
): Promise<void> {
  return client.rpc('delete_scheduled_report', { p_id: id })
}

export function sendScheduledReportNow(
  client: DataClient,
  id: string,
): Promise<void> {
  return client.rpc('send_scheduled_report_now', { p_id: id })
}

function clock(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** "Every Monday at 08:00", in words. */
export function describeSchedule(report: {
  frequency: Frequency
  weekday: number
  monthDay: number
  sendHour: number
}): string {
  const time = clock(report.sendHour)
  if (report.frequency === 'daily') {
    return t('spend.schedule.sendsDaily', { time })
  }
  if (report.frequency === 'weekly') {
    return t('spend.schedule.sendsWeekly', {
      weekday: t(
        `spend.schedule.weekdays.${String(report.weekday) as '0' | '1' | '2' | '3' | '4' | '5' | '6'}`,
      ),
      time,
    })
  }
  return t('spend.schedule.sendsMonthly', { day: report.monthDay, time })
}

export function hourOptions(): { value: number; label: string }[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    value: hour,
    label: clock(hour),
  }))
}
