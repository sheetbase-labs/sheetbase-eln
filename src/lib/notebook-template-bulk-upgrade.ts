/**
 * Taking a published template version into many notebooks in one pass.
 *
 * A notebook whose upgrade needs no decision is updated straight away. One that
 * needs a decision (a conflicting sheet), is signed, or was edited since the
 * list was read is left alone and reported with the reason, so nothing is
 * decided on the owner's behalf and the rest of the pass still completes.
 */
import type { DataClient } from '#/lib/data-client'
import {
  applyNotebookTemplateUpgrade,
  previewNotebookTemplateUpgrade,
} from '#/lib/notebook-template-data'

export interface BulkUpgradeNotebook {
  id: string
  identifier: string
  locked_at: string | null
}

export type BulkUpgradeOutcome =
  | { kind: 'updated' }
  | { kind: 'needs-decision'; conflicts: number }
  | { kind: 'signed' }
  | { kind: 'failed'; message: string }

export interface BulkUpgradeResult {
  notebook: BulkUpgradeNotebook
  outcome: BulkUpgradeOutcome
}

export function describeBulkOutcome(outcome: BulkUpgradeOutcome): string {
  switch (outcome.kind) {
    case 'updated':
      return 'Updated'
    case 'needs-decision':
      return outcome.conflicts === 1
        ? 'Needs your decision on 1 sheet'
        : `Needs your decision on ${outcome.conflicts} sheets`
    case 'signed':
      return 'Signed: amend it first, then update'
    case 'failed':
      return outcome.message
  }
}

export function summariseBulkUpgrade(results: readonly BulkUpgradeResult[]) {
  const count = (kind: BulkUpgradeOutcome['kind']) =>
    results.filter((r) => r.outcome.kind === kind).length
  return {
    updated: count('updated'),
    needsDecision: count('needs-decision'),
    signed: count('signed'),
    failed: count('failed'),
  }
}

async function structureVersion(
  client: DataClient,
  recordId: string,
): Promise<number> {
  const rows = await client.list<{ structure_version: number }>(
    'records',
    `?id=eq.${encodeURIComponent(recordId)}&select=structure_version&limit=1`,
  )
  const version = rows.at(0)?.structure_version
  if (version === undefined) throw new Error('This notebook is not available.')
  return Number(version)
}

/**
 * Upgrade each notebook in turn. `onProgress` fires after every notebook so a
 * long pass can show how far it has got. One notebook failing never stops the
 * others.
 */
export async function upgradeNotebooksInBulk(
  client: DataClient,
  input: {
    notebooks: readonly BulkUpgradeNotebook[]
    targetVersionId: string
  },
  onProgress?: (done: number, total: number) => void,
): Promise<BulkUpgradeResult[]> {
  const results: BulkUpgradeResult[] = []
  for (const notebook of input.notebooks) {
    results.push({
      notebook,
      outcome: await upgradeOne(client, notebook, input.targetVersionId),
    })
    onProgress?.(results.length, input.notebooks.length)
  }
  return results
}

async function upgradeOne(
  client: DataClient,
  notebook: BulkUpgradeNotebook,
  targetVersionId: string,
): Promise<BulkUpgradeOutcome> {
  if (notebook.locked_at) return { kind: 'signed' }
  try {
    const preview = await previewNotebookTemplateUpgrade(
      notebook.id,
      targetVersionId,
      client,
    )
    if (preview.conflicts.length > 0) {
      return { kind: 'needs-decision', conflicts: preview.conflicts.length }
    }
    await applyNotebookTemplateUpgrade(
      {
        recordId: notebook.id,
        expectedStructureVersion: await structureVersion(client, notebook.id),
        targetVersionId,
        decisions: [],
      },
      client,
    )
    return { kind: 'updated' }
  } catch (cause) {
    return {
      kind: 'failed',
      message: cause instanceof Error ? cause.message : 'The update failed.',
    }
  }
}
