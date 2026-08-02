import { TextEditor } from 'handsontable/editors/textEditor'
import { normalizeExponentiation } from '#/lib/formula-ir'

/**
 * Convert a 0-indexed column number to its A1 letter representation.
 * 0 → A, 1 → B, 25 → Z, 26 → AA, 27 → AB, etc.
 */
export function columnToLetter(col: number): string {
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
export function toA1(row: number, col: number): string {
  return `${columnToLetter(col)}${row + 1}`
}

/**
 * Normalise two corners of a selection so the start is always the
 * top-left (smallest row/col) and the end is the bottom-right.
 */
export function normalizeRange(
  rowA: number,
  colA: number,
  rowB: number,
  colB: number,
): { startRow: number; startCol: number; endRow: number; endCol: number } {
  return {
    startRow: Math.min(rowA, rowB),
    startCol: Math.min(colA, colB),
    endRow: Math.max(rowA, rowB),
    endCol: Math.max(colA, colB),
  }
}

/**
 * Convert a (possibly multi-cell) selection to its A1 reference string.
 * A single cell returns "B3"; a range returns "A1:A5". The corners may be
 * supplied in any order — they are normalised first.
 */
export function toA1Range(
  rowA: number,
  colA: number,
  rowB: number,
  colB: number,
): string {
  const { startRow, startCol, endRow, endCol } = normalizeRange(
    rowA,
    colA,
    rowB,
    colB,
  )
  if (startRow === endRow && startCol === endCol) return toA1(startRow, startCol)
  return `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`
}

/**
 * Accent colours used to outline picked references, cycled per reference so
 * that multiple references in one formula are visually distinguishable
 * (Excel-style). The palette is drawn from the Sheetbase design tokens in
 * DESIGN.md so highlights stay on-brand; the first colour is Signal Blue
 * (the focus accent), matching the existing single-colour approach.
 */
export const REFERENCE_COLORS: readonly string[] = Object.freeze([
  '#3986E4', // signal-blue (focus)
  '#00A659', // success-green
  '#9B61EA', // analysis-violet
  '#00A3BB', // analysis-cyan
  '#E8A200', // warning-amber
  '#EA3130', // destructive-red
  '#006EDC', // laboratory-blue
])

/**
 * A single reference picked while editing a formula.
 *
 * `sheet` records the owning sheet name (read from the formulas plugin) so
 * that a future cross-sheet picker can qualify references as `Sheet!A1`.
 * Single-sheet formulas render the plain A1 text and never emit the sheet
 * prefix.
 */
export interface PickedReference {
  sheet: string
  startRow: number
  startCol: number
  endRow: number
  endCol: number
  /** The A1 text inserted into the editor, e.g. "B3" or "A1:A5". */
  a1: string
  /** Index into {@link REFERENCE_COLORS}; the colour used for the highlight. */
  colorIndex: number
}

/**
 * Build a {@link PickedReference} from a selection. The corners may be supplied
 * in any order. The colour index selects the highlight colour from the palette.
 */
export function buildReference(
  sheet: string,
  rowA: number,
  colA: number,
  rowB: number,
  colB: number,
  colorIndex: number,
): PickedReference {
  return {
    sheet,
    ...normalizeRange(rowA, colA, rowB, colB),
    a1: toA1Range(rowA, colA, rowB, colB),
    colorIndex,
  }
}

/**
 * The minimal slice of a Handsontable instance that {@link ReferencePicker}
 * needs. Declared structurally so the real `HotInstance` satisfies it without
 * casts, while unit tests can supply a lightweight mock.
 */
export interface HotLike {
  readonly rootElement: HTMLElement
  readonly rootDocument: Document
  getCoords: (element: HTMLElement) => {
    row: number | null
    col: number | null
  } | null
  getCell: (row: number, col: number) => HTMLTableCellElement | null
}

/** A live preview overlay + the set of committed reference highlights. */
interface PickerOptions {
  /** Returns the owning sheet name for new references (cross-sheet ready). */
  getSheetName: () => string
  /** Inserts the A1 text at the editor cursor. */
  insertReference: (a1: string) => void
  /** Returns focus to the editor textarea. */
  refocusEditor: () => void
}

/**
 * Manages the Excel-like reference-picking interaction for an in-cell formula
 * edit, decoupled from the Handsontable editor textarea.
 *
 * The picker tracks the anchor cell of an in-progress click-drag, renders a
 * live marquee overlay while dragging, and on release commits a reference
 * (single cell or range) with a persistent coloured overlay (a dashed border +
 * translucent fill, like Excel). Multiple references each keep their own
 * overlay for the lifetime of the edit; {@link clearAllHighlights} removes
 * them all. Overlays are plain divs positioned relative to the grid root —
 * not plugin borders — so they work with any column type and never interfere
 * with Handsontable's internal event system.
 */
export class ReferencePicker {
  private readonly hot: HotLike
  private readonly options: PickerOptions
  /** References committed during this edit, in insertion order. */
  private _references: PickedReference[] = []
  /** Overlay divs for committed references, paired with their references. */
  private _overlays: Array<{ ref: PickedReference; element: HTMLDivElement }> = []
  /** Anchor cell of the in-progress drag (pointerdown). */
  private _anchor: { row: number; col: number } | null = null
  /** Current drag extent (last cell the pointer moved over). */
  private _current: { row: number; col: number } | null = null
  /** Live marquee overlay element, or null when no drag is in progress. */
  private _preview: HTMLDivElement | null = null
  /** Pointer id of the active drag, or null when no drag is in progress. */
  private _activePointerId: number | null = null
  /** Bound drag listeners (added on pointerdown, removed on pointerup/cancel). */
  private readonly _onPointerMove = (e: PointerEvent) => this.onPointerMove(e)
  private readonly _onPointerUp = (e: PointerEvent) => this.onPointerUp(e)
  private readonly _onPointerCancel = (e: PointerEvent) => this.abortDrag(e)
  /** Bound window-blur listener (aborts an in-progress drag on focus loss). */
  private readonly _onBlur = () => this.abortDrag()
  /** Whether the scroll/resize reposition listeners are attached. */
  private _repositionAttached = false
  /** Bound scroll listener (capture, for internal Handsontable scroll containers). */
  private readonly _onScroll = () => this.repositionHighlights()
  /** Bound window resize listener (repositions overlays on viewport changes). */
  private readonly _onResize = () => this.repositionHighlights()

  constructor(hot: HotLike, options: PickerOptions) {
    this.hot = hot
    this.options = options
  }

  /** References committed during the current edit (read-only view). */
  get references(): readonly PickedReference[] {
    return this._references
  }

  /** True when a click-drag is currently in progress. */
  get isDragging(): boolean {
    return this._anchor !== null
  }

  /** Reset all state for a fresh edit (called when the editor opens). */
  reset(): void {
    this.clearAllHighlights()
    this._anchor = null
    this._current = null
    this._activePointerId = null
    this.hidePreview()
  }

  /**
   * Capture-phase pointerdown handler. Intercepts clicks inside the grid while
   * a formula is being edited: a primary-button click on a data cell starts a
   * reference pick (and a potential drag-to-range); non-primary-button clicks
   * and clicks on grid chrome are swallowed so the editor stays open and
   * focused without inserting a reference. The event is always stopped from
   * reaching Handsontable, which would otherwise close the editor and move the
   * selection. Only the primary pointer with button 0 (left mouse / touch)
   * starts a pick — right-click and auxiliary buttons are suppressed but never
   * initiate a drag.
   */
  onPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement | null
    // Only handle clicks within this grid. Clicks outside (formula bar, page)
    // fall through and the editor closes normally.
    if (!target || !this.hot.rootElement.contains(target)) return

    // Prevent Handsontable from receiving the gesture: it would close the
    // editor and move the selection to the clicked cell.
    event.stopPropagation()
    event.preventDefault()

    // Only the primary pointer / left button starts a reference pick. Other
    // buttons (right-click, middle, eraser) are swallowed so the editor stays
    // open but no reference is inserted and no drag begins.
    if (!event.isPrimary || event.button !== 0) {
      this.options.refocusEditor()
      return
    }

    const coords = this.cellCoordsFromTarget(target)
    if (!coords) {
      // Clicked grid chrome (header, corner, scrollbar) — keep the editor
      // open and focused without inserting a reference.
      this.options.refocusEditor()
      return
    }

    this._anchor = coords
    this._current = coords
    this._activePointerId = event.pointerId
    this.showPreview(coords.row, coords.col, coords.row, coords.col)
    const doc = this.hot.rootDocument
    doc.addEventListener('pointermove', this._onPointerMove, true)
    doc.addEventListener('pointerup', this._onPointerUp, true)
    doc.addEventListener('pointercancel', this._onPointerCancel, true)
    // Abort the drag if the window loses focus (alt-tab, dialog, etc.) so the
    // marquee and listeners do not leak.
    doc.defaultView?.addEventListener('blur', this._onBlur)
  }

  /**
   * Capture-phase `mousedown` suppressor. Handsontable drives cell selection
   * and editor closure from native `mousedown`; `pointerdown`'s
   * `preventDefault()` only suppresses compatibility mouse events in normal
   * primary-pointer cases, so a separate capture-phase `mousedown` listener is
   * required to reliably block Handsontable's mouse path during formula
   * editing. This method ONLY suppresses the event (stop propagation +
   * prevent default + refocus the editor) — it never starts a pick, since
   * `pointerdown`/`pointerup` own the drag. Returns true when it swallowed the
   * event, false when it let it pass (target outside the grid).
   */
  suppressMouseDown(event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null
    if (!target || !this.hot.rootElement.contains(target)) return false
    event.stopPropagation()
    event.preventDefault()
    this.options.refocusEditor()
    return true
  }

  /** Remove the drag listeners without committing (used on editor close). */
  detachDragListeners(): void {
    const doc = this.hot.rootDocument
    doc.removeEventListener('pointermove', this._onPointerMove, true)
    doc.removeEventListener('pointerup', this._onPointerUp, true)
    doc.removeEventListener('pointercancel', this._onPointerCancel, true)
    doc.defaultView?.removeEventListener('blur', this._onBlur)
  }

  onPointerMove(event: PointerEvent): void {
    if (!this._anchor) return
    // Ignore moves from a different pointer (e.g. a second touch).
    if (this._activePointerId !== null && event.pointerId !== this._activePointerId)
      return
    const coords = this.cellCoordsFromPoint(event.clientX, event.clientY)
    if (!coords) return // pointer left the data area; keep the last preview
    this._current = coords
    this.showPreview(
      this._anchor.row,
      this._anchor.col,
      coords.row,
      coords.col,
    )
  }

  onPointerUp(event: PointerEvent): void {
    // Ignore up from a different pointer than the one that started the drag.
    if (this._activePointerId !== null && event.pointerId !== this._activePointerId)
      return
    event.stopPropagation()
    const anchor = this._anchor
    const current = this._current
    this.abortDrag()
    if (!anchor) return
    const end = current ?? anchor
    const colorIndex = this._references.length % REFERENCE_COLORS.length
    const ref = buildReference(
      this.options.getSheetName(),
      anchor.row,
      anchor.col,
      end.row,
      end.col,
      colorIndex,
    )
    this.applyHighlight(ref)
    this._references.push(ref)
    this.options.insertReference(ref.a1)
    this.options.refocusEditor()
  }

  /**
   * Idempotently cancel an in-progress drag without committing a reference.
   * Detaches the `pointermove`/`pointerup`/`pointercancel`/`blur` listeners,
   * clears the anchor/extent/pointer id, and hides the marquee. Called on
   * `pointercancel`, window blur, and editor close/destroy, in addition to the
   * `pointerup` path (which captures the anchor first, then aborts, then
   * commits). Safe to call when no drag is in progress.
   */
  abortDrag(event?: PointerEvent): void {
    if (event) event.stopPropagation()
    this.detachDragListeners()
    this._anchor = null
    this._current = null
    this._activePointerId = null
    this.hidePreview()
  }

  /**
   * Resolve the data-cell coordinates under a target element, or null if the
   * target is not a rendered data cell (headers, corners, etc.).
   */
  private cellCoordsFromTarget(target: HTMLElement): {
    row: number
    col: number
  } | null {
    if (target.tagName !== 'TD') return null
    const coords = this.hot.getCoords(target)
    if (!coords) return null
    if (coords.row === null || coords.row < 0) return null
    if (coords.col === null || coords.col < 0) return null
    return { row: coords.row, col: coords.col }
  }

  /**
   * Resolve the data-cell coordinates under a screen point by inspecting the
   * element stack at (x, y). Uses `elementsFromPoint` so a transparent editor
   * textarea or overlay over the cell does not obscure the underlying TD.
   */
  private cellCoordsFromPoint(
    x: number,
    y: number,
  ): { row: number; col: number } | null {
    const doc = this.hot.rootDocument
    const stack =
      typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(x, y)
        : [doc.elementFromPoint(x, y)]
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue
      if (!this.hot.rootElement.contains(el)) continue
      const coords = this.cellCoordsFromTarget(el)
      if (coords) return coords
    }
    return null
  }

  /**
   * Draw a persistent coloured overlay around a committed reference. The
   * overlay is a pointer-events-none div with a dashed border and translucent
   * fill, appended to the grid root element — the same approach as the drag
   * marquee, but kept visible for the lifetime of the edit.
   */
  private applyHighlight(ref: PickedReference): void {
    const color = REFERENCE_COLORS[ref.colorIndex] ?? REFERENCE_COLORS[0]
    const root = this.hot.rootElement
    const el = root.ownerDocument.createElement('div')
    el.className = 'sheetbase-ref-highlight'
    el.style.position = 'absolute'
    el.style.pointerEvents = 'none'
    el.style.boxSizing = 'border-box'
    el.style.zIndex = '5'
    el.style.border = `2px dashed ${color}`
    el.style.background = `${color}1a` // ~10% alpha
    if (
      !this.positionOverlay(
        el,
        ref.startRow,
        ref.startCol,
        ref.endRow,
        ref.endCol,
      )
    ) {
      // Cell not in the rendered viewport yet; hide the overlay until a scroll
      // /resize brings it into view (see repositionHighlights).
      el.style.display = 'none'
    }
    root.appendChild(el)
    this._overlays.push({ ref, element: el })
    this.attachRepositionListeners()
  }

  /**
   * Remove every reference overlay added during this edit and detach the
   * scroll/resize reposition listeners. Safe to call when no overlays exist.
   */
  clearAllHighlights(): void {
    for (const { element } of this._overlays) element.remove()
    this._overlays = []
    this._references = []
    this.detachRepositionListeners()
  }

  /**
   * Recompute the position of every committed reference overlay from the
   * current cell geometry. Called on grid scroll and window resize so overlays
   * track their cells. Overlays whose cells are not in the rendered viewport
   * are hidden until the next reposition brings them into view.
   */
  repositionHighlights(): void {
    for (const { ref, element } of this._overlays) {
      const visible = this.positionOverlay(
        element,
        ref.startRow,
        ref.startCol,
        ref.endRow,
        ref.endCol,
      )
      element.style.display = visible ? '' : 'none'
    }
  }

  /** Attach scroll/resize listeners if not already attached. */
  private attachRepositionListeners(): void {
    if (this._repositionAttached) return
    // Capture phase catches scroll from Handsontable's internal scroll
    // containers (scroll events do not bubble).
    this.hot.rootElement.addEventListener('scroll', this._onScroll, true)
    this.hot.rootDocument.defaultView?.addEventListener('resize', this._onResize)
    this._repositionAttached = true
  }

  /** Detach scroll/resize listeners if attached. */
  private detachRepositionListeners(): void {
    if (!this._repositionAttached) return
    this.hot.rootElement.removeEventListener('scroll', this._onScroll, true)
    this.hot.rootDocument.defaultView?.removeEventListener(
      'resize',
      this._onResize,
    )
    this._repositionAttached = false
  }

  /**
   * Position an overlay element over a cell range, computing its rectangle
   * from the rendered TD elements relative to the grid root. Returns true if
   * both corners were found and positioned, false if the cells are outside the
   * rendered viewport. Shared by the drag marquee and persistent highlights.
   */
  private positionOverlay(
    element: HTMLDivElement,
    rowA: number,
    colA: number,
    rowB: number,
    colB: number,
  ): boolean {
    const { startRow, startCol, endRow, endCol } = normalizeRange(
      rowA,
      colA,
      rowB,
      colB,
    )
    const startCell = this.hot.getCell(startRow, startCol)
    const endCell = this.hot.getCell(endRow, endCol)
    if (!startCell || !endCell) return false
    const root = this.hot.rootElement
    if (getComputedStyle(root).position === 'static') {
      root.style.position = 'relative'
    }
    const rootRect = root.getBoundingClientRect()
    const startRect = startCell.getBoundingClientRect()
    const endRect = endCell.getBoundingClientRect()
    const left = Math.min(startRect.left, endRect.left) - rootRect.left
    const top = Math.min(startRect.top, endRect.top) - rootRect.top
    const right = Math.max(startRect.right, endRect.right) - rootRect.left
    const bottom = Math.max(startRect.bottom, endRect.bottom) - rootRect.top
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.width = `${right - left}px`
    element.style.height = `${bottom - top}px`
    return true
  }

  /**
   * Position (or update) the live marquee overlay over a drag extent. The
   * overlay is a pointer-events-none div appended to the grid root element so
   * it never blocks pointer events from reaching the cells beneath it.
   */
  private showPreview(
    rowA: number,
    colA: number,
    rowB: number,
    colB: number,
  ): void {
    const color =
      REFERENCE_COLORS[this._references.length % REFERENCE_COLORS.length] ??
      REFERENCE_COLORS[0]
    if (!this._preview) {
      const root = this.hot.rootElement
      const el = root.ownerDocument.createElement('div')
      el.className = 'sheetbase-ref-preview'
      el.style.position = 'absolute'
      el.style.pointerEvents = 'none'
      el.style.boxSizing = 'border-box'
      el.style.zIndex = '5'
      el.style.border = `2px dashed ${color}`
      el.style.background = `${color}1a` // ~10% alpha
      root.appendChild(el)
      this._preview = el
    }
    this.positionOverlay(this._preview, rowA, colA, rowB, colB)
  }

  /** Remove the live marquee overlay. */
  hidePreview(): void {
    if (this._preview) {
      this._preview.remove()
      this._preview = null
    }
  }
}

