import type { DataClient } from '#/lib/data-client'
import { applySheetInstanceCompositionAdoption } from '#/lib/sheet-composition-adoption'
import {
  materializeSheetInstance,
  previewSheetMaterialization,
} from '#/lib/sheet-materialization-data'

import type { FeatureActionResult } from '../define'
import type { SheetCompositionAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runSheetCompositionAction(
  client: DataClient,
  action: SheetCompositionAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'sheet.materialize': {
      // The digest comes from a fresh preview, so the save is of what the sheet holds now.
      const preview = await previewSheetMaterialization(
        {
          instanceId: action.instanceId,
          expectedRevision: action.expectedRevision,
        },
        client,
      )

      const made = await materializeSheetInstance(
        {
          instanceId: action.instanceId,
          expectedRevision: action.expectedRevision,
          outputName: action.outputName,
          previewDigest: preview.previewDigest,
          idempotencyKey: action.idempotencyKey,
        },
        client,
      )

      return { openHref: `/datasets/${made.datasetId}` }
    }

    case 'sheet.adopt_layout_version': {
      const result = await applySheetInstanceCompositionAdoption(
        {
          instanceId: action.instanceId,
          expectedRevision: action.expectedRevision,
          targetDefinitionVersionId: action.targetDefinitionVersionId,
          retryToken: action.retryToken,
        },
        client,
      )

      if (result.status === 'incompatible') {
        throw new Error(
          result.preview.errorMessage ??
            'This sheet needs a decision to move to the new layout. Open it to choose.',
        )
      }

      return undefined
    }
  }
}
