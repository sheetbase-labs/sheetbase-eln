/**
 * Plans asked for from the app, the API, the assistant and pipelines
 * (`api.request_schedule_proposal`). Picks each one up, reads what the planner
 * needs (the parts, the lab's hours, bookings, absences and booking rules),
 * runs the planner and writes the answer back for a person to look at. Nothing
 * is booked here.
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { logger } from '../logger'
import { DEFAULT_HOURS, localToEpoch, planSchedule } from './plan'
import type {
  Busy,
  PlanInput,
  PlanPart,
  ResourceRules,
  WorkingHours,
} from './plan'

export const SCHEDULE_SWEEP_INTERVAL_MS = 5_000

export interface PlanConnection {
  query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

interface ClaimedProposal {
  id: string
  workspace_id: string
  record_id: string
  requested_by_user_id: string
  anchor_on: string
}

const asDate = (value: unknown): string =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10)

/** Everything the planner reads for one experiment. */
export async function loadPlanInput(
  conn: PlanConnection,
  proposal: ClaimedProposal,
  now: Date,
): Promise<{ input: PlanInput; identifier: string }> {
  const q = conn.query

  const { rows: records } = await q<{ identifier: string }>(
    `SELECT identifier FROM api.records WHERE id = $1`,
    [proposal.record_id],
  )

  const identifier = records[0]?.identifier ?? 'Experiment'

  const { rows: settings } = await q<{
    timezone: string
    work_start_minute: number
    work_end_minute: number
    work_days: number[]
  }>(
    `SELECT timezone, work_start_minute, work_end_minute, work_days
       FROM api.scheduler_settings WHERE workspace_id = $1`,
    [proposal.workspace_id],
  )

  const hours: WorkingHours = settings[0]
    ? {
        timezone: settings[0].timezone,
        startMinute: settings[0].work_start_minute,
        endMinute: settings[0].work_end_minute,
        days: settings[0].work_days,
      }
    : DEFAULT_HOURS

  const { rows: partRows } = await q<{
    id: string
    n: number
    title: string
    day_offset: number
    assignee_user_id: string | null
    hands_on_minutes: number
    wait_after_minutes: number
  }>(
    `SELECT p.id, row_number() OVER (ORDER BY p."position", p.id)::int AS n, p.title, p.day_offset,
            p.assignee_user_id, coalesce(pp.hands_on_minutes, 60) AS hands_on_minutes,
            coalesce(pp.wait_after_minutes, 0) AS wait_after_minutes
       FROM api.experiment_parts p
       LEFT JOIN api.part_plans pp ON pp.part_id = p.id
      WHERE p.record_id = $1
      ORDER BY p."position", p.id`,
    [proposal.record_id],
  )

  const { rows: needRows } = await q<{
    part_id: string
    resource_id: string
    name: string
    minutes: number
  }>(
    `SELECT n.part_id, n.resource_id, r.name, n.minutes
       FROM api.part_resource_needs n
       JOIN api.calendar_resources r ON r.id = n.resource_id
       JOIN api.experiment_parts p ON p.id = n.part_id
      WHERE p.record_id = $1
      ORDER BY n."position"`,
    [proposal.record_id],
  )

  const { rows: doneRows } = await q<{ id: string }>(
    `SELECT id FROM api.experiment_parts WHERE record_id = $1 AND completed_at IS NOT NULL`,
    [proposal.record_id],
  )

  const done = new Set(doneRows.map((r) => r.id))

  const parts: PlanPart[] = partRows
    .filter((p) => !done.has(p.id))
    .map((p) => ({
      partId: p.id,
      number: p.n,
      title: p.title,
      dayOffset: p.day_offset,
      assigneeUserId: p.assignee_user_id,
      handsOnMinutes: p.hands_on_minutes,
      waitAfterMinutes: p.wait_after_minutes,
      needs: needRows
        .filter((n) => n.part_id === p.id)
        .map((n) => ({
          resourceId: n.resource_id,
          resourceName: n.name,
          minutes: n.minutes,
        })),
    }))

  const resourceIds = [...new Set(needRows.map((n) => n.resource_id))]

  const people = [
    ...new Set([
      proposal.requested_by_user_id,
      ...parts.map((p) => p.assigneeUserId).filter((u): u is string => !!u),
    ]),
  ]

  // Bookings other than the ones an earlier accepted plan for this experiment made;
  // accepting a new plan replaces those.
  const busy = new Map<string, Busy[]>()

  if (resourceIds.length > 0) {
    const { rows } = await q<{
      resource_id: string
      starts_at: Date
      ends_at: Date
    }>(
      `SELECT b.resource_id, b.starts_at, b.ends_at
         FROM api.calendar_bookings b
        WHERE b.resource_id = ANY($1::uuid[]) AND b.status <> 'cancelled' AND b.ends_at > $2
          AND NOT EXISTS (
            SELECT 1 FROM api.schedule_proposal_bookings sb
              JOIN api.schedule_proposals sp ON sp.id = sb.proposal_id
             WHERE sb.booking_id = b.id AND sp.record_id = $3 AND sp.status = 'accepted')`,
      [resourceIds, now.toISOString(), proposal.record_id],
    )

    for (const row of rows) {
      const list = busy.get(row.resource_id) ?? []
      list.push({
        start: Math.floor(new Date(row.starts_at).getTime() / 60_000),
        end: Math.ceil(new Date(row.ends_at).getTime() / 60_000),
      })
      busy.set(row.resource_id, list)
    }
  }

  const rules = new Map<string, ResourceRules>()
  const gaps = new Map<string, string>()

  if (resourceIds.length > 0) {
    const { rows } = await q<{
      id: string
      max_booking_minutes: number | null
      max_advance_days: number | null
      out_of_service: boolean
    }>(
      `SELECT r.id, br.max_booking_minutes, br.max_advance_days,
              (i.out_of_service_at IS NOT NULL OR i.retired_at IS NOT NULL OR r.status <> 'active') AS out_of_service
         FROM api.calendar_resources r
         LEFT JOIN api.instruments i ON i.id = r.id
         LEFT JOIN api.instrument_booking_rules br ON br.instrument_id = r.id
        WHERE r.id = ANY($1::uuid[])`,
      [resourceIds],
    )

    for (const row of rows) {
      rules.set(row.id, {
        maxBookingMinutes: row.max_booking_minutes,
        maxAdvanceDays: row.max_advance_days,
        outOfService: row.out_of_service,
      })
    }

    const { rows: gapRows } = await q<{
      resource_id: string
      user_id: string
      name: string
      reason: string
    }>(
      `SELECT r.id AS resource_id, u AS user_id, r.name,
              CASE WHEN NOT internal.instrument_qualified(r.id, u)
                     THEN 'A current qualification is required to book ' || r.name || '.'
                   ELSE 'Training is required before booking ' || r.name || ': ' || g.identifier || ' ' || g.title || '.' END AS reason
         FROM api.calendar_resources r
         CROSS JOIN unnest($2::text[]) u
         LEFT JOIN LATERAL internal.instrument_training_gaps(r.id, u) g ON true
        WHERE r.id = ANY($1::uuid[]) AND r.resource_type = 'instrument'
          AND (NOT internal.instrument_qualified(r.id, u) OR g.protocol_record_id IS NOT NULL)`,
      [resourceIds, people],
    )

    for (const row of gapRows)
      gaps.set(`${row.resource_id}:${row.user_id}`, row.reason)
  }

  const absences = new Map<string, Array<readonly [string, string]>>()

  if (people.length > 0) {
    const { rows } = await q<{
      user_id: string
      starts_on: unknown
      ends_on: unknown
    }>(
      `SELECT user_id, starts_on, ends_on FROM api.member_absences
        WHERE workspace_id = $1 AND user_id = ANY($2::text[]) AND cancelled_at IS NULL AND ends_on >= current_date`,
      [proposal.workspace_id, people],
    )

    for (const row of rows) {
      const list = absences.get(row.user_id) ?? []
      list.push([asDate(row.starts_on), asDate(row.ends_on)] as const)
      absences.set(row.user_id, list)
    }
  }

  const notBefore = Math.ceil(now.getTime() / 60_000 / 5) * 5

  return {
    identifier,
    input: {
      anchorOn: asDate(proposal.anchor_on),
      notBefore: Math.max(
        notBefore,
        localToEpoch(asDate(proposal.anchor_on), 0, hours.timezone),
      ),
      hours,
      parts,
      busy,
      rules,
      absences,
      gaps,
      requesterId: proposal.requested_by_user_id,
    },
  }
}