/**
 * A custom Handsontable editor that adds Excel-like point-and-click (and
 * click-drag) formula reference picking to the standard {@link TextEditor}.
 *
 * When the user types `=` to start a formula, clicking another cell in the same
 * grid inserts that cell's A1 reference (e.g. `B3`) at the cursor instead of
 * closing the editor. Click-dragging inserts a RANGE reference (e.g. `A1:A5`).
 * Each referenced cell or range gets a persistent coloured overlay (a dashed
 * border + translucent fill, a distinct colour per reference) that stays
 * visible until the editor commits or cancels.
 * Typing operators (`+`, `-`, etc.) then clicking continues building the
 * formula with additional highlighted references.
 *
 * The editor works within Handsontable's editor lifecycle: Enter commits
 * through the normal `afterChange` pipeline, Escape cancels natively, and the
 * editor keeps focus throughout reference picking. A capture-phase listener on
 * the document intercepts cell clicks before Handsontable processes them; each
 * instance is scoped to its own grid via `hot.rootElement.contains(target)`.
 */
export class FormulaReferenceEditor extends TextEditor {
  static get EDITOR_TYPE(): string {
    return 'formulaReference'
  }

  private _picker: ReferencePicker | null = null
  /** Capture-phase pointerdown: owns the reference-pick drag. */
  private _onPointerDown = (event: PointerEvent): void => {
    this.handlePointerDown(event)
  }
  /**
   * Capture-phase mousedown: suppresses Handsontable's native mouse path
   * (cell selection / editor closure) during formula editing. Does NOT start a
   * pick — `pointerdown`/`pointerup` own the drag.
   */
  private _onMouseDown = (event: MouseEvent): void => {
    this.handleMouseDown(event)
  }

