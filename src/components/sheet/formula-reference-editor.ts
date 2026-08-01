import { TextEditor } from 'handsontable/editors/textEditor'

/**
 * Convert a 0-indexed column number to its A1 letter representation.
 * 0 → A, 1 → B, 25 → Z, 26 → AA, 27 → AB, etc.
 */
function columnToLetter(col: number): string {
  let letter = ''
  let n = col
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}

/**
 * Convert 0-indexed row and column to an A1 cell reference.
 * Row is 1-indexed (row + 1), column is converted to letters.
 * toA1(0, 0) → "A1", toA1(2, 1) → "B3"
 */
function toA1(row: number, col: number): string {
  return `${columnToLetter(col)}${row + 1}`
}

/** Visual style for temporary reference-picking borders. */
const REFERENCE_BORDER_COLOR = '#4f7cff'

/**
 * A custom Handsontable editor that adds Excel-like point-and-click formula
 * reference picking to the standard {@link TextEditor}.
 *
 * When the user types `=` to start a formula, clicking another cell in the same
 * grid inserts that cell's A1 reference (e.g. `B3`) at the cursor position
 * instead of closing the editor and moving selection. The referenced cell is
 * highlighted with a temporary custom border. Typing operators (`+`, `-`, etc.)
 * or Enter continues the normal editing flow, allowing chained references like
 * `=B1+C1+D1`.
 *
 * This editor works WITH Handsontable's editor lifecycle: Enter commits through
 * the normal `afterChange` pipeline, Escape cancels natively, and the editor
 * keeps focus throughout the reference-picking interaction.
 *
 * The editor uses a capture-phase listener on the document to intercept cell
 * clicks before Handsontable processes them. Each instance is scoped to its own
 * Handsontable instance via `hot.rootElement.contains(target)`.
 */
export class FormulaReferenceEditor extends TextEditor {
  static get EDITOR_TYPE(): string {
    return 'formulaReference'
  }

  /** Cells highlighted with temporary reference borders, keyed by "row:col". */
  private _highlightedCells = new Set<string>()
  /** Timestamp of the last processed click, for pointerdown/mousedown dedup. */
  private _lastProcessedClick = 0
  /** Bound capture-phase pointerdown handler (for easy add/removeEventListener). */
  private _onPointerDown = (event: PointerEvent): void => {
    this.interceptCellClick(event)
  }
  /** Bound capture-phase mousedown handler (fallback for mouse input). */
  private _onMouseDown = (event: MouseEvent): void => {
    this.interceptCellClick(event)
  }

  open(): void {
    super.open()
    this._highlightedCells.clear()
    this._lastProcessedClick = 0
    const doc = this.hot.rootDocument
    doc.addEventListener('pointerdown', this._onPointerDown, true)
    doc.addEventListener('mousedown', this._onMouseDown, true)
  }

  close(): void {
    this.cleanup()
    super.close()
  }

  destroy(): void {
    this.cleanup()
    super.destroy()
  }

  /**
   * Remove capture-phase listeners and clear all temporary reference borders.
   * Safe to call multiple times (idempotent).
   */
  private cleanup(): void {
    const doc = this.hot.rootDocument
    doc.removeEventListener('pointerdown', this._onPointerDown, true)
    doc.removeEventListener('mousedown', this._onMouseDown, true)
    this.clearReferenceBorders()
  }

  /**
   * Returns true when the current editor value starts with `=`, indicating
   * formula entry mode where cell clicks should insert A1 references.
   */
  private isFormulaMode(): boolean {
    return String(this.getValue() ?? '').startsWith('=')
  }

  /**
   * Capture-phase handler that intercepts clicks on cells within the same grid
   * while the editor is in formula mode. Prevents the click from reaching
   * Handsontable (which would close the editor and move selection), inserts the
   * clicked cell's A1 reference at the cursor, highlights the cell, and keeps
   * focus in the editor textarea.
   *
   * Called for both pointerdown and mousedown. For mouse input both fire; a
   * short time window prevents double-processing.
   */
  private interceptCellClick(event: Event): void {
    if (!this.isOpened() || !this.isFormulaMode()) return

    const target = event.target as HTMLElement | null
    // Only intercept clicks within this editor's own grid (multi-grid safety).
    if (!target || !this.hot.rootElement.contains(target)) return
    if (target.tagName !== 'TD') return

    const coords = this.hot.getCoords(target)
    if (
      !coords ||
      coords.row === null ||
      coords.row < 0 ||
      coords.col === null ||
      coords.col < 0
    )
      return

    // Prevent the event from reaching Handsontable's own listeners, which
    // would close the editor and move the selection to the clicked cell.
    event.stopPropagation()
    event.preventDefault()

    // For mouse input, both pointerdown and mousedown fire for the same
    // physical click. Guard against double-processing with a short window.
    const now = Date.now()
    if (now - this._lastProcessedClick < 100) return
    this._lastProcessedClick = now

    const ref = toA1(coords.row, coords.col)
    this.insertReference(ref)
    this.highlightReference(coords.row, coords.col)
    this.focus()
  }

  /**
   * Insert an A1 reference string at the current cursor position in the editor
   * textarea, using the editor's getValue/setValue API. The cursor is moved to
   * just after the inserted reference.
   */
  private insertReference(ref: string): void {
    const value = String(this.getValue() ?? '')
    const textarea = this.TEXTAREA
    const start = textarea.selectionStart ?? value.length
    const end = textarea.selectionEnd ?? value.length
    const newValue = value.slice(0, start) + ref + value.slice(end)
    this.setValue(newValue)
    const cursorPos = start + ref.length
    textarea.setSelectionRange(cursorPos, cursorPos)
    // Resize the textarea to fit the new content.
    this.autoResize.resize()
  }

  /**
   * Highlight a referenced cell with a temporary custom border using the
   * customBorders plugin. Duplicate highlights for the same cell are skipped.
   */
  private highlightReference(row: number, col: number): void {
    const key = `${row}:${col}`
    if (this._highlightedCells.has(key)) return
    const plugin = this.hot.getPlugin('customBorders')
    plugin.setBorders([[row, col, row, col]], {
      top: { width: 2, color: REFERENCE_BORDER_COLOR, style: 'solid' },
      bottom: { width: 2, color: REFERENCE_BORDER_COLOR, style: 'solid' },
      start: { width: 2, color: REFERENCE_BORDER_COLOR, style: 'solid' },
      end: { width: 2, color: REFERENCE_BORDER_COLOR, style: 'solid' },
    })
    this._highlightedCells.add(key)
  }

  /**
   * Clear all temporary reference borders added by this editor instance.
   * Only clears borders on cells this editor highlighted, preserving any
   * user-defined custom borders on other cells.
   */
  private clearReferenceBorders(): void {
    if (this._highlightedCells.size === 0) return
    const plugin = this.hot.getPlugin('customBorders')
    for (const key of this._highlightedCells) {
      const sep = key.indexOf(':')
      const row = Number(key.slice(0, sep))
      const col = Number(key.slice(sep + 1))
      plugin.clearBorders([[row, col, row, col]])
    }
    this._highlightedCells.clear()
  }
}
