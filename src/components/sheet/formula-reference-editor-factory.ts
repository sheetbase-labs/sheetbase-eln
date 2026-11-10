import { createElement } from 'react'
import type {
  SpreadsheetCustomEditor,
  SpreadsheetCustomEditorContext,
} from '@sheetbase-labs/sheetbase-table'
import { FormulaReferenceEditorCell } from './formula-reference-editor'

export type FormulaColumnMatch = (
  context: Pick<SpreadsheetCustomEditorContext, 'point' | 'columnId'>,
) => boolean

/** Build the formula-column editor entry for the grid's customEditors hook. */
export function createFormulaReferenceEditor(
  matches: FormulaColumnMatch,
): SpreadsheetCustomEditor {
  return {
    matches: (context) => matches(context),
    render: (context) =>
      createElement(FormulaReferenceEditorCell, {
        key: context.address,
        point: context.point,
        initialDraft: context.initialDraft,
        commit: context.commit,
        cancel: context.cancel,
      }),
  }
}
