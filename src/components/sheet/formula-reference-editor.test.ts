import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  REFERENCE_COLORS,
  ReferencePicker,
  buildReference,
  columnToLetter,
  normalizeRange,
  toA1,
  toA1Range,
} from './formula-reference-editor'
import type { HotLike } from './formula-reference-editor'

/** jsdom converts hex border colours to rgb(...) — normalise for assertions. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgb(${r}, ${g}, ${b})`
}

describe('A1 notation helpers', () => {
  it('converts zero-indexed columns to letters', () => {
    expect(columnToLetter(0)).toBe('A')
    expect(columnToLetter(1)).toBe('B')
    expect(columnToLetter(25)).toBe('Z')
    expect(columnToLetter(26)).toBe('AA')
    expect(columnToLetter(27)).toBe('AB')
    expect(columnToLetter(51)).toBe('AZ')
    expect(columnToLetter(52)).toBe('BA')
  })

  it('converts row/col to A1 cell references', () => {
    expect(toA1(0, 0)).toBe('A1')
    expect(toA1(2, 1)).toBe('B3')
    expect(toA1(0, 26)).toBe('AA1')
  })

  it('normalises selection corners to top-left and bottom-right', () => {
    expect(normalizeRange(4, 1, 0, 3)).toEqual({
      startRow: 0,
      startCol: 1,
      endRow: 4,
      endCol: 3,
    })
    expect(normalizeRange(0, 0, 0, 0)).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0,
    })
  })

  it('renders a single cell and a range as A1 text', () => {
    expect(toA1Range(0, 0, 0, 0)).toBe('A1')
    expect(toA1Range(0, 0, 4, 0)).toBe('A1:A5')
    // Corners supplied in any order normalise to the same range.
    expect(toA1Range(4, 0, 0, 0)).toBe('A1:A5')
    expect(toA1Range(0, 1, 2, 3)).toBe('B1:D3')
  })
})

describe('buildReference', () => {
  it('records the owning sheet, normalised coords, and A1 text', () => {
    const ref = buildReference('Sheet1', 4, 0, 0, 0, 2)
    expect(ref).toMatchObject({
      sheet: 'Sheet1',
      startRow: 0,
      startCol: 0,
      endRow: 4,
      endCol: 0,
      a1: 'A1:A5',
      colorIndex: 2,
    })
  })

  it('collapses a single-cell selection to a plain A1 reference', () => {
    expect(buildReference('', 2, 1, 2, 1, 0).a1).toBe('B3')
  })

  it('cycles colour indices without wrapping in buildReference itself', () => {
    expect(buildReference('', 0, 0, 0, 0, REFERENCE_COLORS.length).colorIndex).toBe(
      REFERENCE_COLORS.length,
    )
  })
})

/** Build a mocked HotLike backed by an in-memory grid of TD elements. */
function mockHot(cellGrid: HTMLTableCellElement[][]): {
  hot: HotLike
  root: HTMLElement
  coordsSpy: ReturnType<typeof vi.fn>
} {
  const doc = document
  const root = doc.createElement('div')
  doc.body.appendChild(root)
  for (const row of cellGrid) for (const cell of row) root.appendChild(cell)

  const coordsSpy = vi.fn((el: HTMLElement) => {
    for (let r = 0; r < cellGrid.length; r++) {
      const c = cellGrid[r].indexOf(el as HTMLTableCellElement)
      if (c !== -1) return { row: r, col: c }
    }
    return null
  })
  const hot: HotLike = {
    rootElement: root,
    rootDocument: doc,
    getCoords: coordsSpy,
    getCell: (row, col) => cellGrid[row]?.[col] ?? null,
  }
  return { hot, root, coordsSpy }
}

