import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpreadsheetClipboardPayload } from '@sheetbase-labs/sheetbase-table'

import type {
  SheetbaseGridCellValue,
  SheetbaseGridClipboardRange,
  SheetbaseGridHandle,
  SheetbaseGridProps,
} from './sheetbase-grid'
import { sheetbaseGridCellValueSchema } from './grid-client-values'
import { SheetbaseTableGridClient } from './sheetbase-table-grid-client'
import { useGridLayout } from './grid-client-layout'
import { gridClipboard } from './grid-client-clipboard'
import {
  captureGridFilters,
  gridQuery,
  gridSelection,
} from './grid-client-presentation'
import { gridWrites } from './grid-client-writes'
import { useGridEditors } from './grid-client-editors'

// jsdom supplies no geometry. Give the real engine/virtualizer a viewport;
// neither Spreadsheet nor any provider is replaced by a props recorder.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 1200, 2400),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const columns: SheetbaseGridProps['columns'] = [
  { id: 'alpha', label: 'Alpha', source: 'bound', type: 'text' },
  { id: 'beta', label: 'Beta', source: 'bound', type: 'number' },
  {
    id: 'record',
    label: 'Sample',
    source: 'bound',
    type: 'record',
    readOnly: true,
  },
]

const rows: SheetbaseGridProps['rows'] = [
  { id: 'row-1', cells: ['a1', 1, 'rec-1'] },
  { id: 'row-2', cells: ['a2', 2, 'rec-2'] },
]

function baseProps(
  overrides: Partial<SheetbaseGridProps> = {},
): SheetbaseGridProps {
  return { columns, rows, ...overrides }
}

function liveGrid(overrides: Partial<SheetbaseGridProps> = {}) {
  const onReady = vi.fn<(handle: SheetbaseGridHandle | null) => void>()

  const view = render(
    <SheetbaseTableGridClient {...baseProps({ ...overrides, onReady })} />,
  )

  const handle = onReady.mock.calls[0]?.[0]

  if (!handle) throw new Error('Expected a live grid handle')

  return { ...view, handle, onReady }
}

function cell(row: number, column: number): HTMLElement {
  const node = document.querySelector<HTMLElement>(
    `[role="gridcell"][aria-rowindex="${row + 1}"][aria-colindex="${column + 1}"]`,
  )

  if (!node) throw new Error(`Missing display cell ${row}:${column}`)

  return node
}

function clipboardPayload(): SpreadsheetClipboardPayload {
  return {
    text: 'a1\tb1\na2\tb2',
    values: [
      ['a1', 'b1'],
      ['a2', 'b2'],
    ],
    range: {
      top: 0,
      left: 0,
      bottom: 1,
      right: 1,
      columnIds: ['alpha', 'beta'],
    },
  }
}

