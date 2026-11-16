import type { DataClient } from '#/lib/data-client'

import { undoPreviewSchema, undoResultSchema, setRowSchema } from './undo'
import type { ChangeSetRow, UndoPreview, UndoResult } from './undo'

/**
 * The browser half of undo: open a change set around an assistant card or plan,
 * close it when the card has run, and later preview and undo it. Each call is an
 * ordinary RPC as the signed-in person.
 */

/** Opens a window on the audit trail. Pass `setId` to carry on a plan that paused. */
export async function beginChangeSet(
  client: DataClient,
  input: { title: string; kind: 'card' | 'plan'; setId?: string },
): Promise<string> {
  const row = await client.rpc<{ id: string }>('begin_ai_change_set', {
    p_title: input.title,
    p_kind: input.kind,
    p_set_id: input.setId ?? null,
  })

  return row.id
}

/**
 * Closes the window. `untracked` names the steps whose changes the audit trail
 * does not carry, so the preview can say they stay. Resolves to the set, or
 * null when nothing was changed and there is nothing to undo.
 */
export async function finishChangeSet(
  client: DataClient,
  setId: string,
  untracked: string[],
): Promise<ChangeSetRow | null> {
  const row = await client.rpc<unknown>('finish_ai_change_set', {
    p_set_id: setId,
    p_untracked: untracked.map((title) => ({ title })),
  })

  if (row === null || row === undefined) return null
  const parsed = setRowSchema.safeParse(row)

  return parsed.success ? parsed.data : null
}

export async function previewUndo(
  client: DataClient,
  setId: string,
): Promise<UndoPreview> {
  return undoPreviewSchema.parse(
    await client.rpc<unknown>('preview_ai_undo', { p_set_id: setId }),
  )
}

export async function undoChangeSet(
  client: DataClient,
  setId: string,
): Promise<UndoResult> {
  return undoResultSchema.parse(
    await client.rpc<unknown>('undo_ai_change_set', { p_set_id: setId }),
  )
}