function td(): HTMLTableCellElement {
  return document.createElement('td')
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  target: HTMLElement | null,
  clientX = 0,
  clientY = 0,
  overrides: Partial<{
    isPrimary: boolean
    button: number
    pointerId: number
  }> = {},
): PointerEvent {
  return {
    type,
    target,
    clientX,
    clientY,
    isPrimary: true,
    button: 0,
    pointerId: 1,
    ...overrides,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as PointerEvent
}

/** Build a mock MouseEvent resembling a capture-phase mousedown. */
function mouseEvent(
  target: HTMLElement | null,
  overrides: Partial<{ button: number; clientX: number; clientY: number }> = {},
): MouseEvent {
  return {
    type: 'mousedown',
    target,
    button: 0,
    clientX: 0,
    clientY: 0,
    ...overrides,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ReferencePicker', () => {
  it('inserts a single-cell reference on a click without a drag', () => {
    const cells = [
      [td(), td(), td()],
      [td(), td(), td()],
    ]
    const { hot, root } = mockHot(cells)
    // Anchor the editor's textarea centre somewhere harmless for elementFromPoint.
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => 'Sheet1',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: vi.fn(),
    })

    const target = cells[1][2] // C2
    root.appendChild(target)
    const event = pointer('pointerdown', target)
    picker.onPointerDown(event)

    // A click (no move) commits immediately on pointerup.
    picker.onPointerUp(pointer('pointerup', target))

    expect(inserted).toEqual(['C2'])
    expect(picker.references).toHaveLength(1)
    expect(picker.references[0]).toMatchObject({
      a1: 'C2',
      startRow: 1,
      startCol: 2,
      endRow: 1,
      endCol: 2,
      sheet: 'Sheet1',
    })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('inserts a range reference after a click-drag and outlines the range', () => {
    const cells = Array.from({ length: 5 }, () => [td()])
    const { hot, root } = mockHot(cells)
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: vi.fn(),
    })

    picker.onPointerDown(pointer('pointerdown', cells[0][0]))
    // Stub elementFromPoint to report the dragged-to cell (A5). jsdom does not
    // implement elementsFromPoint, so install it for the duration of the drag.
    const descriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      writable: true,
      value: () => [cells[4][0] as Element],
    })
    try {
      picker.onPointerMove(pointer('pointermove', null, 10, 90))
      picker.onPointerUp(pointer('pointerup', cells[4][0]))
    } finally {
      if (descriptor) {
        Object.defineProperty(document, 'elementsFromPoint', descriptor)
      } else {
        // @ts-expect-error -- elementsFromPoint is declared on the prototype,
        // not as an own property, so TS rejects the delete even though it is
        // safe here because we defined an own property above.
        delete document.elementsFromPoint
      }
    }

    expect(inserted).toEqual(['A1:A5'])
    // A persistent overlay div is created for the range.
    const highlights = root.querySelectorAll<HTMLDivElement>('.sheetbase-ref-highlight')
    expect(highlights).toHaveLength(1)
    expect(highlights[0].style.border).toContain('dashed')
    expect(highlights[0].style.border).toContain(hexToRgb(REFERENCE_COLORS[0]))
  })

  it('assigns a new colour to each subsequent reference', () => {
    const cells = [
      [td(), td(), td()],
      [td(), td(), td()],
    ]
    const { hot, root } = mockHot(cells)
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: vi.fn(),
    })

    // First reference: B1 (row 0, col 1).
    picker.onPointerDown(pointer('pointerdown', cells[0][1]))
    picker.onPointerUp(pointer('pointerup', cells[0][1]))
    // Second reference: C2 (row 1, col 2).
    picker.onPointerDown(pointer('pointerdown', cells[1][2]))
    picker.onPointerUp(pointer('pointerup', cells[1][2]))

    expect(inserted).toEqual(['B1', 'C2'])
    expect(picker.references).toHaveLength(2)
    const highlights = root.querySelectorAll<HTMLDivElement>('.sheetbase-ref-highlight')
    expect(highlights).toHaveLength(2)
    const firstBorder = highlights[0].style.border
    const secondBorder = highlights[1].style.border
    expect(firstBorder).toContain(hexToRgb(REFERENCE_COLORS[0]))
    expect(secondBorder).toContain(hexToRgb(REFERENCE_COLORS[1]))
    expect(firstBorder).not.toBe(secondBorder)
  })

  it('keeps all committed references until clearAllHighlights removes them', () => {
    const cells = [
      [td(), td()],
      [td(), td()],
    ]
    const { hot, root } = mockHot(cells)
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: vi.fn(),
      refocusEditor: vi.fn(),
    })

    picker.onPointerDown(pointer('pointerdown', cells[0][0]))
    picker.onPointerUp(pointer('pointerup', cells[0][0]))
    picker.onPointerDown(pointer('pointerdown', cells[1][1]))
    picker.onPointerUp(pointer('pointerup', cells[1][1]))
    expect(picker.references).toHaveLength(2)
    expect(root.querySelectorAll('.sheetbase-ref-highlight')).toHaveLength(2)

    picker.clearAllHighlights()
    // All overlay divs are removed.
    expect(root.querySelectorAll('.sheetbase-ref-highlight')).toHaveLength(0)
    expect(picker.references).toHaveLength(0)
  })

  it('ignores clicks on headers and grid chrome but keeps the editor focused', () => {
    const cells = [[td()]]
    const { hot } = mockHot(cells)
    const refocus = vi.fn()
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: refocus,
    })

    // A TH header element is not a TD.
    const header = document.createElement('th')
    hot.rootElement.appendChild(header)
    const event = pointer('pointerdown', header)
    picker.onPointerDown(event)

    expect(inserted).toHaveLength(0)
    expect(picker.references).toHaveLength(0)
    expect(picker.isDragging).toBe(false)
    // The click is still swallowed so the editor does not close.
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(refocus).toHaveBeenCalled()
  })

  it('does not intercept clicks outside its own grid', () => {
    const cells = [[td()]]
    const { hot } = mockHot(cells)
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: vi.fn(),
    })

    const outside = document.createElement('td')
    document.body.appendChild(outside)
    const event = pointer('pointerdown', outside)
    picker.onPointerDown(event)

    // Outside clicks are left for Handsontable/the page to handle.
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it('reset clears references, drag state, and the preview overlay', () => {
    const cells = [[td(), td()]]
    const { hot, root } = mockHot(cells)
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: vi.fn(),
      refocusEditor: vi.fn(),
    })

    picker.onPointerDown(pointer('pointerdown', cells[0][0]))
    // Simulate a drag in progress leaving a preview overlay behind.
    expect(root.querySelector('.sheetbase-ref-preview')).not.toBeNull()
    picker.reset()
    expect(picker.isDragging).toBe(false)
    expect(picker.references).toHaveLength(0)
    expect(root.querySelector('.sheetbase-ref-preview')).toBeNull()
  })

  it('repositionHighlights updates overlay positions from cell geometry', () => {
    const cells = [[td(), td()]]
    const { hot, root } = mockHot(cells)
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: vi.fn(),
      refocusEditor: vi.fn(),
    })

    picker.onPointerDown(pointer('pointerdown', cells[0][1]))
    picker.onPointerUp(pointer('pointerup', cells[0][1]))
    const overlay = root.querySelector('.sheetbase-ref-highlight') as HTMLDivElement
    expect(overlay).not.toBeNull()
    const leftBefore = overlay.style.left

    // Simulate a scroll: move the cell's bounding rect and reposition.
    const originalGetBoundingClientRect =
      cells[0][1].getBoundingClientRect.bind(cells[0][1])
    vi.spyOn(cells[0][1], 'getBoundingClientRect').mockReturnValue({
      ...originalGetBoundingClientRect(),
      left: originalGetBoundingClientRect().left + 50,
      right: originalGetBoundingClientRect().right + 50,
    })
    picker.repositionHighlights()
    const leftAfter = overlay.style.left
    expect(leftAfter).not.toBe(leftBefore)
  })

  it('suppresses mousedown inside the grid without starting a pick', () => {
    const cells = [[td(), td()]]
    const { hot } = mockHot(cells)
    const refocus = vi.fn()
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: refocus,
    })

    const event = mouseEvent(cells[0][1])
    const swallowed = picker.suppressMouseDown(event)

    expect(swallowed).toBe(true)
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(refocus).toHaveBeenCalled()
    // No drag started, no reference inserted.
    expect(picker.isDragging).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it('does not suppress mousedown outside its own grid', () => {
    const cells = [[td()]]
    const { hot } = mockHot(cells)
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: vi.fn(),
      refocusEditor: vi.fn(),
    })

    const outside = document.createElement('td')
    document.body.appendChild(outside)
    const event = mouseEvent(outside)
    expect(picker.suppressMouseDown(event)).toBe(false)
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it('aborts an in-progress drag on pointercancel without committing', () => {
    const cells = [[td(), td()]]
    const { hot, root } = mockHot(cells)
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: vi.fn(),
    })

    picker.onPointerDown(pointer('pointerdown', cells[0][0]))
    expect(picker.isDragging).toBe(true)
    expect(root.querySelector('.sheetbase-ref-preview')).not.toBeNull()

    // pointercancel arrives mid-drag.
    picker.abortDrag(pointer('pointercancel', cells[0][0]))

    expect(picker.isDragging).toBe(false)
    expect(root.querySelector('.sheetbase-ref-preview')).toBeNull()
    expect(inserted).toHaveLength(0)
    expect(picker.references).toHaveLength(0)
  })

  it('abortDrag is idempotent when no drag is in progress', () => {
    const cells = [[td()]]
    const { hot } = mockHot(cells)
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: vi.fn(),
      refocusEditor: vi.fn(),
    })
    // Calling abortDrag with no active drag must not throw.
    expect(() => picker.abortDrag()).not.toThrow()
    expect(picker.isDragging).toBe(false)
  })

  it('rejects non-primary and non-left-button pointerdowns without picking', () => {
    const cells = [[td(), td()]]
    const { hot } = mockHot(cells)
    const refocus = vi.fn()
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: refocus,
    })

    // Right-click (button 2, primary): swallowed, no pick.
    const rightClick = pointer('pointerdown', cells[0][1], 0, 0, {
      button: 2,
    })
    picker.onPointerDown(rightClick)
    expect(rightClick.stopPropagation).toHaveBeenCalled()
    expect(rightClick.preventDefault).toHaveBeenCalled()
    expect(picker.isDragging).toBe(false)
    expect(inserted).toHaveLength(0)
    expect(refocus).toHaveBeenCalled()

    // Non-primary pointer (e.g. second touch): swallowed, no pick.
    const secondTouch = pointer('pointerdown', cells[0][1], 0, 0, {
      isPrimary: false,
      pointerId: 2,
    })
    picker.onPointerDown(secondTouch)
    expect(secondTouch.stopPropagation).toHaveBeenCalled()
    expect(picker.isDragging).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it('ignores pointermove/pointerup from a different pointer id', () => {
    const cells = [[td(), td()]]
    const { hot } = mockHot(cells)
    const inserted: string[] = []
    const picker = new ReferencePicker(hot, {
      getSheetName: () => '',
      insertReference: (a1) => inserted.push(a1),
      refocusEditor: vi.fn(),
    })

    // Start a drag with pointer id 1.
    picker.onPointerDown(pointer('pointerdown', cells[0][0], 0, 0, {
      pointerId: 1,
    }))
    // A pointerup from a different pointer (id 2) must not commit.
    picker.onPointerUp(pointer('pointerup', cells[0][0], 0, 0, {
      pointerId: 2,
    }))
    expect(picker.isDragging).toBe(true)
    expect(inserted).toHaveLength(0)

    // The matching pointerup (id 1) commits.
    picker.onPointerUp(pointer('pointerup', cells[0][0], 0, 0, {
      pointerId: 1,
    }))
    expect(inserted).toEqual(['A1'])
    expect(picker.isDragging).toBe(false)
  })
})