describe('SheetbaseTableGridClient layout props', () => {
  it('forwards height, stretch and row headers to the engine', () => {
    liveGrid({ height: 320, stretch: 'all', rowHeaders: false })
    expect(screen.getByRole('grid').style.height).toBe('320px')
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0)
    expect(cell(0, 0).textContent).toBe('a1')
    // Stretched past the width its short values would fit.
    expect(Number.parseFloat(cell(0, 0).style.width)).toBeGreaterThan(300)
  })

  it('applies a persisted column order to fields, ids and A1 data', () => {
    const props = baseProps({ columnOrder: ['record', 'beta', 'alpha'] })
    const { result } = renderHook(() => useGridLayout(props))
    expect(result.current.fieldIds).toEqual(['record', 'beta', 'alpha'])
    expect(
      result.current.datasetHeader.fields.map((field) => field.id),
    ).toEqual(['record', 'beta', 'alpha'])
    const { handle } = liveGrid(props)
    expect(handle.snapshot().data.get('A1')).toBe('rec-1')
    expect(handle.snapshot().data.get('B1')).toBe('1')
    expect(handle.snapshot().data.get('C1')).toBe('a1')
    expect(cell(0, 0).textContent).toBe('rec-1')
  })

  it('hydrates new persisted rows without remounting or losing stable identities', () => {
    const { handle, rerender, onReady } = liveGrid()
    const engine = screen.getByRole('grid')
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({ onReady, rows: [rows[1], rows[0]] })}
      />,
    )
    expect(handle.snapshot().data.get('A1')).toBe('a2')
    expect(screen.getByRole('grid')).toBe(engine)
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('does not replace live edits when only column metadata changes', () => {
    const { handle, rerender, onReady } = liveGrid()
    act(() => handle.selectCell(0, 0))
    act(() => handle.editActiveInput('waiting for persistence'))
    act(() => handle.commitEdit())
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          columns: columns.map((column) => ({
            ...column,
            label: `${column.label} updated`,
          })),
          onReady,
        })}
      />,
    )
    expect(handle.snapshot().data.get('A1')).toBe('waiting for persistence')
  })

  it('preserves legacy structured display plus scalar, Date, formula and blank input', () => {
    const date = new Date('2026-11-10T12:00:00Z')

    const values: SheetbaseGridCellValue[] = [
      { readings: [0, false, null, 'µg'] },
      [1, 'x'],
      0,
      false,
      null,
      date,
      [1, null, [2, null, 'x'], { amount: 3 }, false],
      [],
      [null],
      '=B1+1',
      '',
    ]

    const valueRows = values.map((value, index) => ({
      id: `value-${index}`,
      cells: [value],
    }))

    const { handle, rerender, onReady } = liveGrid({ rows: valueRows })

    expect(handle.snapshot().data.get('A1')).toBe('[object Object]')
    expect(cell(0, 0).textContent).toBe('[object Object]')
    expect(cell(6, 0).textContent).toBe('1,,2,,x,[object Object],false')
    expect(handle.snapshot().data.get('A2')).toBe('1,x')
    expect(handle.snapshot().data.get('A3')).toBe('0')
    expect(handle.snapshot().data.get('A4')).toBe('false')
    // The engine's sparse store drops empty literals, including neutral null.
    expect(handle.snapshot().data.get('A5')).toBeUndefined()
    expect(handle.snapshot().data.get('A6')).toBe(date.toString())
    expect(handle.snapshot().data.get('A7')).toBe(
      '1,,2,,x,[object Object],false',
    )
    expect(handle.snapshot().data.get('A8')).toBeUndefined()
    expect(handle.snapshot().data.get('A9')).toBeUndefined()
    expect(handle.snapshot().data.get('A10')).toBe('=B1+1')
    expect(handle.snapshot().data.get('A11')).toBeUndefined()

    const mountedData = [...handle.snapshot().data]
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({ rows: [...valueRows], onReady })}
      />,
    )
    expect([...handle.snapshot().data]).toEqual(mountedData)
    expect(valueRows[0].cells[0]).toEqual({ readings: [0, false, null, 'µg'] })
    expect(valueRows[6].cells[0]).toEqual([
      1,
      null,
      [2, null, 'x'],
      { amount: 3 },
      false,
    ])
  })
})

