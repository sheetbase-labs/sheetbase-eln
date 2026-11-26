import type { AgentOperation } from '#/lib/agent-operations'
import type { DataClient } from '#/lib/data-client'

/**
 * A notebook text card is built against the notebook's structure version at
 * the moment the model asked for it. Several cards for one notebook (one per
 * milestone, say) are all built against the same version, so once the first is
 * applied every other one is stale, though adding a block after another or at
 * the end cannot clash with anything. Read the version again at the moment the
 * person presses the button, so each card is checked against the notebook as
 * it is now and still catches a real edit made after the card was shown.
 */
export async function withCurrentStructureVersion(
  client: DataClient,
  operation: AgentOperation,
): Promise<AgentOperation> {
  if (operation.kind !== 'notebook_block.insert') return operation

  const rows = await client.list<{ structure_version: number }>(
    'records',
    `?id=eq.${operation.recordId}&select=structure_version`,
  )
  const current = rows[0]?.structure_version

  if (current === undefined) return operation

  return { ...operation, expectedRevision: Number(current) }
}
