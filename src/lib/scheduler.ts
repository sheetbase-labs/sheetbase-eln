/**
 * The lab scheduler: planning the parts of an experiment onto instruments and
 * people (migration automation_robots_scheduler_code_cells). A person asks for
 * a plan, the server proposes bookings, and nothing is booked until the
 * proposal is accepted.
 */
import type { DataClient } from '#/lib/data-client'
import type { PlanItem } from './scheduler/plan'

export type ScheduleProposalStatus =
  | 'requested'
  | 'planning'
  | 'proposed'
  | 'accepted'
  | 'dismissed'
  | 'superseded'
  | 'failed'

export interface ScheduleProposalWire {
  id: string
  workspace_id: string
  number: number
  record_id: string
  status: ScheduleProposalStatus
  reason: 'plan' | 'slip'
  slipped_part_id: string | null
  anchor_on: string
  items: PlanItem[]
  conflict_count: number
  error_message: string | null
  requested_by_user_id: string
  decided_by_user_id: string | null
  decided_at: string | null
  created_at: string
  planned_at: string | null
}

export interface PartPlanWire {
  part_id: string
  hands_on_minutes: number
  wait_after_minutes: number
}

export interface PartNeedWire {
  id: string
  part_id: string
  resource_id: string
  minutes: number
  position: number
}

export interface SchedulerSettingsWire {
  workspace_id: string
  timezone: string
  work_start_minute: number
  work_end_minute: number
  work_days: number[]
}

export interface AcceptResult {
  proposalId: string
  booked: Array<{ bookingId: string; resourceId: string; partId?: string }>
  skipped: Array<{ partId?: string; resourceName?: string; reason?: string }>
}

/** "SP-0003". */
export function proposalReference(number: number): string {
  return `SP-${String(number).padStart(4, '0')}`
}

export function isWaiting(status: ScheduleProposalStatus): boolean {
  return status === 'requested' || status === 'planning'
}

export const scheduleQueryKeys = {
  all: ['scheduler'] as const,
  proposals: (recordId: string) =>
    ['scheduler', 'proposals', recordId] as const,
  plans: (recordId: string) => ['scheduler', 'plans', recordId] as const,
  settings: ['scheduler', 'settings'] as const,
  lane: (instrumentId: string) => ['scheduler', 'lane', instrumentId] as const,
}

export function fetchProposals(
  client: DataClient,
  recordId: string,
): Promise<ScheduleProposalWire[]> {
  return client.list<ScheduleProposalWire>(
    'schedule_proposals',
    `?select=*&record_id=eq.${encodeURIComponent(recordId)}&order=created_at.desc&limit=10`,
  )
}

export async function fetchPartPlans(
  client: DataClient,
  partIds: readonly string[],
): Promise<{ plans: PartPlanWire[]; needs: PartNeedWire[] }> {
  if (partIds.length === 0) return { plans: [], needs: [] }
  const list = partIds.map((id) => encodeURIComponent(id)).join(',')

  const [plans, needs] = await Promise.all([
    client.list<PartPlanWire>(
      'part_plans',
      `?select=part_id,hands_on_minutes,wait_after_minutes&part_id=in.(${list})`,
    ),
    client.list<PartNeedWire>(
      'part_resource_needs',
      `?select=*&part_id=in.(${list})&order=position.asc`,
    ),
  ])

  return { plans, needs }
}

export async function fetchSchedulerSettings(
  client: DataClient,
): Promise<SchedulerSettingsWire | null> {
  return (
    (
      await client.list<SchedulerSettingsWire>(
        'scheduler_settings',
        '?select=*&limit=1',
      )
    ).at(0) ?? null
  )
}

export function saveSchedulerSettings(
  client: DataClient,
  input: {
    workspaceId: string
    timezone: string
    startMinute: number
    endMinute: number
    days: number[]
  },
): Promise<SchedulerSettingsWire> {
  return client.rpc<SchedulerSettingsWire>('set_scheduler_settings', {
    p_workspace_id: input.workspaceId,
    p_timezone: input.timezone,
    p_work_start_minute: input.startMinute,
    p_work_end_minute: input.endMinute,
    p_work_days: input.days,
  })
}

export function savePartPlan(
  client: DataClient,
  input: {
    partId: string
    handsOnMinutes: number
    waitAfterMinutes: number
    needs: Array<{ resourceId: string; minutes: number }>
  },
): Promise<PartPlanWire> {
  return client.rpc<PartPlanWire>('set_part_plan', {
    p_part_id: input.partId,
    p_hands_on_minutes: input.handsOnMinutes,
    p_wait_after_minutes: input.waitAfterMinutes,
    p_needs: input.needs,
  })
}

export function requestProposal(
  client: DataClient,
  recordId: string,
): Promise<ScheduleProposalWire> {
  return client.rpc<ScheduleProposalWire>('request_schedule_proposal', {
    p_record_id: recordId,
    p_reason: 'plan',
    p_slipped_part_id: null,
  })
}

export function acceptProposal(
  client: DataClient,
  proposalId: string,
): Promise<AcceptResult> {
  return client.rpc<AcceptResult>('accept_schedule_proposal', {
    p_proposal_id: proposalId,
  })
}

export function dismissProposal(
  client: DataClient,
  proposalId: string,
): Promise<ScheduleProposalWire> {
  return client.rpc<ScheduleProposalWire>('dismiss_schedule_proposal', {
    p_proposal_id: proposalId,
  })
}

export function slipPart(
  client: DataClient,
  partId: string,
  days: number,
): Promise<ScheduleProposalWire> {
  return client.rpc<ScheduleProposalWire>('slip_experiment_part', {
    p_part_id: partId,
    p_days: days,
  })
}

/** Minutes after midnight as "09:00". */
export function minuteToTime(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "09:00" as minutes after midnight, or null. */
export function timeToMinute(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())

  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])

  return minutes >= 0 && minutes <= 1440 ? minutes : null
}