describe('Sheet header chrome (EXP-04.2)', () => {
  const chromeColumns: SheetbaseGridProps['columns'] = [
    {
      id: 'condition',
      label: 'Condition',
      source: 'local',
      type: 'text',
      group: 'This experiment',
    },
    {
      id: 'train',
      label: 'Filter train',
      source: 'local',
      type: 'text',
      group: 'This experiment',
    },
    {
      id: 'turbidity',
      label: 'Turbidity out',
      source: 'bound',
      type: 'number',
      group: 'Results',
      sourceLabel: 'Results · rev 9',
    },
    {
      id: 'yield',
      label: 'Step yield',
      source: 'calculated',
      type: 'number',
      readOnly: true,
      group: 'Derived',
    },
  ]

  const chromeRows: SheetbaseGridProps['rows'] = [
    { id: 'run-1', cells: ['A-50', 'MAT-0418', 6.2, 86] },
  ]

  it('groups contiguous same-source columns and names the dataset in the Source badge', () => {
    const { result } = renderHook(() =>
      useGridLayout(baseProps({ columns: chromeColumns, rows: chromeRows })),
    )

    expect(result.current.columnGroups).toEqual([
      { label: 'This experiment', columns: [0, 1] },
      { label: 'Results', columns: [2] },
      { label: 'Derived', columns: [3] },
    ])
    liveGrid({ columns: chromeColumns, rows: chromeRows })
    expect(screen.getByText('Results · rev 9')).toBeTruthy()
    expect(screen.getByText('This experiment')).toBeTruthy()
  })

  it('marks a calculated column with the ƒx badge and leaves a bound column unmarked', () => {
    liveGrid({ columns: chromeColumns, rows: chromeRows })
    expect(screen.getByText('ƒx')).toBeTruthy()
    expect(cell(0, 3).classList.contains('read-only')).toBe(true)
    expect(cell(0, 2).classList.contains('read-only')).toBe(false)
  })

  it('keeps the ƒx mark on a calculated column when source badges are off', () => {
    liveGrid({
      columns: chromeColumns.map((column) => ({
        ...column,
        showSource: false,
      })),
      rows: chromeRows,
    })

    const look = [...document.querySelectorAll('style')]
      .map((style) => style.textContent)
      .join('\n')

    expect(look).toContain('[aria-label^="D "] .column-heading::after')
    expect(look).toContain('content:"ƒx"')
    expect(look).not.toContain('[aria-label^="C "] .column-heading::after')
  })

  it('marks a changed cell with its save state and retries a failed one', () => {
    const retry = vi.fn()

    liveGrid({
      columns: chromeColumns,
      rows: chromeRows,
      cellBefore: (row, columnId) =>
        row === 0 && columnId === 'turbidity' ? '8.9 NTU' : undefined,
      cellMark: (row, columnId) =>
        row === 0 && columnId === 'turbidity'
          ? { state: 'failed', retry }
          : row === 0 && columnId === 'train'
            ? { state: 'saved' }
            : undefined,
    })

    expect(document.querySelector('[data-write-mark="saved"]')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Save failed. Click to try again.' }),
    )
    expect(retry).toHaveBeenCalledOnce()
  })

  it('rebuilds the group row from the displayed column order', () => {
    const { result } = renderHook(() =>
      useGridLayout(
        baseProps({
          columns: chromeColumns,
          rows: chromeRows,
          columnOrder: ['yield', 'turbidity', 'condition', 'train'],
        }),
      ),
    )

    expect(result.current.columnGroups).toEqual([
      { label: 'Derived', columns: [0] },
      { label: 'Results', columns: [1] },
      { label: 'This experiment', columns: [2, 3] },
    ])
  })

  it('forwards the New-run append row only when the caller sets it', () => {
    const { rerender, onReady } = liveGrid({
      columns: chromeColumns,
      rows: chromeRows,
      spareRows: 1,
    })

    expect(document.querySelector('.append-row')).toBeNull()
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          columns: chromeColumns,
          rows: chromeRows,
          spareRows: 1,
          appendRow: true,
          onReady,
        })}
      />,
    )
    expect(document.querySelector('.append-row')).not.toBeNull()
  })
})

describe('SheetbaseTableGridClient neutral handle', () => {
  it('keeps methods and selection current after the package replaces its handle, and clears on teardown', () => {
    const { handle, rerender, unmount, onReady } = liveGrid()
    act(() => handle.selectCell(1, 1))
    expect(handle.snapshot().selection.focus).toEqual({ row: 1, column: 1 })
    act(() => handle.editActiveInput('5'))
    act(() => handle.commitEdit())
    expect(handle.snapshot().data.get('B2')).toBe('5')
    act(() => handle.editActiveInput('discard'))
    act(() => handle.cancelEdit())
    expect(handle.snapshot().data.get('B2')).toBe('5')
    rerender(
      <SheetbaseTableGridClient {...baseProps({ onReady, spareRows: 3 })} />,
    )
    act(() => handle.selectCell(4, 1))
    expect(handle.snapshot().selection.focus).toEqual({ row: 4, column: 1 })
    expect(onReady).toHaveBeenCalledOnce()
    unmount()
    expect(onReady).toHaveBeenLastCalledWith(null)
  })
})

