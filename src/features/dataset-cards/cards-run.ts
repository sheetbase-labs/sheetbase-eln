import { z } from 'zod'

import { runRpcAction } from '#/lib/assistant-rpc-cards'
import type { commitImport } from '#/lib/import/data'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { DATASET_CARDS } from './cards'
import type { DatasetCardsAction } from './cards'

/** What the import card sends the app's import: the kept file, the match and the key. */
const importArgs = z.object({
  fileId: z.string(),
  datasetId: z.string(),
  mapping: z.object({
    sources: z.array(
      z.object({
        source: z.string(),
        fieldId: z.string().nullable(),
        unit: z.string().nullable(),
      }),
    ),
    sheetName: z.string().optional(),
  }),
  sheetName: z.string().nullable(),
  idempotencyKey: z.string(),
})

/** Runs the card in the person's own session, so their access applies. */
export async function runDatasetCardsAction(
  client: Pick<DataClient, 'rpc'>,
  action: DatasetCardsAction,
  commit: typeof commitImport = async (input) =>
    (await import('#/lib/import/data')).commitImport(input),
): Promise<FeatureActionResult | undefined> {
  // A kept file is imported by the app's import, which keeps the parser and
  // the receipt with the rows; it is the call behind `commit_dataset_import`.
  if (
    action.kind === 'sheetbase.dataset.import_file' &&
    action.rpc === 'commit_dataset_import'
  ) {
    const args = importArgs.parse(action.args)
    const result = await commit(args)

    if (!result.ok) {
      throw new Error(
        result.errors.at(0)?.message ?? 'The import was rejected.',
      )
    }

    return action.openHref ? { openHref: action.openHref } : undefined
  }

  return runRpcAction(client, DATASET_CARDS, action)
}
