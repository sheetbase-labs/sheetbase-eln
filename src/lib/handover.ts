/**
 * Handing over a leaver's work (migration 0090).
 *
 * `preview_member_handover` counts what a person still holds that is open;
 * `hand_over_member_work` gives the chosen kinds of it to a colleague. The
 * database decides what can move; this module names the kinds of work and
 * reads the answer.
 */
import type { DataClient } from './data-client'
import { recordKindLabel } from './notebook-data'
import { t } from '#/copy'

export interface HandoverItemWire {
  category: HandoverCategory
  record_kind: string | null
  n: number
}

export type HandoverCategory =
  | 'record'
  | 'record_reviewer'
  | 'task'
  | 'review'
  | 'instrument'
  | 'project_reviewer'

/** One line of the handover table: a kind of work and how much is open. */
export interface HandoverItem {
  /** The name sent back to the database, e.g. `record:experiment`. */
  key: string
  label: string
  count: number
}

export interface HandoverResult {
  moved: Record<string, number>
  kept: Record<string, number>
}

export const handoverKeys = {
  preview: (workspaceId: string, userId: string) =>
    ['handover', workspaceId, userId] as const,
}

export function handoverKey(item: HandoverItemWire): string {
  return item.category === 'record'
    ? `record:${item.record_kind ?? ''}`
    : item.category
}

export function handoverLabel(key: string): string {
  if (key.startsWith('record:')) {
    return t('people.handover.work.record', {
      kind: recordKindLabel(key.slice('record:'.length)),
    })
  }

  switch (key) {
    case 'record_reviewer':
      return t('people.handover.work.recordReviewer')
    case 'task':
      return t('people.handover.work.task')
    case 'review':
      return t('people.handover.work.review')
    case 'instrument':
      return t('people.handover.work.instrument')
    case 'project_reviewer':
      return t('people.handover.work.projectReviewer')
    default:
      return key
  }
}

export function toHandoverItems(rows: HandoverItemWire[]): HandoverItem[] {
  return rows.map((row) => ({
    key: handoverKey(row),
    label: handoverLabel(handoverKey(row)),
    count: row.n,
  }))
}

export async function fetchHandoverPreview(
  c: DataClient,
  input: { workspaceId: string; userId: string },
): Promise<HandoverItem[]> {
  const rows = await c.rpc<HandoverItemWire[]>('preview_member_handover', {
    p_workspace_id: input.workspaceId,
    p_user_id: input.userId,
  })

  return toHandoverItems(rows)
}

export function handOverWork(
  c: DataClient,
  input: {
    workspaceId: string
    fromUserId: string
    toUserId: string
    selection: string[]
  },
): Promise<HandoverResult> {
  return c.rpc<HandoverResult>('hand_over_member_work', {
    p_workspace_id: input.workspaceId,
    p_from_user_id: input.fromUserId,
    p_to_user_id: input.toUserId,
    p_selection: input.selection,
  })
}

export function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}
