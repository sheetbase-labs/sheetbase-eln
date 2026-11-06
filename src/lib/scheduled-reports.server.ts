/**
 * The scheduled-report worker. Each pass of the email scheduler claims the
 * reports that have fallen due (or that someone asked to send now), builds
 * each one over its period, and queues one email per recipient with the detail
 * attached as CSV. The queue then delivers them like any other email, so a
 * report is never lost while email is not yet set up.
 *
 * The worker's database connection owns the data, so a report covers the whole
 * workspace (or the one project the schedule names). Only people who can run
 * the report may schedule it, and every recipient is a current member.
 */
import { logger } from '#/lib/logger'
import { toUsageLine } from '#/lib/facility-usage'
import { toProjectStatus } from '#/lib/project-status-report'
import { buildReportEmail } from '#/lib/report-email'
import type { ReportData } from '#/lib/report-email'
import { resolvePeriod } from '#/lib/report-period'
import type { ScheduledPeriod } from '#/lib/report-period'
import { toSpendLine } from '#/lib/spend-report'
import { t } from '#/copy'
import type { EmailQuery } from '#/lib/email-delivery.server'

interface ClaimedReport {
  id: string
  workspace_id: string
  name: string
  kind: 'instrument_usage' | 'spend' | 'project_status'
  project_id: string | null
  period: ScheduledPeriod
  open_hours: string | number
  time_zone: string
  recipient_user_ids: string[]
  created_by_user_id: string
}

export interface ReportRunResult {
  claimed: number
  queued: number
  failed: number
}

async function loadData(
  db: EmailQuery,
  report: ClaimedReport,
  range: { from: Date; to: Date },
  names: Map<string, string>,
): Promise<ReportData> {
  const from = range.from.toISOString()
  const to = range.to.toISOString()
  if (report.kind === 'instrument_usage') {
    const rows = await db.query<Parameters<typeof toUsageLine>[0]>(
      'SELECT * FROM api.report_usage_lines($1, $2, $3)',
      [report.workspace_id, from, to],
    )
    const lines = rows.rows.map(toUsageLine)
    const people = [...new Set(lines.map((l) => l.userId).filter(Boolean))]
    const missing = people.filter((id): id is string => !!id && !names.has(id))
    if (missing.length > 0) {
      const found = await db.query<{ id: string; name: string }>(
        'SELECT id, name FROM internal."user" WHERE id = ANY($1)',
        [missing],
      )
      for (const row of found.rows) names.set(row.id, row.name)
    }
    return {
      kind: 'instrument_usage',
      lines,
      openHours: Number(report.open_hours),
      labels: {
        person: (userId) =>
          userId ? (names.get(userId) ?? userId) : t('spend.noPerson'),
        project: (line) => line.projectTitle ?? t('spend.noProject'),
      },
    }
  }
  if (report.kind === 'spend') {
    const rows = await db.query<Parameters<typeof toSpendLine>[0]>(
      'SELECT * FROM api.report_spend_lines($1, $2, $3)',
      [report.workspace_id, from, to],
    )
    const lines = rows.rows.map(toSpendLine)
    return {
      kind: 'spend',
      lines: report.project_id
        ? lines.filter((l) => l.projectId === report.project_id)
        : lines,
    }
  }
  const rows = await db.query<Parameters<typeof toProjectStatus>[0]>(
    'SELECT * FROM api.report_project_status($1, $2, $3, $4)',
    [report.workspace_id, report.project_id, from, to],
  )
  return { kind: 'project_status', rows: rows.rows.map(toProjectStatus) }
}

/** Build and queue every report that is due. Failures are recorded per report. */
export async function runDueScheduledReports(
  db: EmailQuery,
  baseUrl: string,
  now: Date = new Date(),
): Promise<ReportRunResult> {
  const claimed = await db.query<ClaimedReport>(
    'SELECT * FROM internal.claim_due_scheduled_reports(20)',
  )
  const result: ReportRunResult = {
    claimed: claimed.rows.length,
    queued: 0,
    failed: 0,
  }
  const names = new Map<string, string>()
  for (const report of claimed.rows) {
    try {
      const range = resolvePeriod(report.period, now, report.time_zone)
      const data = await loadData(db, report, range, names)

      // Only people still in the workspace are sent anything.
      const members = await db.query<{ user_id: string; name: string | null }>(
        `SELECT m.user_id, u.name
           FROM api.workspace_memberships m
           JOIN internal."user" u ON u.id = m.user_id
          WHERE m.workspace_id = $1 AND m.suspended_at IS NULL
            AND m.user_id = ANY($2)`,
        [report.workspace_id, report.recipient_user_ids],
      )
      const sender = await db.query<{ name: string }>(
        'SELECT name FROM internal."user" WHERE id = $1',
        [report.created_by_user_id],
      )
      const email = buildReportEmail({
        name: report.name,
        range,
        zone: report.time_zone,
        data,
        baseUrl,
        sender: sender.rows.at(0)?.name ?? '',
      })
      let queued = 0
      for (const member of members.rows) {
        const queuedId = await db.query<{ id: string | null }>(
          'SELECT internal.enqueue_report_email($1, $2, $3, $4, $5::jsonb) AS id',
          [
            report.workspace_id,
            member.user_id,
            email.subject,
            email.body,
            JSON.stringify(email.attachments),
          ],
        )
        if (queuedId.rows.at(0)?.id) queued += 1
      }
      await db.query('SELECT internal.finish_scheduled_report($1, $2, $3)', [
        report.id,
        queued > 0 ? 'sent' : 'nobody',
        queued,
      ])
      result.queued += queued
    } catch (error) {
      result.failed += 1
      const reason = error instanceof Error ? error.message : String(error)
      logger.warn('scheduled report failed', { reportId: report.id, reason })
      await db.query('SELECT internal.finish_scheduled_report($1, $2, $3)', [
        report.id,
        `failed: ${reason}`,
        0,
      ])
    }
  }
  return result
}