describe('Sheet comment selection membership', () => {
  it('clears a previous anchor when the engine restores a view with no selection', () => {
    const { result } = renderHook(() => useGridLayout(baseProps()))
    expect(
      gridSelection(
        { address: 'B2', range: 'B2', input: 'previous' },
        result.current.layout,
        null,
        {},
      ),
    ).toMatchObject({ columnId: 'beta' })
    expect(
      gridSelection(
        { address: '', range: '', input: '' },
        result.current.layout,
        null,
        {},
      ),
    ).toBeNull()
  })

  it('resolves each sorted, filtered display row and reordered field independently', () => {
    const props = baseProps({
      columns: [
        { id: 'amount', label: 'Amount', type: 'number', source: 'local' },
        { id: 'group', label: 'Group', type: 'text', source: 'local' },
      ],
      rows: [
        { id: 'row-a', cells: [37, 'keep'] },
        { id: 'row-b', cells: [4, 'hide'] },
        { id: 'row-c', cells: [91, 'keep'] },
        { id: 'row-d', cells: [13, 'keep'] },
      ],
      columnOrder: ['group', 'amount'],
      sorts: [{ columnId: 'amount', direction: 'desc' }],
      filters: [{ columnId: 'group', operator: 'equals', value: 'keep' }],
    })

    const { result } = renderHook(() => useGridLayout(props))
    expect(
      gridSelection(
        { address: 'B3', range: 'B1:B2', input: '91' },
        result.current.layout,
        null,
        gridQuery(props),
      ),
    ).toEqual({
      rowIndex: 2,
      rowId: 'row-c',
      columnId: 'amount',
      input: '91',
      rowIds: ['row-c', 'row-a'],
      columnIds: ['amount'],
    })
    expect(
      gridSelection(
        { address: 'A4', range: 'B3:A2', input: 'keep' },
        result.current.layout,
        null,
        gridQuery(props),
      ),
    ).toEqual({
      rowIndex: 3,
      rowId: 'row-d',
      columnId: 'group',
      input: 'keep',
      rowIds: ['row-a', 'row-d'],
      columnIds: ['group', 'amount'],
    })

    const onSelectionChange =
      vi.fn<NonNullable<SheetbaseGridProps['onSelectionChange']>>()

    const onCellsChange = vi.fn()
    const { handle } = liveGrid({ ...props, onSelectionChange, onCellsChange })
    act(() => handle.selectCell(0, 1))
    act(() => handle.selectCell(1, 1, { extend: true }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rowId: 'row-a',
        columnId: 'amount',
        rowIds: ['row-c', 'row-a'],
      }),
    )
    act(() => handle.selectCell(0, 1))
    act(() => handle.editActiveInput('92'))
    act(() => handle.commitEdit())
    expect(onCellsChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          rowIndex: 2,
          rowId: 'row-c',
          columnId: 'amount',
          previous: '91',
          next: '92',
        }),
      ],
      'edit',
    )
    expect(handle.snapshot().data.get('B3')).toBe('92')
    expect(handle.snapshot().data.get('B1')).toBe('37')
  })
})