  open(): void {
    super.open()
    if (!this._picker) {
      this._picker = new ReferencePicker(this.hot, {
        getSheetName: () => this.currentSheetName(),
        insertReference: (a1) => this.insertReference(a1),
        refocusEditor: () => this.focus(),
      })
    }
    this._picker.reset()
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
   * Normalise `**` to `^` in the editor value before it is committed through
   * the `afterChange` pipeline. Only applies to formula values (starting with
   * `=`) and only on a real commit (not when reverting via Escape). The
   * canonical `^` form is what gets stored and displayed.
   */
  override finishEditing(
    restoreOriginalValue?: boolean,
    ctrlDown?: boolean,
    callback?: (() => void) | undefined,
  ): void {
    if (!restoreOriginalValue && this.isFormulaMode()) {
      const value = String(this.getValue() ?? '')
      const normalized = normalizeExponentiation(value)
      if (normalized !== value) {
        this.setValue(normalized)
        this.TEXTAREA.value = normalized
      }
    }
    super.finishEditing(restoreOriginalValue, ctrlDown, callback)
  }

  /** Remove listeners, abort any in-progress drag, and clear all highlights. */
  private cleanup(): void {
    const doc = this.hot.rootDocument
    doc.removeEventListener('pointerdown', this._onPointerDown, true)
    doc.removeEventListener('mousedown', this._onMouseDown, true)
    // abortDrag detaches the drag listeners, clears the marquee, and resets
    // the drag state — covering pointercancel/blur/teardown in one call.
    this._picker?.abortDrag()
    this._picker?.clearAllHighlights()
  }

  /**
   * Document capture-phase pointerdown: when the editor is open and the value
   * starts with `=` (formula mode), delegate to the picker so cell clicks and
   * drags build references instead of closing the editor.
   */
  private handlePointerDown(event: PointerEvent): void {
    if (!this.isOpened() || !this.isFormulaMode()) return
    this._picker?.onPointerDown(event)
  }

  /**
   * Document capture-phase mousedown: when the editor is open and in formula
   * mode, suppress the matching `mousedown` so Handsontable's native mouse
   * path (cell selection / editor closure) never fires. `pointerdown`'s
   * `preventDefault()` only suppresses compatibility mouse events in normal
   * primary-pointer cases, so this explicit listener is required for
   * reliability. It never starts a pick.
   */
  private handleMouseDown(event: MouseEvent): void {
    if (!this.isOpened() || !this.isFormulaMode()) return
    this._picker?.suppressMouseDown(event)
  }

  /** True when the current editor value starts with `=`. */
  private isFormulaMode(): boolean {
    return String(this.getValue() ?? '').startsWith('=')
  }

  /**
   * The owning sheet name for references, read from the formulas plugin.
   * Single-sheet formulas render plain A1 text; the name is recorded on each
   * {@link PickedReference} so a future cross-sheet picker can qualify it.
   */
  private currentSheetName(): string {
    const formulas = this.hot.getPlugin('formulas') as
      | { sheetName?: string | null }
      | undefined
    return formulas?.sheetName ?? ''
  }

  /**
   * Insert an A1 reference string at the current cursor position in the editor
   * textarea, then move the cursor to just after the inserted reference and
   * resize the textarea to fit the new content.
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
    this.autoResize.resize()
  }
}
