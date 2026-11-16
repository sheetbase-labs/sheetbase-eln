import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { undoChangeSet } from './client'
import { blockedWords } from './undo'
import type { UndoAction } from './undo'

/**
 * Runs an undo card's action in the person's own session, so it is they, not
 * the assistant, who put things back. All or nothing: a refusal says why and
 * has touched nothing.
 */
export async function runUndoAction(
  client: DataClient,
  action: UndoAction,
): Promise<FeatureActionResult | undefined> {
  const result = await undoChangeSet(client, action.changeSetId)

  if (!result.done) {
    const why = blockedWords(result.preview)

    throw new Error(
      why.length ? why.join(' ') : 'There is nothing left to undo.',
    )
  }

  return undefined
}