describe('Sheet comment markers', () => {
  it('retains all notes arriving after mount without remounting the engine', async () => {
    const { rerender, onReady } = liveGrid()
    const engine = screen.getByRole('grid')
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          onReady,
          annotations: [
            { rowId: 'row-1', columnId: 'alpha', text: 'first' },
            { rowId: 'row-2', columnId: 'beta', text: 'second' },
            { rowId: 'row-2', columnId: 'record', text: 'third' },
          ],
        })}
      />,
    )
    await waitFor(() =>
      expect(document.querySelectorAll('.annotated')).toHaveLength(3),
    )
    expect(cell(0, 0).title).toBe('first')
    expect(cell(1, 1).title).toBe('second')
    expect(cell(1, 2).title).toBe('third')
    expect(screen.getByRole('grid')).toBe(engine)
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('synchronizes a late large range without a nested-render update loop', async () => {
    const rangeRows = Array.from({ length: 64 }, (_, index) => ({
      id: `range-row-${index}`,
      cells: [index],
    }))

    const annotations = rangeRows.map((row, index) => ({
      rowId: row.id,
      columnId: 'alpha',
      text: `Range note ${index}`,
    }))

    const errors = vi.spyOn(console, 'error')

    try {
      const { rerender, onReady } = liveGrid({ rows: rangeRows })
      rerender(
        <SheetbaseTableGridClient
          {...baseProps({ rows: rangeRows, annotations, onReady })}
        />,
      )
      await waitFor(
        () => expect(document.querySelectorAll('.annotated')).toHaveLength(64),
        { timeout: 5000 },
      )
      annotations.forEach((note, index) =>
        expect(cell(index, 0).title).toBe(note.text),
      )
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('maps persisted identities to bound annotations after row and field reorder, never to deleted targets', async () => {
    const annotations = [
      { rowId: 'row-2', columnId: 'beta', text: 'Check recovery' },
    ]

    const { rerender, onReady } = liveGrid({ annotations })
    expect(cell(1, 1).title).toBe('Check recovery')
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          annotations,
          rows: [rows[1], rows[0]],
          columnOrder: ['beta', 'record', 'alpha'],
          onReady,
        })}
      />,
    )
    expect(cell(0, 0).title).toBe('Check recovery')
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          annotations,
          rows: [rows[0]],
          columnOrder: ['beta', 'record', 'alpha'],
          onReady,
        })}
      />,
    )
    await waitFor(() =>
      expect(document.querySelectorAll('.annotated')).toHaveLength(0),
    )
  })

  it('refreshes and removes a visible note through the current identity, without a second persistence callback', async () => {
    const annotations = [
      { rowId: 'row-2', columnId: 'beta', text: 'Check recovery' },
    ]

    const onCellsChange = vi.fn()
    const { rerender, onReady } = liveGrid({ annotations, onCellsChange })
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          annotations: [
            { ...annotations[0], text: 'Resolved: recovery confirmed' },
          ],
          onReady,
          onCellsChange,
        })}
      />,
    )
    await waitFor(() =>
      expect(cell(1, 1).title).toBe('Resolved: recovery confirmed'),
    )
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({ annotations: [], onReady, onCellsChange })}
      />,
    )
    await waitFor(() =>
      expect(document.querySelectorAll('.annotated')).toHaveLength(0),
    )
    expect(onCellsChange).not.toHaveBeenCalled()
  })
})

describe('SheetbaseTableGridClient row hooks', () => {
  it('routes the remove pair through the host preflight and persistence', () => {
    const before = vi.fn(() => false)
    const removed = vi.fn()

    const props = baseProps({
      onBeforeRowsRemove: before,
      onRowsRemoved: removed,
    })

    const { result } = renderHook(() => useGridLayout(props))
    const writes = gridWrites(props, result.current.layout)
    expect(writes.onBeforeRowsRemove(1, 1)).toBe(false)
    expect(before).toHaveBeenCalledWith(1, 1)
    writes.onRowsRemoved(1, 1)
    expect(removed).toHaveBeenCalledWith(1, 1, 'edit')
  })

  it('routes the insert pair through the host preflight and persistence', () => {
    const before = vi.fn()
    const inserted = vi.fn()

    const props = baseProps({
      onBeforeRowsInsert: before,
      onRowsInserted: inserted,
    })

    const { result } = renderHook(() => useGridLayout(props))
    const writes = gridWrites(props, result.current.layout)
    expect(writes.onBeforeRowsInsert(0, 2)).toBeUndefined()
    expect(before).toHaveBeenCalledWith(0, 2)
    writes.onRowsInserted(0, 2)
    expect(inserted).toHaveBeenCalledWith(0, 2, 'edit')
  })
})

