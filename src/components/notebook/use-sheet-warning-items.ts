import { useQueries } from '@tanstack/react-query'

import { t } from '#/copy'
import { submissionSheetInstanceIds } from '#/lib/notebook-submission'
import {
  preSignWarningText,
  sheetPayloadTitle,
  sheetStateWarnings,
} from '#/lib/pre-sign-review'
import { isCanonicalSheetBlock, sheetBlockInstanceId } from '#/lib/sheet-block'
import { fetchSheetInstance } from '#/lib/sheet-instance-data'
import type { NotebookBlock } from '#/lib/notebook-data'

export interface SheetWarningItem {
  id: string
  label: string
  detail: string
  blocking: boolean
}

/**
 * The value checks the signer would see, read from each live sheet and named
 * by the sheet, so the author can fix them before submitting.
 */
export function useSheetWarningItems(
  blocks: NotebookBlock[],
  open: boolean,
): SheetWarningItem[] {
  const sheetIds = open ? submissionSheetInstanceIds(blocks) : []

  const sheetStates = useQueries({
    queries: sheetIds.map((instanceId) => ({
      queryKey: ['ui-port', 'submit-sheet-state', instanceId],
      queryFn: () => fetchSheetInstance(instanceId),
      staleTime: 0,
      retry: false,
    })),
  })

  const sheetWarningItems: SheetWarningItem[] = sheetIds.flatMap(
    (instanceId, index) => {
      const state = sheetStates[index]?.data?.state

      if (!state) return []

      const block = blocks.find(
        (b) =>
          (b.type === 'sheet' || b.type === 'sheet_shared') &&
          isCanonicalSheetBlock(b.payload) &&
          sheetBlockInstanceId(b.payload) === instanceId,
      )

      const named =
        sheetStates[index]?.data?.name.trim() ||
        sheetPayloadTitle(block?.payload)

      const where =
        named ||
        t('notebook.submitNotebookDialog.sheetNumber', { n: index + 1 })

      const warnings = sheetStateWarnings(instanceId, where, state)
      const noUnit = warnings.filter((w) => w.kind === 'missing-unit')

      const others = warnings
        .filter((w) => w.kind !== 'missing-unit')
        .map((warning) => ({
          id: warning.id,
          label: preSignWarningText(warning),
          detail: t('notebook.submitNotebookDialog.valueWarningDetail'),
          blocking: false,
        }))

      // One row per sheet for missing units, not one per column.
      return noUnit.length === 0
        ? others
        : [
            {
              id: `units:${instanceId}`,
              label: t('notebook.submitNotebookDialog.sheetUnitsMissing', {
                sheet: where,
                count: noUnit.length,
              }),
              detail: t('notebook.submitNotebookDialog.sheetUnitsDetail', {
                columns: noUnit.map((w) => w.field).join(', '),
              }),
              blocking: false,
            },
            ...others,
          ]
    },
  )

  return sheetWarningItems
}
