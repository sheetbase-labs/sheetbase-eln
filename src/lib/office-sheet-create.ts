/**
 * Putting a worksheet into a notebook as a sheet block: the sheet is created
 * in the notebook's project and then inserted after the file block it came
 * from.
 */
import { createAdHocSheetInstance } from '#/lib/sheet-instance-data'
import type { MadeSheet } from '#/lib/office-sheet'

const DESCRIPTION_MAX = 2000

/** What the sheet says about where it came from. */
export function sheetDescription(input: {
  fileName: string
  fileVersion: number | null
  worksheet: string
  made: MadeSheet
  note: (file: string, version: string, sheet: string) => string
  formulasNote: (columns: string) => string
}): string {
  const lines = [
    input.note(
      input.fileName,
      input.fileVersion === null ? '' : String(input.fileVersion),
      input.worksheet,
    ),
  ]

  if (input.made.formulaColumns.length > 0) {
    lines.push(
      input.formulasNote(
        input.made.formulaColumns
          .map((column) => `${column.label} (${column.example})`)
          .join(', '),
      ),
    )
  }

  return lines.join(' ').slice(0, DESCRIPTION_MAX)
}

export interface MakeSheetInput {
  workspaceId: string
  projectId: string | null
  notebookRecordId: string
  name: string
  description: string
  made: MadeSheet
}

/** Create the sheet; the caller inserts the block that shows it. */
export function createSheetFromWorksheet(input: MakeSheetInput) {
  return createAdHocSheetInstance({
    workspaceId: input.workspaceId,
    name: input.name.trim().slice(0, 200) || 'Sheet',
    description: input.description,
    projectId: input.projectId,
    notebookRecordId: input.notebookRecordId,
    state: input.made.state,
  })
}
