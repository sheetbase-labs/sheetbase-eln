/**
 * Step timers: a countdown started from a protocol or notebook step that has a
 * duration (migration 0061).
 *
 * The end time is fixed by the server when the timer starts, so the timer keeps
 * counting while the page is closed, hidden or open on another device. These
 * helpers work out what is left from that fixed time and the server's clock,
 * never from a counter that ticks in the page.
 *
 * Reads go to `api.my_step_timers` (the caller's own running or finished
 * timers); starting and stopping go through RPCs.
 */

import { t } from '#/copy'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/** A week: longer than that is not a bench timer. */
export const MAX_TIMER_SECONDS = 604_800

export interface StepTimerWire {
  id: string
  record_id: string
  block_id: string
  label: string
  duration_seconds: number
  started_at: string
  ends_at: string
  server_now: string
}

export interface StepTimer {
  id: string
  recordId: string
  blockId: string
  label: string
  durationSeconds: number
  /** Epoch milliseconds, in the server's clock. */
  endsAtMs: number
  /** Add to this device's clock to get the server's. */
  clockOffsetMs: number
}

export const stepTimerQueryKeys = {
  all: ['step-timers'] as const,
}

export function toStepTimer(
  row: StepTimerWire,
  receivedAtMs: number = Date.now(),
): StepTimer {
  return {
    id: row.id,
    recordId: row.record_id,
    blockId: row.block_id,
    label: row.label,
    durationSeconds: row.duration_seconds,
    endsAtMs: Date.parse(row.ends_at),
    clockOffsetMs: Date.parse(row.server_now) - receivedAtMs,
  }
}

export async function fetchMyStepTimers(
  client: DataClient = notebookDataClient,
): Promise<StepTimer[]> {
  const rows = await client.list<StepTimerWire>(
    'my_step_timers',
    '?select=id,record_id,block_id,label,duration_seconds,started_at,ends_at,server_now&order=ends_at.asc',
  )

  const receivedAt = Date.now()

  return rows.map((row) => toStepTimer(row, receivedAt))
}

export function startStepTimer(
  blockId: string,
  seconds?: number,
  client: DataClient = notebookDataClient,
): Promise<StepTimerWire> {
  return client.rpc<StepTimerWire>('start_step_timer', {
    p_block_id: blockId,
    p_seconds: seconds ?? null,
  })
}

export function endStepTimer(
  timerId: string,
  client: DataClient = notebookDataClient,
): Promise<unknown> {
  return client.rpc('end_step_timer', { p_timer_id: timerId })
}

/** Milliseconds left on this device's clock, corrected to the server's; 0 once ended. */
export function remainingMs(timer: StepTimer, nowMs: number): number {
  return Math.max(0, timer.endsAtMs - (nowMs + timer.clockOffsetMs))
}

export function isFinished(timer: StepTimer, nowMs: number): boolean {
  return remainingMs(timer, nowMs) === 0
}

/** 90 -> "1:30", 3725 -> "1:02:05". Rounds up so "0:00" only shows once it has ended. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`
}

/** A step's duration if it has a usable one. */
export function stepDurationSeconds(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>).durationSeconds

  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_TIMER_SECONDS
    ? value
    : null
}

/** A short length: 90 -> "1 min 30 s", 5400 -> "1 h 30 min", 45 -> "45 s". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []

  if (h) parts.push(t('notebook.stepTimers.length.hours', { count: h }))

  if (m) parts.push(t('notebook.stepTimers.length.minutes', { count: m }))

  if (s && !h) parts.push(t('notebook.stepTimers.length.seconds', { count: s }))

  return (
    parts.join(' ') || t('notebook.stepTimers.length.seconds', { count: 0 })
  )
}

/** The timers already finished at this moment, soonest first. */
export function finishedTimers(
  timers: readonly StepTimer[],
  nowMs: number,
): StepTimer[] {
  return timers.filter((timer) => isFinished(timer, nowMs))
}

/** The milliseconds until the next running timer ends, or null if none is running. */
export function nextEndInMs(
  timers: readonly StepTimer[],
  nowMs: number,
): number | null {
  let soonest: number | null = null

  for (const timer of timers) {
    const left = remainingMs(timer, nowMs)

    if (left > 0 && (soonest === null || left < soonest)) soonest = left
  }

  return soonest
}
