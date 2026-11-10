import { REFERENCE_COLORS } from './reference-colors'

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
 * Convert A1 column letters to a 0-indexed column number.
 * "A" → 0, "B" → 1, "Z" → 25, "AA" → 26, "LOG" → 9001, etc.
 */
export function letterToColumn(letters: string): number {
  let col = 0

  for (let i = 0; i < letters.length; i++)
    col = col * 26 + (letters.charCodeAt(i) - 64)

  return col - 1
}

/**
 * Shift A1 cell references in a formula expression by a row and/or column
 * offset.  Absolute references (with `$`) are not shifted.  Function names
 * (letters+digits immediately followed by `(`) are left alone so that e.g.
 * `LOG10(` is not mistaken for cell `LOG10`.
 *
 * Used by the paste hook to translate relative references when a formula
 * is pasted into a different row/column.
 */
export function shiftFormulaReferences(
  formula: string,
  rowOffset: number,
  colOffset: number,
): string {
  if (rowOffset === 0 && colOffset === 0) return formula

  return formula.replace(
    /"(?:[^"]|"")*"|'(?:[^']|'')*'|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g,
    (
      match: string,
      colDollar: string | undefined,
      letters: string | undefined,
      rowDollar: string | undefined,
      rowStr: string | undefined,
    ) => {
      // Quoted strings and sheet identifiers have no reference capture groups.
      if (
        colDollar === undefined ||
        letters === undefined ||
        rowDollar === undefined ||
        rowStr === undefined
      )
        return match
      const col = letterToColumn(letters)
      const row = parseInt(rowStr, 10) - 1 // convert to 0-indexed
      const newCol = colDollar ? col : col + colOffset
      const newRow = rowDollar ? row : row + rowOffset

      if (newCol < 0 || newRow < 0) return match // refuse negative refs

      return `${colDollar}${columnToLetter(newCol)}${rowDollar}${newRow + 1}`
    },
  )
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
) {
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

  if (startRow === endRow && startCol === endCol)
    return toA1(startRow, startCol)

  return `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`
}

/**
 * Accent colours used to outline picked references (see
 * `./reference-colors`). Re-exported here so the editor module owns the
 * picker's public surface.
 */
export { REFERENCE_COLORS } from './reference-colors'

/**
 * A single reference picked while editing a formula.
 *
 * `sheet` records the owning sheet name so that a future cross-sheet picker
 * can qualify references as `Sheet!A1`. Single-sheet formulas render the plain
 * A1 text and never emit the sheet prefix.
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

/** The engine's rendered column-header element is not a data cell. */
const GRID_CELL_SELECTOR = '[role="gridcell"]'

/** The engine's absolutely positioned cell layer (`position: relative`). */
export const GRID_CANVAS_SELECTOR = '.grid-canvas'

/** The engine's scrolling grid frame (`position: relative; overflow: auto`). */
const GRID_ROOT_SELECTOR = '.spreadsheet'

/**
 * The slice of the grid's DOM that {@link ReferencePicker} needs. Declared
 * structurally so the real grid satisfies it without casts, while unit tests
 * can supply a lightweight mock.
 *
 * The engine renders data cells as absolutely positioned
 * `div[role="gridcell"][aria-rowindex][aria-colindex]` elements inside a
 * `.grid-canvas` layer; only cells in the rendered viewport are in the DOM.
 */
export interface ReferenceGridHost {
  /** The cell layer geometry and overlays are positioned against. */
  readonly rootElement: HTMLElement
  readonly rootDocument: Document
  /** The data cell containing (or equal to) an element, or null for chrome. */
  getCoords: (
    element: HTMLElement,
  ) => { row: number | null; col: number | null } | null
  /** The rendered data cell at a viewport cell, or null when not rendered. */
  getCell: (row: number, col: number) => HTMLElement | null
  countRows: () => number
  countCols: () => number
}

