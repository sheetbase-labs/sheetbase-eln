import { z } from 'zod'

export const SHEET_MATERIALIZE_TOOL = 'sheetbase.sheet.materialize'
export const SHEET_ADOPT_LAYOUT_TOOL = 'sheetbase.sheet.adopt_layout_version'

export const SHEET_COMPOSITION_PROPOSE_TOOL_NAMES: readonly string[] = [
  SHEET_MATERIALIZE_TOOL,
  SHEET_ADOPT_LAYOUT_TOOL,
]

export type SheetCompositionProposeToolName =
  typeof SHEET_MATERIALIZE_TOOL | typeof SHEET_ADOPT_LAYOUT_TOOL

const shared = {
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
}

const sheetRef = z
  .string()
  .min(1)
  .max(200)
  .describe('The sheet, by ID (SHT-0012) or name.')

export const proposeSheetMaterializeSchema = z.strictObject({
  ...shared,
  sheet: sheetRef,
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('The name of the dataset the sheet is saved as.'),
})

export const proposeSheetAdoptLayoutSchema = z.strictObject({
  ...shared,
  sheet: sheetRef,
})

/** What a card does when its button is pressed. */
export type SheetCompositionAction =
  | {
      kind: 'sheet.materialize'
      instanceId: string
      expectedRevision: number
      outputName: string
      idempotencyKey: string
    }
  | {
      kind: 'sheet.adopt_layout_version'
      instanceId: string
      expectedRevision: number
      targetDefinitionVersionId: string
      retryToken: string
    }

export function isSheetCompositionAction(action: {
  kind: string
}): action is SheetCompositionAction {
  return (
    action.kind === 'sheet.materialize' ||
    action.kind === 'sheet.adopt_layout_version'
  )
}
