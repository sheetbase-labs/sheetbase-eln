import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type Handsontable from 'handsontable/base'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type {
  SheetbaseGridClientProps,
  SheetbaseGridHandle,
} from './sheetbase-grid'
import { SheetbaseGridClient } from './sheetbase-grid-client'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'scrollIntoView',
)
let themeStyle: HTMLStyleElement
beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub as never
  Element.prototype.scrollIntoView = vi.fn()
  themeStyle = document.createElement('style')
  themeStyle.textContent = '.ht-theme-main { --ht-line-height: 1.4; }'
  document.head.append(themeStyle)
})

afterAll(() => {
  themeStyle.remove()
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(
      Element.prototype,
      'scrollIntoView',
      scrollIntoViewDescriptor,
    )
  } else {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  }
})
afterEach(() => cleanup())

const rows = Array.from({ length: 20 }, (_, row) => [
  `local-${row + 1}`,
  `governed-${row + 1}`,
  `derived-${row + 1}`,
])

type ClientOverrides = Partial<SheetbaseGridClientProps>

function mixedProps(overrides: ClientOverrides = {}): SheetbaseGridClientProps {
  return {
    licenseKey: '',
    ariaLabel: '',
    descriptionId: '',
    cutStatusId: '',
    columns: [
      {
        id: 'local',
        label: 'Local observation',
        source: 'local',
        type: 'text',
      },
      {
        id: 'governed',
        label: 'Governed result',
        source: 'bound',
        type: 'text',
      },
      {
        id: 'derived',
        label: 'Derived recovery',
        source: 'calculated',
        type: 'text',
        readOnly: true,
      },
    ],
    rows: rows.map((cells, index) => ({
      id: `row-${index + 1}`,
      cells: [...cells],
    })),
    rowHeaders: true,
    height: 240,
    renderAllRows: true,
    renderAllColumns: true,
    ...overrides,
  }
}

function mountGrid(props: SheetbaseGridClientProps = mixedProps()) {
  const ready: Array<SheetbaseGridHandle | null> = []
  const result = render(
    <>
      <p id="grid-help">Keyboard help</p>
      <p id="cut-status" aria-live="polite" />
      <SheetbaseGridClient
        {...props}
        licenseKey="non-commercial-and-evaluation"
        ariaLabel="Purification summary Sheet"
        descriptionId="grid-help"
        cutStatusId="cut-status"
        onReady={(handle) => {
          ready.push(handle)
        }}
      />
      <button type="button">After grid</button>
    </>,
  )
  const hot = ready.at(-1)?.vendor as Handsontable | undefined
  if (!hot) throw new Error('Handsontable did not initialise.')
  return { ...result, hot }
}

function selectAndFocus(hot: Handsontable, row: number, col: number) {
  act(() => {
    hot.selectCell(row, col)
    hot.listen()
    hot.getFocusManager().focusOnHighlightedCell()
  })
}

function press(
  hot: Handsontable,
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>
  > = {},
) {
  const target = document.activeElement ?? hot.rootElement
  act(() => {
    fireEvent.keyDown(target, { key, ...modifiers })
  })
}

