import { useQuery } from '@tanstack/react-query'

import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * A series of experiments: one experiment heads it, and the experiments it
 * groups stay separate, each with its own owner, review and signature. The
 * database keeps the order, the planned days and the roll-up (migration 0104);
 * this module reads them and makes the changes.
 */

export interface SeriesMember {
  member_record_id: string
  member_number: number
  position: number
  identifier: string
  title: string
  status: string
  owner_user_id: string
  reviewer_user_id: string | null
  assignee_user_id: string | null
  planned_on: string | null
  planned_end: string | null
  day_offset: number | null
  locked_at: string | null
  steps_total: number
  steps_done: number
  sample_count: number
}

export interface SeriesMembership {
  series_record_id: string
  series_identifier: string
  series_title: string
  member_number: number
  member_total: number
  previous_record_id: string | null
  previous_identifier: string | null
  previous_title: string | null
  next_record_id: string | null
  next_identifier: string | null
  next_title: string | null
}

export interface SeriesRollup {
  series_record_id: string
  total: number
  approved: number
  in_review: number
  in_progress: number
  samples: number
  first_day: string | null
  last_day: string | null
  next: {
    record_id: string
    identifier: string
    title: string
    due_on: string | null
  } | null
}

export const seriesQueryKeys = {
  all: ['series'] as const,
  head: (recordId: string) => ['series', 'head', recordId] as const,
  members: (seriesId: string) => ['series', 'members', seriesId] as const,
  rollup: (seriesId: string) => ['series', 'rollup', seriesId] as const,
  membership: (recordId: string) => ['series', 'membership', recordId] as const,
}

export function fetchSeriesMembers(
  client: DataClient,
  seriesId: string,
): Promise<SeriesMember[]> {
  return client.rpc<SeriesMember[]>('series_members', {
    p_series_record_id: seriesId,
  })
}

export function fetchSeriesRollup(
  client: DataClient,
  seriesId: string,
): Promise<SeriesRollup> {
  return client.rpc<SeriesRollup>('series_rollup', {
    p_series_record_id: seriesId,
  })
}

/** Where an experiment sits in its series; null when it is in none. */
export async function fetchSeriesMembership(
  client: DataClient,
  recordId: string,
): Promise<SeriesMembership | null> {
  const rows = await client.rpc<SeriesMembership[]>('record_series', {
    p_record_id: recordId,
  })

  return rows[0] ?? null
}

/** Whether an experiment heads a series, even one with no members yet. */
export async function fetchIsSeriesHead(
  client: DataClient,
  recordId: string,
): Promise<boolean> {
  const rows = await client.list<{ record_id: string }>(
    'experiment_series',
    `?record_id=eq.${recordId}&select=record_id&limit=1`,
  )

  return rows.length > 0
}

export function useSeriesMembership(recordId: string | undefined) {
  return useQuery({
    queryKey: seriesQueryKeys.membership(recordId ?? ''),
    enabled: Boolean(recordId),
    queryFn: () => fetchSeriesMembership(notebookDataClient, recordId ?? ''),
  })
}

export function useIsSeriesHead(recordId: string | undefined) {
  return useQuery({
    queryKey: seriesQueryKeys.head(recordId ?? ''),
    enabled: Boolean(recordId),
    queryFn: () => fetchIsSeriesHead(notebookDataClient, recordId ?? ''),
  })
}

export function useSeriesMembers(seriesId: string | undefined) {
  return useQuery({
    queryKey: seriesQueryKeys.members(seriesId ?? ''),
    enabled: Boolean(seriesId),
    queryFn: () => fetchSeriesMembers(notebookDataClient, seriesId ?? ''),
  })
}

export function useSeriesRollup(seriesId: string | undefined) {
  return useQuery({
    queryKey: seriesQueryKeys.rollup(seriesId ?? ''),
    enabled: Boolean(seriesId),
    queryFn: () => fetchSeriesRollup(notebookDataClient, seriesId ?? ''),
  })
}

export function startSeries(client: DataClient, recordId: string) {
  return client.rpc('start_experiment_series', { p_record_id: recordId })
}

export function dissolveSeries(client: DataClient, recordId: string) {
  return client.rpc('dissolve_experiment_series', { p_record_id: recordId })
}

export function addSeriesMember(
  client: DataClient,
  input: {
    seriesId: string
    memberId: string
    plannedOn?: string | null
    position?: number
  },
) {
  return client.rpc('add_series_member', {
    p_series_record_id: input.seriesId,
    p_member_record_id: input.memberId,
    ...(input.plannedOn ? { p_planned_on: input.plannedOn } : {}),
    ...(input.position !== undefined ? { p_position: input.position } : {}),
  })
}

export function removeSeriesMember(client: DataClient, memberId: string) {
  return client.rpc('remove_series_member', { p_member_record_id: memberId })
}

export function moveSeriesMember(
  client: DataClient,
  memberId: string,
  position: number,
) {
  return client.rpc('move_series_member', {
    p_member_record_id: memberId,
    p_position: position,
  })
}

export function setSeriesMemberDay(
  client: DataClient,
  memberId: string,
  plannedOn: string | null,
) {
  return client.rpc('set_series_member_day', {
    p_member_record_id: memberId,
    ...(plannedOn ? { p_planned_on: plannedOn } : {}),
  })
}

/**
 * The position that puts a member before or after its neighbour in the list.
 * Members are ordered by a number, so a move lands halfway between two
 * neighbours, or one step past the end.
 */
export function positionForMove(
  positions: readonly number[],
  from: number,
  to: number,
): number {
  const others = positions.filter((_, index) => index !== from)
  const before = to > 0 ? others.at(to - 1) : undefined
  const after = others.at(to)

  if (before === undefined && after === undefined) return 1

  if (before === undefined) return (after ?? 0) - 1

  if (after === undefined) return before + 1

  return (before + after) / 2
}

export interface MemberProgress {
  kind: 'approved' | 'review' | 'active' | 'waiting' | 'plain'
  /** The step being worked on, when the member has steps. */
  step?: number
  steps?: number
  /** The identifier of the experiment before it that is not yet approved. */
  waitingFor?: string
  /** The title of that experiment. */
  waitingTitle?: string
}

/**
 * What a series row says about where the work has got to, from the member's
 * status and steps: approved, in review, at step 2 of 4, or waiting for the
 * member before it.
 */
export function memberProgress(
  member: SeriesMember,
  previous: SeriesMember | undefined,
): MemberProgress {
  if (member.status === 'approved') return { kind: 'approved' }

  if (member.status === 'in_review') return { kind: 'review' }

  if (member.status === 'in_progress') {
    return member.steps_total > 0
      ? {
          kind: 'active',
          step: Math.min(member.steps_done + 1, member.steps_total),
          steps: member.steps_total,
        }
      : { kind: 'active' }
  }

  if (
    (member.status === 'draft' || member.status === 'planned') &&
    previous &&
    previous.status !== 'approved'
  ) {
    return {
      kind: 'waiting',
      waitingFor: previous.identifier,
      waitingTitle: previous.title,
    }
  }

  return { kind: 'plain' }
}
