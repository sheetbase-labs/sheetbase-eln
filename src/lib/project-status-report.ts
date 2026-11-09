/**
 * Project status (migration 0100): where each project stands, for the weekly
 * status email. Experiments are counted by state; "late" is an experiment still
 * open past its planned end; "finished" and "started" count the period.
 */
import { csvEscape } from '#/lib/export/delimited'

export interface ProjectStatusWire {
  project_id: string
  project_title: string
  project_display_id: string | null
  project_status: string
  drafts: number
  in_progress: number
  on_hold: number
  in_review: number
  overdue: number
  completed_in_period: number
  started_in_period: number
  open_orders: number
}

export interface ProjectStatusRow {
  projectId: string
  title: string
  code: string | null
  status: string
  drafts: number
  running: number
  onHold: number
  inReview: number
  late: number
  finished: number
  started: number
  openOrders: number
}

export function toProjectStatus(row: ProjectStatusWire): ProjectStatusRow {
  return {
    projectId: row.project_id,
    title: row.project_title,
    code: row.project_display_id,
    status: row.project_status,
    drafts: Number(row.drafts),
    running: Number(row.in_progress),
    onHold: Number(row.on_hold),
    inReview: Number(row.in_review),
    late: Number(row.overdue),
    finished: Number(row.completed_in_period),
    started: Number(row.started_in_period),
    openOrders: Number(row.open_orders),
  }
}

/** The project's state as the lab reads it. */
export function projectStateLabel(status: string): string {
  return status.replaceAll('_', ' ')
}

export function projectStatusCsv(rows: readonly ProjectStatusRow[]): string {
  const header = [
    'Project',
    'Project ID',
    'State',
    'Drafts',
    'Running',
    'On hold',
    'In review',
    'Late',
    'Finished in the period',
    'Started in the period',
    'Orders still open',
  ]

  const lines = rows.map((r) => [
    r.title,
    r.code ?? '',
    projectStateLabel(r.status),
    String(r.drafts),
    String(r.running),
    String(r.onHold),
    String(r.inReview),
    String(r.late),
    String(r.finished),
    String(r.started),
    String(r.openOrders),
  ])

  return (
    [header, ...lines]
      .map((row) => row.map((cell) => csvEscape(cell, ',')).join(','))
      .join('\r\n') + '\r\n'
  )
}
