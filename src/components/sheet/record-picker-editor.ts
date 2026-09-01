import { BaseEditor } from 'handsontable/editors/baseEditor'

/** Grid coordinates of the record-picker cell whose edit opened the picker. */
export interface RecordPickerCellCoords {
  row: number
  col: number
}

/**
 * GRID-03 — Handsontable editor for Record-reference (`record-picker`)
 * columns.
 *
 * Opening the editor never shows a text input: it hands the edited cell's
 * coordinates to the workspace's shared search-select Record picker and closes
 * the editor without touching the value. The picked Record UUID is written
 * through `setDataAtCell` by the workspace, so it passes through the same
 * beforeChange → parse → validate pipeline as every other edit and the server
 * stays the authority on whether the target Record exists and is accessible.
 */
export function createRecordPickerEditor(
  openPicker: (cell: RecordPickerCellCoords) => void,
): typeof BaseEditor {
  return class RecordPickerEditor extends BaseEditor {
    static override get EDITOR_TYPE(): string {
      return 'sheetbaseRecordPicker'
    }

    open(): void {
      // Cancel the editor lifecycle without saving, then surface the shared
      // search-select picker. cancelChanges (not finishEditing) so the cell
      // value is never rewritten by the editor itself.
      this.cancelChanges()
      if (typeof this.row === 'number' && typeof this.col === 'number') {
        openPicker({ row: this.row, col: this.col })
      }
    }

    close(): void {
      // No DOM element is owned by this editor.
    }

    focus(): void {
      // No editable element to focus.
    }

    getValue(): unknown {
      return this.originalValue
    }

    setValue(value: unknown): void {
      this.originalValue = value
    }
  }
}
