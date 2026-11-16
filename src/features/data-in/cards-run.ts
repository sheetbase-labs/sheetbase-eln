import type { DataClient } from '#/lib/data-client'
import { openDatasetInNewSheet } from '#/lib/sheet-from-dataset'

import type { FeatureActionResult } from '../define'
import type { DataInAction } from './cards'

/**
 * Runs the card's action in the person's own session, so it is they, not the
 * assistant, who makes the sheet. Loaded only when the button is pressed.
 */
export async function runDataInAction(
  client: DataClient,
  action: DataInAction,
): Promise<FeatureActionResult | undefined> {
  const opened = await openDatasetInNewSheet(client, {
    datasetId: action.datasetId,
    name: action.name,
    notebookRecordId: action.notebookRecordId,
  })

  return {
    openHref: action.notebookRecordId
      ? `/records/${action.notebookRecordId}/notebook`
      : `/sheets/${opened.instance.id}`,
  }
}