describe('SheetbaseTableGridClient clipboard transforms', () => {
  it('re-serialises a returned copy transform for the engine', () => {
    const onCopy = vi.fn(
      (
        data: SheetbaseGridCellValue[][],
        _range: SheetbaseGridClipboardRange,
      ) => {
        data[0][0] = '=SUM(A1:A2)'

        return data
      },
    )

    const result = gridClipboard(baseProps({ clipboard: { onCopy } })).onCopy?.(
      clipboardPayload(),
    )

    expect(result).toMatchObject({
      text: '=SUM(A1:A2)\tb1\na2\tb2',
      values: [
        ['=SUM(A1:A2)', 'b1'],
        ['a2', 'b2'],
      ],
    })
    expect(onCopy.mock.calls[0][1].columnIds).toEqual(['alpha', 'beta'])
  })

  it('leaves an unchanged copy payload to the engine', () => {
    expect(
      gridClipboard(baseProps({ clipboard: { onCopy: vi.fn() } })).onCopy?.(
        clipboardPayload(),
      ),
    ).toBeUndefined()
  })

  it('applies an in-place paste transform', () => {
    const onPaste = vi.fn((data: SheetbaseGridCellValue[][]) => {
      data[0][0] = '=A1+1'
    })

    const result = gridClipboard(
      baseProps({ clipboard: { onPaste } }),
    ).onPaste?.(clipboardPayload(), { row: 3, column: 2 })

    expect(result).toMatchObject({ text: '=A1+1\tb1\na2\tb2' })
    expect(onPaste).toHaveBeenCalledWith(expect.anything(), {
      row: 3,
      column: 2,
    })
  })
})

describe('SheetbaseTableGridClient Record editor', () => {
  it('offers a custom editor for relationship fields only', () => {
    const { result } = renderHook(() => {
      const { layout } = useGridLayout(baseProps())

      return useGridEditors(vi.fn(), layout)
    })

    expect(result.current).toHaveLength(1)
    expect(
      result.current?.[0].matches({
        point: { row: 0, column: 0 },
        field: { id: 'r', label: 'R', column: 0, dataType: 'relationship' },
      }),
    ).toBe(true)
    expect(
      result.current?.[0].matches({
        point: { row: 0, column: 1 },
        field: { id: 't', label: 'T', column: 1, dataType: 'text' },
      }),
    ).toBe(false)
  })

  it('opens the shared picker with the editor commit/cancel handle', () => {
    const onOpenRecordPicker =
      vi.fn<NonNullable<SheetbaseGridProps['onOpenRecordPicker']>>()

    const onCellsChange = vi.fn()

    const writableColumns = columns.map((column) => ({
      ...column,
      readOnly: false,
    }))

    liveGrid({ columns: writableColumns, onOpenRecordPicker, onCellsChange })
    fireEvent.doubleClick(cell(0, 2))
    expect(onOpenRecordPicker).toHaveBeenCalledWith(
      { rowIndex: 0, columnIndex: 2, columnId: 'record' },
      expect.objectContaining({
        commit: expect.any(Function),
        cancel: expect.any(Function),
      }),
    )
    const editor = onOpenRecordPicker.mock.calls[0][1]
    act(() => editor.commit('rec-new'))
    expect(onCellsChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          rowId: 'row-1',
          columnId: 'record',
          next: 'rec-new',
        }),
      ],
      'edit',
    )
  })
})

