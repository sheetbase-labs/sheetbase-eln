/**
 * Out of office (migration 0091): who is away, and who covers the reviews
 * waiting on them. The database applies the cover; this module reads the
 * absences, sets and cancels one, and works out how each reads in a list.
 */
import type { DataClient } from './data-client'
import { now } from './clock'

export interface AbsenceWire {
  id: string
  workspace_id: string
  user_id: string
  starts_on: string
  ends_on: string
  delegate_user_id: string | null
  note: string | null
  cancelled_at: string | null
  created_at: string
}

export interface Absence {
  id: string
  userId: string
  startsOn: string
  endsOn: string
  delegateUserId: string | null
  note: string | null
}

export type AbsenceState = 'away' | 'coming' | 'over'

export const absenceKeys = {
  all: (workspaceId: string) => ['absences', workspaceId] as const,
}

/** Today as a calendar day (`2026-11-06`), on the app's clock. */
export function today(): string {
  return now().toISOString().slice(0, 10)
}

export function toAbsence(wire: AbsenceWire): Absence {
  return {
    id: wire.id,
    userId: wire.user_id,
    startsOn: wire.starts_on,
    endsOn: wire.ends_on,
    delegateUserId: wire.delegate_user_id,
    note: wire.note,
  }
}

export function absenceState(
  absence: Pick<Absence, 'startsOn' | 'endsOn'>,
  on: string = today(),
): AbsenceState {
  if (absence.endsOn < on) return 'over'
  return absence.startsOn > on ? 'coming' : 'away'
}

/** Absences not cancelled and not yet over, soonest first. */
export async function fetchAbsences(
  c: DataClient,
  workspaceId: string,
): Promise<Absence[]> {
  const rows = await c.list<AbsenceWire>(
    'member_absences',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&cancelled_at=is.null&ends_on=gte.${today()}&order=starts_on.asc&select=id,workspace_id,user_id,starts_on,ends_on,delegate_user_id,note,cancelled_at,created_at`,
  )
  return rows.map(toAbsence)
}

/** The absence a person is on, or has set for later, if any. */
export function absenceOf(
  absences: readonly Absence[],
  userId: string,
): Absence | undefined {
  return absences.find((a) => a.userId === userId)
}

export function setAbsence(
  c: DataClient,
  input: {
    workspaceId: string
    startsOn: string
    endsOn: string
    delegateUserId: string | null
    note: string
    userId?: string
  },
): Promise<AbsenceWire> {
  return c.rpc<AbsenceWire>('set_member_absence', {
    p_workspace_id: input.workspaceId,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_delegate_user_id: input.delegateUserId,
    p_note: input.note.trim() || null,
    p_user_id: input.userId ?? null,
  })
}

export function cancelAbsence(
  c: DataClient,
  absenceId: string,
): Promise<AbsenceWire> {
  return c.rpc<AbsenceWire>('cancel_member_absence', {
    p_absence_id: absenceId,
  })
}