/** Read a numeric grid-count attribute from the grid root, defaulting to 0. */
function gridCount(canvas: HTMLElement, attribute: string): number {
  const root = canvas.closest<HTMLElement>(GRID_ROOT_SELECTOR) ?? canvas
  const value = Number(root.getAttribute(attribute))

  return Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Build a {@link ReferenceGridHost} from the engine's rendered cell layer.
 * Coord lookups read the ARIA row/column indices the engine puts on every
 * rendered `gridcell`, so they stay correct under frozen panes and column
 * moves (the indices are display positions, which is what references use).
 */
export function createReferenceGridHost(
  canvas: HTMLElement,
): ReferenceGridHost {
  return {
    rootElement: canvas,
    rootDocument: canvas.ownerDocument,
    getCoords: (element) => {
      const cell = element.closest<HTMLElement>(GRID_CELL_SELECTOR)

      if (!cell) return null
      const row = Number(cell.getAttribute('aria-rowindex')) - 1
      const col = Number(cell.getAttribute('aria-colindex')) - 1

      if (!Number.isInteger(row) || !Number.isInteger(col)) return null

      return { row, col }
    },
    getCell: (row, col) => {
      if (row < 0 || col < 0) return null

      return canvas.querySelector<HTMLElement>(
        `${GRID_CELL_SELECTOR}[aria-rowindex="${row + 1}"][aria-colindex="${col + 1}"]`,
      )
    },
    countRows: () => gridCount(canvas, 'aria-rowcount'),
    countCols: () => gridCount(canvas, 'aria-colcount'),
  }
}

/** A live preview overlay + the set of committed reference highlights. */
interface PickerOptions {
  /** Returns the owning sheet name for new references (cross-sheet ready). */
  getSheetName: () => string
  /** Inserts the A1 text at the editor cursor. */
  insertReference: (a1: string) => void
  /** Returns focus to the editor input. */
  refocusEditor: () => void
}

/**
 * Manages the Excel-like reference-picking interaction for an in-cell formula
 * edit, decoupled from the editor input.
 *
 * The picker tracks the anchor cell of an in-progress click-drag, renders a
 * live marquee overlay while dragging, and on release commits a reference
 * (single cell or range) with a persistent coloured overlay (a dashed border +
 * translucent fill, like Excel). Multiple references each keep their own
 * overlay for the lifetime of the edit; {@link clearAllHighlights} removes
 * them all. Overlays are plain divs positioned relative to the cell layer —
 * not engine selection borders — so they work with any column type and never
 * interfere with the grid's internal event system.
 */
export class ReferencePicker {
  private readonly hot: ReferenceGridHost
  private readonly options: PickerOptions
  /** References committed during this edit, in insertion order. */
  private _references: PickedReference[] = []
  /** Overlay divs for committed references, paired with their references. */
  private _overlays: Array<{ ref: PickedReference; element: HTMLDivElement }> =
    []
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
  /** Bound scroll listener (capture: grid scrolling does not bubble). */
  private readonly _onScroll = () => this.repositionHighlights()
  /** Bound window resize listener (repositions overlays on viewport changes). */
  private readonly _onResize = () => this.repositionHighlights()

  constructor(hot: ReferenceGridHost, options: PickerOptions) {
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
   * Capture-phase pointerdown handler. Intercepts clicks inside the cell layer
   * while a formula is being edited: a primary-button click on a data cell
   * starts a reference pick (and a potential drag-to-range); clicks on grid
   * chrome (fill handle, headers, scrollbars) are left untouched so the grid's
   * own features keep working even if the editor is stale-open. Non-primary
   * button clicks on data cells are swallowed so the editor stays open and
   * focused without inserting a reference. Only the primary pointer with
   * button 0 (left mouse / touch) starts a pick — right-click and auxiliary
   * buttons are suppressed but never initiate a drag.
   */
  onPointerDown(event: PointerEvent): void {
    const target = event.target

    // Only handle clicks within this cell layer. Clicks outside (formula bar,
    // page) fall through and the editor closes normally.
    if (
      !(target instanceof HTMLElement) ||
      !this.hot.rootElement.contains(target)
    )
      return

    // Grid chrome — the fill handle (`button.fill-handle`), headers
    // (`role="rowheader"` / `role="columnheader"`), the select-all corner and
    // scrollbars — is never a `gridcell`, so it falls through to the grid.
    // This is checked BEFORE stopPropagation/preventDefault so chrome events
    // are never suppressed.
    const coords = this.cellCoordsFromTarget(target)

    if (!coords) return

    // Prevent the grid from receiving the gesture on data cells: it would
    // close the editor and move the selection to the clicked cell.
    event.stopPropagation()
    event.preventDefault()

    // Only the primary pointer / left button starts a reference pick. Other
    // buttons (right-click, middle, eraser) are swallowed so the editor stays
    // open but no reference is inserted and no drag begins.
    if (!event.isPrimary || event.button !== 0) {
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
   * Capture-phase `mousedown` suppressor. The grid drives cell selection and
   * editor closure from native `mousedown`; `pointerdown`'s `preventDefault()`
   * only suppresses compatibility mouse events in normal primary-pointer cases,
   * so a separate capture-phase `mousedown` listener is required to reliably
   * block the grid's mouse path during formula editing. This method ONLY
   * suppresses the event on actual data cells (elements inside a `gridcell`) —
   * it never stops `mousedown` on grid chrome like the fill handle, headers, or
   * scrollbars, so features like autofill keep working even if the editor is
   * stale-open. Returns true when it swallowed the event, false when it let it
   * pass.
   */
  suppressMouseDown(event: MouseEvent): boolean {
    const target = event.target

    if (
      !(target instanceof HTMLElement) ||
      !this.hot.rootElement.contains(target)
    )
      return false

    // Only suppress mousedowns on actual data cells. Grid chrome (fill handle,
    // headers, borders, etc.) must pass through to the grid so autofill and
    // other features work even with a stale-open editor.
    if (!this.cellCoordsFromTarget(target)) return false
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
    if (
      this._activePointerId !== null &&
      event.pointerId !== this._activePointerId
    )
      return
    const coords = this.cellCoordsFromPoint(event.clientX, event.clientY)

    if (!coords) return // pointer left the data area; keep the last preview
    this._current = coords
    this.showPreview(this._anchor.row, this._anchor.col, coords.row, coords.col)
  }

  onPointerUp(event: PointerEvent): void {
    // Ignore up from a different pointer than the one that started the drag.
    if (
      this._activePointerId !== null &&
      event.pointerId !== this._activePointerId
    )
      return
    event.stopPropagation()
    const anchor = this._anchor
    const current = this._current
    this.abortDrag()

    if (!anchor) return
    const end = current ?? anchor
    this.commitRange(anchor.row, anchor.col, end.row, end.col)
    // The pointer path must refocus the editor (the input lost focus to the
    // grid during the click-drag). The keyboard path (pickCell) keeps focus in
    // the input and does NOT refocus.
    this.options.refocusEditor()
  }

  /**
   * Commit a single-cell reference picked via the keyboard (arrow keys). Does
   * NOT refocus the editor — the input already has focus during keyboard
   * reference picking. Used by the in-cell editor's arrow-key handler so that
   * typing `=` and pressing an arrow inserts the referenced cell's A1 notation
   * instead of moving the input cursor.
   */
  pickCell(row: number, col: number): void {
    this.commitRange(row, col, row, col)
  }

  /** Commit a keyboard-selected range without changing input focus. */
  pickRange(rowA: number, colA: number, rowB: number, colB: number): void {
    this.commitRange(rowA, colA, rowB, colB)
  }

  /**
   * Build, highlight, record, and insert a reference for the given range.
   * Shared by the pointer path ({@link onPointerUp}) and the keyboard path
   * ({@link pickCell}). The caller is responsible for refocusing the editor
   * when needed (pointer path only).
   */
  private commitRange(
    rowA: number,
    colA: number,
    rowB: number,
    colB: number,
  ): void {
    const colorIndex = this._references.length % REFERENCE_COLORS.length

    const ref = buildReference(
      this.options.getSheetName(),
      rowA,
      colA,
      rowB,
      colB,
      colorIndex,
    )

    this.applyHighlight(ref)
    this._references.push(ref)
    this.options.insertReference(ref.a1)
  }

  /**
   * Remove the most recently committed reference and its highlight overlay.
   * Used by the keyboard reference-picking path to replace the last reference
   * when the user presses consecutive arrow keys (Excel-like behaviour:
   * `=A1` then Down replaces `A1` with `A2` instead of appending `A2`).
   * After popping, the next {@link pickCell} call reuses the same colour
   * index because `_references.length` has decreased by one. Returns the
   * removed reference, or null if there are no references to pop.
   */
  popLastReference(): PickedReference | null {
    const ref = this._references.pop() ?? null
    const overlay = this._overlays.pop()

    if (overlay) overlay.element.remove()

    if (this._overlays.length === 0) this.detachRepositionListeners()

    return ref
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
   * target is not inside a rendered data cell (headers, corners, etc.).
   */
  private cellCoordsFromTarget(target: HTMLElement): {
    row: number
    col: number
  } | null {
    const cell = target.closest<HTMLElement>(GRID_CELL_SELECTOR)

    if (!cell || !this.hot.rootElement.contains(cell)) return null
    const coords = this.hot.getCoords(cell)

    if (!coords) return null

    if (coords.row === null || coords.row < 0) return null

    if (coords.col === null || coords.col < 0) return null

    return { row: coords.row, col: coords.col }
  }

  /**
   * Resolve the data-cell coordinates under a screen point by inspecting the
   * element stack at (x, y). Uses `elementsFromPoint` so a transparent editor
   * input or overlay over the cell does not obscure the underlying cell.
   */
  private cellCoordsFromPoint(
    x: number,
    y: number,
  ): { row: number; col: number } | null {
    const doc = this.hot.rootDocument

    const stack = doc.elementsFromPoint(x, y)

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
   * fill, appended to the cell layer — the same approach as the drag marquee,
   * but kept visible for the lifetime of the edit.
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
    // Capture phase catches scroll from the grid's scrolling frame (scroll
    // events do not bubble).
    this.hot.rootDocument.addEventListener('scroll', this._onScroll, true)
    this.hot.rootDocument.defaultView?.addEventListener(
      'resize',
      this._onResize,
    )
    this._repositionAttached = true
  }

  /** Detach scroll/resize listeners if attached. */
  private detachRepositionListeners(): void {
    if (!this._repositionAttached) return
    this.hot.rootDocument.removeEventListener('scroll', this._onScroll, true)
    this.hot.rootDocument.defaultView?.removeEventListener(
      'resize',
      this._onResize,
    )
    this._repositionAttached = false
  }

  /**
   * Position an overlay element over a cell range, computing its rectangle
   * from the rendered cell elements relative to the cell layer. Returns true
   * if both corners were found and positioned, false if the cells are outside
   * the rendered viewport. Shared by the drag marquee and persistent
   * highlights.
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
   * overlay is a pointer-events-none div appended to the cell layer so it
   * never blocks pointer events from reaching the cells beneath it.
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