describe('real engine edit and history gates', () => {
  it('carries host coercion through edits, undo and redo without changing record identity', () => {
    const beforeCellsChange = vi.fn<
      NonNullable<SheetbaseGridProps['beforeCellsChange']>
    >((changes) => {
      changes[0].next = 42
    })

    const onCellsChange = vi.fn()
    const { handle } = liveGrid({ beforeCellsChange, onCellsChange })
    act(() => handle.selectCell(0, 1))
    act(() => handle.editActiveInput('41.99'))
    act(() => handle.commitEdit())
    expect(handle.snapshot().data.get('B1')).toBe('42')
    expect(onCellsChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          rowId: 'row-1',
          columnId: 'beta',
          previous: '1',
          next: '42',
        }),
      ],
      'edit',
    )
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'z', ctrlKey: true })
    expect(handle.snapshot().data.get('B1')).toBe('1')
    fireEvent.keyDown(screen.getByRole('grid'), {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
    })
    expect(handle.snapshot().data.get('B1')).toBe('42')
    expect(onCellsChange).toHaveBeenCalledTimes(3)
  })

  it('refuses an entire paste containing a read-only target, without history or mutation', () => {
    const beforeCellsChange = vi.fn<
      NonNullable<SheetbaseGridProps['beforeCellsChange']>
    >((changes) => !changes.some((change) => change.editable === false))

    const onCellsChange = vi.fn()
    const { handle } = liveGrid({ beforeCellsChange, onCellsChange })
    act(() => handle.selectCell(0, 1))
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? '99\trec-new' : ''),
      },
    })
    expect(beforeCellsChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          columnId: 'beta',
          rowId: 'row-1',
          next: '99',
        }),
        expect.objectContaining({ columnId: 'record', editable: false }),
      ],
      'paste',
    )
    expect(handle.snapshot().data.get('B1')).toBe('1')
    expect(handle.snapshot().data.get('C1')).toBe('rec-1')
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'z', ctrlKey: true })
    expect(onCellsChange).not.toHaveBeenCalled()
  })

  it('blocks all writes in a read-only grid but retains selection and copy', () => {
    const onCellsChange = vi.fn()
    const onCopy = vi.fn()

    const { handle } = liveGrid({
      readOnly: true,
      onCellsChange,
      clipboard: { onCopy },
    })

    act(() => handle.selectCell(0, 0))
    act(() => handle.editActiveInput('blocked'))
    act(() => handle.commitEdit())
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: () => 'blocked' },
    })
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Delete' })
    const setData = vi.fn()
    fireEvent.copy(screen.getByRole('grid'), { clipboardData: { setData } })
    expect(setData).toHaveBeenCalledWith('text/plain', 'a1')
    expect(onCopy).toHaveBeenCalledOnce()
    expect(handle.snapshot().data.get('A1')).toBe('a1')
    expect(onCellsChange).not.toHaveBeenCalled()
  })

  it('rewrites real clipboard copy and paste, and refuses cut over guarded columns', () => {
    const onCellsChange = vi.fn()

    const { handle } = liveGrid({
      onCellsChange,
      clipboard: {
        onCopy: (data) => {
          data[0][0] = '=B1'
        },
        onPaste: (data) => {
          data[0][0] = 'rewritten'
        },
      },
    })

    act(() => handle.selectCell(0, 0))
    const setData = vi.fn()
    fireEvent.copy(screen.getByRole('grid'), { clipboardData: { setData } })
    expect(setData).toHaveBeenCalledWith('text/plain', '=B1')
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: () => 'original' },
    })
    expect(handle.snapshot().data.get('A1')).toBe('rewritten')
    act(() => handle.selectCell(0, 1))
    act(() => handle.selectCell(0, 2, { extend: true }))
    setData.mockClear()
    onCellsChange.mockClear()
    fireEvent.cut(screen.getByRole('grid'), { clipboardData: { setData } })
    expect(setData).not.toHaveBeenCalled()
    expect(onCellsChange).not.toHaveBeenCalled()
    expect(handle.snapshot().data.get('B1')).toBe('1')
  })

  it('uses legacy structured coercion in real clipboard transforms and the write gate', () => {
    const structured: SheetbaseGridCellValue = [null, [1, null, [2]], {}, []]
    const onCellsChange = vi.fn()

    const { handle } = liveGrid({
      onCellsChange,
      clipboard: {
        onCopy: (data) => {
          data[0][0] = structured
        },
        onPaste: (data) => {
          data[0][0] = structured
        },
      },
      beforeCellsChange: (changes) => {
        changes[0].next = structured
      },
    })

    act(() => handle.selectCell(0, 0))
    const setData = vi.fn()
    fireEvent.copy(screen.getByRole('grid'), { clipboardData: { setData } })
    expect(setData).toHaveBeenCalledWith('text/plain', ',1,,2,[object Object],')
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: () => 'incoming' },
    })
    expect(handle.snapshot().data.get('A1')).toBe(',1,,2,[object Object],')
    expect(onCellsChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          rowId: 'row-1',
          columnId: 'alpha',
          previous: 'a1',
          next: ',1,,2,[object Object],',
        }),
      ],
      'paste',
    )
    expect(structured).toEqual([null, [1, null, [2]], {}, []])
  })

  it('opens the real formula-reference editor and gates its commit', () => {
    const beforeCellsChange = vi.fn<
      NonNullable<SheetbaseGridProps['beforeCellsChange']>
    >(() => false)

    const onCellsChange = vi.fn()

    const { handle, rerender, onReady } = liveGrid({
      columns: columns.map((column) => ({ ...column, formula: true })),
      beforeCellsChange,
      onCellsChange,
    })

    fireEvent.doubleClick(cell(0, 0))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '=B1+1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(beforeCellsChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          rowId: 'row-1',
          columnId: 'alpha',
          next: '=B1+1',
        }),
      ],
      'edit',
    )
    expect(handle.snapshot().data.get('A1')).toBe('a1')
    expect(onCellsChange).not.toHaveBeenCalled()
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          columns: columns.map((column) => ({ ...column, formula: true })),
          onReady,
          onCellsChange,
        })}
      />,
    )
    act(() => handle.cancelEdit())
    fireEvent.doubleClick(cell(0, 0))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '=B1+1' },
    })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(handle.snapshot().data.get('A1')).toBe('=B1+1')
    expect(onCellsChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          rowId: 'row-1',
          columnId: 'alpha',
          next: '=B1+1',
        }),
      ],
      'edit',
    )
  })
})