describe('SheetbaseGrid spreadsheet keyboard and selection contract', () => {
  it('owns spreadsheet settings and gives the treegrid an accessible focus contract', () => {
    const { hot, container } = mountGrid()

    expect(hot.getSettings()).toMatchObject({
      selectionMode: 'multiple',
      navigableHeaders: false,
      tabNavigation: true,
      outsideClickDeselects: true,
      enterBeginsEditing: true,
      enterMoves: { row: 1, col: 0 },
      tabMoves: { row: 0, col: 1 },
      autoWrapRow: false,
      autoWrapCol: false,
    })
    expect(hot.rootElement.getAttribute('aria-label')).toBe(
      'Purification summary Sheet',
    )
    expect(hot.rootElement.getAttribute('aria-describedby')).toBe('grid-help')

    selectAndFocus(hot, 3, 1)
    expect(document.activeElement).toBe(hot.getCell(3, 1))
    expect(hot.getCell(3, 1)?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[role="treegrid"]')).toBe(hot.rootElement)
  }, 20_000)

  it('moves, extends, selects rows/columns/all cells, and changes only the active range', () => {
    const { hot } = mountGrid()
    selectAndFocus(hot, 2, 1)

    press(hot, 'ArrowRight')
    expect(hot.getSelectedLast()).toEqual([2, 2, 2, 2])
    press(hot, 'ArrowDown', { shiftKey: true })
    press(hot, 'ArrowDown', { shiftKey: true })
    expect(hot.getSelectedLast()).toEqual([2, 2, 4, 2])

    press(hot, 'Home')
    expect(hot.getSelectedLast()).toEqual([2, 0, 2, 0])
    press(hot, 'End')
    expect(hot.getSelectedLast()).toEqual([2, 2, 2, 2])
    press(hot, 'Home', { ctrlKey: true })
    expect(hot.getSelectedLast()).toEqual([0, 0, 0, 0])
    press(hot, 'End', { ctrlKey: true })
    expect(hot.getSelectedLast()).toEqual([19, 2, 19, 2])

    selectAndFocus(hot, 3, 1)
    press(hot, 'ArrowDown', { ctrlKey: true })
    expect(hot.getSelectedLast()).toEqual([19, 1, 19, 1])
    press(hot, 'ArrowUp', { ctrlKey: true })
    expect(hot.getSelectedLast()).toEqual([0, 1, 0, 1])
    selectAndFocus(hot, 3, 1)
    press(hot, 'ArrowDown', { ctrlKey: true, shiftKey: true })
    expect(hot.getSelectedLast()).toEqual([3, 1, 19, 1])

    selectAndFocus(hot, 4, 1)
    press(hot, ' ', { ctrlKey: true })
    expect(hot.getSelectedLast()).toEqual([-1, 1, 19, 1])
    selectAndFocus(hot, 4, 1)
    press(hot, ' ', { shiftKey: true })
    expect(hot.getSelectedLast()).toEqual([4, -1, 4, 2])
    selectAndFocus(hot, 4, 1)
    press(hot, 'a', { ctrlKey: true })
    expect(hot.getSelectedLast()).toEqual([-1, -1, 19, 2])

    act(() => {
      hot.selectCells([
        [0, 0, 1, 0],
        [5, 1, 5, 1],
      ])
      hot.getFocusManager().focusOnHighlightedCell()
    })
    press(hot, 'ArrowDown', { shiftKey: true })
    expect(hot.getSelected()).toEqual([
      [0, 0, 1, 0],
      [5, 1, 6, 1],
    ])
  }, 30_000)

  it('uses Tab and page navigation without trapping focus at a grid boundary', () => {
    const { hot } = mountGrid()
    selectAndFocus(hot, 0, 0)

    press(hot, 'Tab')
    expect(hot.getSelectedLast()).toEqual([0, 1, 0, 1])
    press(hot, 'Tab', { shiftKey: true })
    expect(hot.getSelectedLast()).toEqual([0, 0, 0, 0])

    press(hot, 'PageDown')
    expect(hot.getSelectedLast()?.[0]).toBeGreaterThan(0)
    press(hot, 'PageUp')
    expect(hot.getSelectedLast()?.[0]).toBe(0)

    selectAndFocus(hot, 0, 2)
    press(hot, 'Tab')
    expect(hot.getSelected()).toBeUndefined()
  }, 20_000)

  it('keeps navigation and edit modes distinct for editable and derived cells', () => {
    const { hot } = mountGrid()
    selectAndFocus(hot, 1, 0)

    press(hot, 'Enter')
    expect(hot.getActiveEditor()?.isOpened()).toBe(true)
    press(hot, 'ArrowRight')
    expect(hot.getSelectedLast()).toEqual([1, 0, 1, 0])
    press(hot, 'Escape')
    expect(hot.getActiveEditor()?.isOpened()).toBe(false)
    expect(hot.getDataAtCell(1, 0)).toBe('local-2')

    selectAndFocus(hot, 1, 0)
    press(hot, 'F2')
    expect(hot.getActiveEditor()?.isOpened()).toBe(true)
    hot.getActiveEditor()?.setValue('edited')
    press(hot, 'Enter')
    expect(hot.getDataAtCell(1, 0)).toBe('edited')
    expect(hot.getSelectedLast()).toEqual([2, 0, 2, 0])

    selectAndFocus(hot, 1, 2)
    press(hot, 'Enter')
    expect(hot.getActiveEditor()?.isOpened() ?? false).toBe(false)
    expect(hot.getSelectedLast()).toEqual([2, 2, 2, 2])
    expect(hot.getDataAtCell(1, 2)).toBe('derived-2')
  }, 20_000)

  it('copies only the active range and blocks partial cuts over read-only state', () => {
    const beforeCut = vi.fn()
    const { hot } = mountGrid(mixedProps({ clipboard: { onCut: beforeCut } }))
    const copyPaste = hot.getPlugin('copyPaste')

    act(() => {
      hot.selectCells([
        [0, 0, 0, 1],
        [2, 1, 3, 2],
      ])
      copyPaste.setCopyableText()
    })
    expect(copyPaste.copyableRanges).toEqual([
      { startRow: 2, startCol: 1, endRow: 3, endCol: 2 },
    ])
    expect(copyPaste.getRangedData(copyPaste.copyableRanges)).toEqual([
      ['governed-3', 'derived-3'],
      ['governed-4', 'derived-4'],
    ])

    const ranges = copyPaste.copyableRanges
    const cutData = copyPaste.getRangedData(ranges)
    expect(hot.runHooks('beforeCut', cutData, ranges)).toBe(false)
    expect(beforeCut).not.toHaveBeenCalled()
    expect(document.getElementById('cut-status')?.textContent).toContain(
      'active range contains read-only or derived cells',
    )
    expect(hot.getDataAtCell(2, 1)).toBe('governed-3')
    expect(hot.getDataAtCell(2, 2)).toBe('derived-3')

    act(() => {
      hot.selectCell(0, 0, 1, 1)
      copyPaste.setCopyableText()
    })
    const editableRanges = copyPaste.copyableRanges
    const editableData = copyPaste.getRangedData(editableRanges)
    expect(hot.runHooks('beforeCut', editableData, editableRanges)).toEqual(
      editableData,
    )
    expect(beforeCut).toHaveBeenCalledOnce()
  }, 20_000)

  it('keeps a fully read-only Sheet keyboard-navigable without changing data', () => {
    const { hot } = mountGrid(mixedProps({ readOnly: true }))
    selectAndFocus(hot, 0, 0)
    press(hot, 'ArrowDown')
    press(hot, 'ArrowRight')
    expect(hot.getSelectedLast()).toEqual([1, 1, 1, 1])
    press(hot, 'Enter')
    expect(hot.getActiveEditor()?.isOpened() ?? false).toBe(false)
    expect(hot.getDataAtCell(1, 1)).toBe('governed-2')

    const copyPaste = hot.getPlugin('copyPaste')
    copyPaste.setCopyableText()
    const ranges = copyPaste.copyableRanges
    expect(
      hot.runHooks('beforeCut', copyPaste.getRangedData(ranges), ranges),
    ).toBe(false)
    expect(hot.getData()).toEqual(rows)
  }, 20_000)
})

describe('SheetbaseGrid bulk-write guards (GRID-02)', () => {
  it('blocks paste into read-only cells and announces why, failing closed', () => {
    const beforeChange = vi.fn()
    const { hot } = mountGrid(mixedProps({ beforeCellsChange: beforeChange }))

    // A paste whose target range reaches the derived column is rejected.
    const pasted: Array<[number, string | number, unknown, unknown]> = [
      [0, 0, null, 'new-local'],
      [0, 2, null, 'new-derived'],
    ]
    expect(hot.runHooks('beforeChange', pasted, 'CopyPaste.paste')).toBe(false)
    expect(beforeChange).not.toHaveBeenCalled()
    expect(document.getElementById('cut-status')?.textContent).toContain(
      'Paste is unavailable',
    )
    expect(hot.getDataAtCell(0, 2)).toBe('derived-1')
  }, 20_000)

  it('blocks fill over read-only cells', () => {
    const { hot } = mountGrid()
    const changes: Array<[number, string | number, unknown, unknown]> = [
      [1, 2, null, 'filled'],
    ]
    expect(hot.runHooks('beforeChange', changes, 'Autofill.fill')).toBe(false)
    expect(document.getElementById('cut-status')?.textContent).toContain(
      'Fill is unavailable',
    )
    expect(hot.getDataAtCell(1, 2)).toBe('derived-2')
  }, 20_000)

  it('allows paste and fill across fully editable ranges', () => {
    const beforeChange = vi.fn().mockReturnValue(true)
    const { hot } = mountGrid(mixedProps({ beforeCellsChange: beforeChange }))
    const changes: Array<[number, string | number, unknown, unknown]> = [
      [0, 0, null, 'pasted'],
    ]
    expect(hot.runHooks('beforeChange', changes, 'CopyPaste.paste')).toBe(true)
    expect(beforeChange).toHaveBeenCalledOnce()
    expect(document.getElementById('cut-status')?.textContent).not.toContain(
      'unavailable',
    )
  }, 20_000)

  it('passes non-bulk changes through to caller hooks untouched', () => {
    const beforeChange = vi.fn().mockReturnValue(true)
    const { hot } = mountGrid(mixedProps({ beforeCellsChange: beforeChange }))
    const changes: Array<[number, string | number, unknown, unknown]> = [
      [0, 2, null, 'typed-derived'],
    ]
    // Keyboard edits keep their existing semantics (editable check lives in
    // the workspace layer); the wrapper only guards bulk-write sources.
    expect(hot.runHooks('beforeChange', changes, 'edit')).toBe(true)
    expect(beforeChange).toHaveBeenCalledOnce()
  }, 20_000)
})
