/**
 * The body of a scheduled report email, and the files that go with it. Pure:
 * the email worker loads the lines, this turns them into text and CSV, so what
 * arrives in an inbox is the same arithmetic as the report on screen.
 */
import { t } from '#/copy'
import {
  bookingsCsv,
  lineCharge,
  rechargeCsv,
  utilisationByInstrument,
} from '#/lib/facility-usage'
import type { UsageLabels, UsageLine } from '#/lib/facility-usage'
import {
  projectStateLabel,
  projectStatusCsv,
} from '#/lib/project-status-report'
import type { ProjectStatusRow } from '#/lib/project-status-report'
import {
  formatHours,
  formatRange,
  formatShare,
  formatTotals,
} from '#/lib/report-period'
import type { DateRange } from '#/lib/report-period'
import { groupSpend, spendCsv, totalSpend } from '#/lib/spend-report'
import type { SpendLine } from '#/lib/spend-report'

export interface EmailAttachment {
  filename: string
  content: string
  contentType: string
}

export interface ReportEmail {
  subject: string
  body: string
  attachments: EmailAttachment[]
}

export type ReportData =
  | {
      kind: 'instrument_usage'
      lines: UsageLine[]
      labels: UsageLabels
      openHours: number
    }
  | { kind: 'spend'; lines: SpendLine[] }
  | { kind: 'project_status'; rows: ProjectStatusRow[] }

/** Past this many lines a section lists the leaders and says no more. */
const LIST_LIMIT = 10

function csvFile(
  name: string,
  content: string,
  range: DateRange,
): EmailAttachment {
  return {
    filename: `${name}-${range.from.toISOString().slice(0, 10)}.csv`,
    content,
    contentType: 'text/csv',
  }
}

function usageSection(
  data: Extract<ReportData, { kind: 'instrument_usage' }>,
  range: DateRange,
  zone: string,
): { text: string[]; files: EmailAttachment[] } {
  const { lines, labels, openHours } = data

  if (lines.length === 0) {
    return { text: [t('spend.schedule.email.noData')], files: [] }
  }

  const hours = lines.reduce((sum, l) => sum + l.hours, 0)
  const instruments = utilisationByInstrument(lines, range, openHours, zone)
  const charge: Record<string, number> = {}

  for (const line of lines) {
    const amount = lineCharge(line)

    if (amount !== null && line.currency) {
      charge[line.currency] = (charge[line.currency] ?? 0) + amount
    }
  }

  const text = [
    t('spend.schedule.email.usage.heading'),
    t('spend.schedule.email.usage.booked', {
      hours: formatHours(hours),
      bookings: lines.length,
    }),
    ...instruments.slice(0, LIST_LIMIT).map((row) =>
      t('spend.schedule.email.usage.instrument', {
        name: row.name,
        hours: formatHours(row.hours),
        used: formatShare(row.utilisation),
      }),
    ),
  ]

  const owed = formatTotals(charge)

  if (owed) text.push(t('spend.schedule.email.usage.charge', { amount: owed }))

  return {
    text,
    files: [
      csvFile('bookings', bookingsCsv(lines, labels), range),
      csvFile(
        'recharge-by-project',
        rechargeCsv(lines, 'project', labels),
        range,
      ),
      csvFile(
        'recharge-by-person',
        rechargeCsv(lines, 'person', labels),
        range,
      ),
    ],
  }
}

function spendSection(
  data: Extract<ReportData, { kind: 'spend' }>,
  range: DateRange,
  zone: string,
): { text: string[]; files: EmailAttachment[] } {
  const { lines } = data

  if (lines.length === 0) {
    return { text: [t('spend.schedule.email.noData')], files: [] }
  }

  const total = totalSpend(lines)

  const text = [
    t('spend.schedule.email.spend.heading'),
    t('spend.schedule.email.spend.spent', {
      amount: formatTotals(total.totals) || t('spend.summary.nothingSpent'),
    }),
    t('spend.schedule.email.spend.orders', { count: total.orders }),
  ]

  if (total.unpriced > 0) {
    text.push(
      t('spend.schedule.email.spend.unpriced', { count: total.unpriced }),
    )
  }

  for (const group of groupSpend(lines, 'project', zone).slice(0, LIST_LIMIT)) {
    const amount = formatTotals(group.totals)

    if (!amount) continue
    text.push(
      t('spend.schedule.email.spend.project', {
        name: group.label || t('spend.noProject'),
        amount,
      }),
    )
  }

  return {
    text,
    files: [
      csvFile(
        'spend',
        spendCsv(lines, {
          project: t('spend.noProject'),
          supplier: t('spend.noSupplier'),
        }),
        range,
      ),
    ],
  }
}

function statusSection(
  data: Extract<ReportData, { kind: 'project_status' }>,
  range: DateRange,
): { text: string[]; files: EmailAttachment[] } {
  if (data.rows.length === 0) {
    return { text: [t('spend.schedule.email.noData')], files: [] }
  }

  const text = [
    t('spend.schedule.email.status.heading'),
    ...data.rows.map((r) => {
      const line = t('spend.schedule.email.status.line', {
        name: r.title,
        status: projectStateLabel(r.status),
        running: r.running,
        review: r.inReview,
        overdue: r.late,
        done: r.finished,
        started: r.started,
      })

      return r.openOrders > 0
        ? `${line}; ${t('spend.schedule.email.status.openOrders', { count: r.openOrders })}`
        : line
    }),
  ]

  return {
    text,
    files: [csvFile('project-status', projectStatusCsv(data.rows), range)],
  }
}

/** Where in the app the report lives, to link from the email. */
export function reportPath(kind: ReportData['kind']): string {
  if (kind === 'instrument_usage') return '/instruments?tab=usage'

  if (kind === 'spend') return '/materials?tab=spend'

  return '/projects'
}

export function buildReportEmail(input: {
  name: string
  range: DateRange
  zone: string
  data: ReportData
  baseUrl: string
  sender: string
}): ReportEmail {
  const { name, range, zone, data, baseUrl, sender } = input
  const rangeLabel = formatRange(range, zone)

  const section =
    data.kind === 'instrument_usage'
      ? usageSection(data, range, zone)
      : data.kind === 'spend'
        ? spendSection(data, range, zone)
        : statusSection(data, range)

  const body = [
    t('spend.schedule.email.intro', { name, range: rangeLabel }),
    '',
    ...section.text,
    '',
    ...(section.files.length > 0 ? [t('spend.schedule.email.csvNote')] : []),
    t('spend.schedule.email.openIt', {
      link: `${baseUrl.replace(/\/$/, '')}${reportPath(data.kind)}`,
    }),
    '',
    t('spend.schedule.email.footer', { sender }),
  ].join('\n')

  return {
    subject: t('spend.schedule.email.subject', { name, range: rangeLabel }),
    body,
    attachments: section.files,
  }
}