describe('external query boundary', () => {
  it('decodes finite scientific JSON and valid Dates only at an erased host boundary', () => {
    expect(
      sheetbaseGridCellValueSchema.parse({ readings: [0, false, null, 'µg'] }),
    ).toEqual({ readings: [0, false, null, 'µg'] })
    expect(sheetbaseGridCellValueSchema.parse(new Date('2026-11-10'))).toEqual(
      new Date('2026-11-10'),
    )

    for (const invalid of [
      Infinity,
      NaN,
      undefined,
      new Date('invalid'),
      { amount: Infinity },
      { method: () => 1 },
    ]) {
      expect(sheetbaseGridCellValueSchema.safeParse(invalid).success).toBe(
        false,
      )
    }
  })

  it('keeps only finite primitive engine filter values and preserves hidden filters', () => {
    const props = baseProps({
      filters: [{ columnId: 'hidden', operator: 'equals', value: 'saved' }],
    })

    expect(
      captureGridFilters(
        [
          { fieldId: 'alpha', operator: 'eq', value: { unexpected: true } },
          { fieldId: 'beta', operator: 'neq', value: Infinity },
        ],
        props,
      ),
    ).toEqual([
      { columnId: 'hidden', operator: 'equals', value: 'saved' },
      { columnId: 'alpha', operator: 'equals', value: undefined },
      { columnId: 'beta', operator: 'not-equals', value: undefined },
    ])
    expect(
      captureGridFilters(
        [
          { fieldId: 'beta', operator: 'eq', value: 0 },
          { fieldId: 'alpha', operator: 'eq', value: false },
        ],
        baseProps(),
      ),
    ).toEqual([
      { columnId: 'beta', operator: 'equals', value: 0 },
      { columnId: 'alpha', operator: 'equals', value: false },
    ])
  })
})