export interface ScheduleSweepDeps {
  connect: () => Promise<PlanConnection>
  now?: () => Date
}

/** Claim and plan what is waiting. Returns how many were handled. */
export async function sweepScheduleRequests(
  deps: ScheduleSweepDeps,
): Promise<number> {
  const conn = await deps.connect()
  let handled = 0

  try {
    for (let i = 0; i < 5; i++) {
      const { rows } = await conn.query<ClaimedProposal | null>(
        `SELECT id, workspace_id, record_id, requested_by_user_id, anchor_on
           FROM internal.claim_schedule_proposal() WHERE id IS NOT NULL`,
      )

      const proposal = rows.at(0)

      if (!proposal) break
      let items: unknown = []
      let conflicts = 0
      let error: string | null = null
      let anchor = asDate(proposal.anchor_on)

      try {
        const { input, identifier } = await loadPlanInput(
          conn,
          proposal,
          (deps.now ?? (() => new Date()))(),
        )

        const plan = planSchedule(input)
        anchor = input.anchorOn
        items = plan.items.map((item) => ({
          ...item,
          title: `${identifier} · ${item.partTitle}`,
        }))
        conflicts = plan.conflictCount
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }

      await conn.query(
        `SELECT internal.fill_schedule_proposal($1::uuid, $2::date, $3::jsonb, $4::int, $5)`,
        [proposal.id, anchor, JSON.stringify(items), conflicts, error],
      )
      handled++
    }
  } finally {
    await conn.end()
  }

  return handled
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false
const startedKey = '__sheetbaseScheduleSchedulerStarted'

function disabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

/** Starts picking up plan requests every few seconds. Safe to call twice. */
export function startScheduleScheduler(): void {
  if (typeof window !== 'undefined' || disabled()) return
  const g = globalThis as unknown as Record<string, unknown>

  if (g[startedKey]) return
  g[startedKey] = true

  const open = async () => {
    const client = new PooledClient({ connectionString: env.DATABASE_URL })
    await client.connect()

    return client
  }

  const tick = async () => {
    if (running) return
    running = true

    try {
      await sweepScheduleRequests({ connect: open })
    } catch (error) {
      logger.warn('schedule planning sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }

  timer = setInterval(() => void tick(), SCHEDULE_SWEEP_INTERVAL_MS)
  timer.unref()
}

export function stopScheduleScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
  const g = globalThis as unknown as Record<string, unknown>
  delete g[startedKey]
}
