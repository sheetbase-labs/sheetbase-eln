import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RangeStore,
  sourceBadgeLabel,
} from '@sheetbase-labs/sheetbase-table'
import type {
  CellFormat,
  SpreadsheetClipboardPayload,
  SpreadsheetHandle,
  SpreadsheetProps,
} from '@sheetbase-labs/sheetbase-table'
import type * as SheetbaseTableModule from '@sheetbase-labs/sheetbase-table'

import type {
  SheetbaseGridClipboardRange,
  SheetbaseGridHandle,
  SheetbaseGridProps,
} from './sheetbase-grid'
import { SheetbaseTableGridClient } from './sheetbase-table-grid-client'

/**
 * COMP-06.2/.3 — the `sheetbase-table` adapter. The package's `Spreadsheet` is
 * replaced with a props recorder so every translation (layout props, row
 * hooks, clipboard transforms, the neutral handle and the Record editor) can
 * be exercised without the engine.
 */
const captured = vi.hoisted(() => ({
  props: [] as SpreadsheetProps[],
}))

const engineHandle = {
  selectCell: vi.fn(),
  selectCellAddress: vi.fn(() => true),
  scrollCellIntoView: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  setActiveInput: vi.fn(),
  editActiveInput: vi.fn(),
  commitEdit: vi.fn(),
  cancelEdit: vi.fn(),
  snapshot: vi.fn(),
  insertRows: vi.fn(),
  deleteRows: vi.fn(),
  insertColumns: vi.fn(),
  deleteColumns: vi.fn(),
  autoFitColumn: vi.fn(),
  autoFitRow: vi.fn(),
  find: vi.fn(),
  replaceAll: vi.fn(),
  applyFormat: vi.fn(),
  focus: vi.fn(),
  hydrate: vi.fn(),
  replaceData: vi.fn(),
  clearWriteState: vi.fn(),
  setFilter: vi.fn(),
  clearFilter: vi.fn(),
  getQuery: vi.fn(),
  setAnnotation: vi.fn(),
  removeAnnotation: vi.fn(),
  heldFieldWrites: vi.fn(() => []),
  commitHeldFieldWrites: vi.fn(),
  discardHeldFieldWrites: vi.fn(),
} satisfies SpreadsheetHandle

vi.mock('@sheetbase-labs/sheetbase-table', async (importOriginal) => {
  // Vitest hoists `vi.mock` above imports, so the factory must load React and
  // the real module dynamically; static bindings are not yet initialised here.
  const actual = await importOriginal<typeof SheetbaseTableModule>()
  const React = await import('react')
  const Spreadsheet = React.forwardRef<SpreadsheetHandle, SpreadsheetProps>(
    (props, ref) => {
      captured.props.push(props)
      const { rowCount, columnCount } = props
      if (rowCount === undefined || columnCount === undefined)
        throw new Error('The adapter must supply grid dimensions')
      // Match 0.6.0: imperative annotation writes use a captured array, not a
      // functional updater. Several writes on one handle can overwrite each other.
      const [annotations, setAnnotations] = React.useState(
        props.initialAnnotations ?? [],
      )
      function annotationCell(address: string) {
        const { row, column } = actual.parseAddress(address)
        return {
          address,
          recordId: props.datasetHeader?.recordIdForRow?.(row),
          fieldId: props.fieldIds?.[column],
          bound: true,
        }
      }
      const handle: SpreadsheetHandle = {
        ...engineHandle,
        setAnnotation: (address, text) => {
          engineHandle.setAnnotation(address, text)
          const cell = annotationCell(address)
          const next = [
            ...annotations.filter(
              (note) =>
                note.recordId !== cell.recordId ||
                note.fieldId !== cell.fieldId,
            ),
            { address, recordId: cell.recordId, fieldId: cell.fieldId, text },
          ]
          setAnnotations(next)
          props.onAnnotationsChange?.(next)
        },
        removeAnnotation: (address) => {
          engineHandle.removeAnnotation(address)
          const cell = annotationCell(address)
          const next = annotations.filter(
            (note) =>
              note.recordId !== cell.recordId || note.fieldId !== cell.fieldId,
          )
          setAnnotations(next)
          props.onAnnotationsChange?.(next)
        },
        snapshot: () => ({
          data: props.initialData,
          annotations,
          formats: new RangeStore<CellFormat>(),
          columnWidths: [],
          rowHeights: [],
          selection: {
            anchor: { row: 0, column: 0 },
            focus: { row: rowCount - 1, column: columnCount - 1 },
          },
          scroll: { top: 0, left: 0 },
          frozenRows: 0,
          frozenColumns: 0,
        }),
      }
      React.useImperativeHandle(ref, () => handle)
      React.useEffect(() => {
        props.onReady?.(handle)
      }, [])
      return React.createElement('div', {
        'data-testid': 'spreadsheet',
        'data-annotation-texts': annotations.map((note) => note.text).join('|'),
      })
    },
  )
  return { ...actual, Spreadsheet }
})

afterEach(() => {
  cleanup()
  captured.props.length = 0
  vi.clearAllMocks()
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

function lastProps(): SpreadsheetProps {
  const props = captured.props.at(-1)
  if (!props) throw new Error('Spreadsheet did not render.')
  return props
}

function clipboardPayload(): SpreadsheetClipboardPayload {
  return {
    text: 'a1\tb1',
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
    render(
      <SheetbaseTableGridClient
        {...baseProps({ height: 320, stretch: 'all', rowHeaders: false })}
      />,
    )
    const props = lastProps()
    expect(props.height).toBe(320)
    expect(props.stretch).toBe('all')
    expect(props.rowHeaders).toBe(false)
  })

  it('applies a persisted column order to fields, ids and A1 data', () => {
    render(
      <SheetbaseTableGridClient
        {...baseProps({ columnOrder: ['record', 'beta', 'alpha'] })}
      />,
    )
    const props = lastProps()
    expect(props.fieldIds).toEqual(['record', 'beta', 'alpha'])
    expect(props.datasetHeader?.fields.map((field) => field.id)).toEqual([
      'record',
      'beta',
      'alpha',
    ])
    // Display column A is now the record column; row 1 shows its stored value.
    expect(props.initialData.get('A1')).toBe('rec-1')
    expect(props.initialData.get('B1')).toBe('1')
    expect(props.initialData.get('C1')).toBe('a1')
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

  function renderChrome(overrides: Partial<SheetbaseGridProps> = {}) {
    render(
      <SheetbaseTableGridClient
        {...baseProps({ columns: chromeColumns, rows: chromeRows, ...overrides })}
      />,
    )
    return lastProps()
  }

  it('groups contiguous same-source columns and names the dataset in the Source badge', () => {
    const props = renderChrome()
    expect(props.columnGroups).toEqual([
      { label: 'This experiment', columns: [0, 1] },
      { label: 'Results', columns: [2] },
      { label: 'Derived', columns: [3] },
    ])
    const turbidity = props.datasetHeader?.fields.at(2)
    expect(turbidity?.source).toBe('dataset')
    expect(turbidity?.sourceLabel).toBe('Results · rev 9')
  })

  it('marks a calculated column with the ƒx badge and leaves a bound column unmarked', () => {
    const fields = renderChrome().datasetHeader?.fields ?? []
    const derived = fields.at(3)
    expect(derived?.computed).toBe(true)
    expect(derived?.source).toBe('calc')
    // The engine prints the design's `ƒx` label when the host gives none.
    expect(sourceBadgeLabel(derived?.source, derived?.sourceLabel)).toBe('ƒx')
    const bound = fields.at(2)
    expect(bound?.computed).toBeFalsy()
    expect(sourceBadgeLabel(bound?.source, bound?.sourceLabel)).not.toBe('ƒx')
    expect(sourceBadgeLabel(bound?.source, bound?.sourceLabel)).toBe(
      'Results · rev 9',
    )
  })

  it('rebuilds the group row from the displayed column order', () => {
    const props = renderChrome({ columnOrder: ['yield', 'turbidity', 'condition', 'train'] })
    expect(props.columnGroups).toEqual([
      { label: 'Derived', columns: [0] },
      { label: 'Results', columns: [1] },
      { label: 'This experiment', columns: [2, 3] },
    ])
  })

  it('forwards the New-run append row only when the caller sets it', () => {
    expect(renderChrome().appendRow).toBeUndefined()
    expect(renderChrome({ appendRow: true }).appendRow).toBe(true)
  })
})

describe('SheetbaseTableGridClient neutral handle', () => {
  it('keeps methods and selection current after the package replaces its handle, and clears on teardown', () => {
    const onReady = vi.fn<(handle: SheetbaseGridHandle | null) => void>()
    const { rerender, unmount } = render(
      <SheetbaseTableGridClient {...baseProps({ onReady })} />,
    )
    const handle = onReady.mock.calls[0][0]
    if (!handle) throw new Error('Expected a live grid handle')
    expect(handle).not.toBe(engineHandle)
    expect(handle.snapshot().selection.focus).toEqual({ row: 1, column: 2 })
    rerender(
      <SheetbaseTableGridClient {...baseProps({ onReady, spareRows: 3 })} />,
    )
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(handle.snapshot().selection.focus).toEqual({ row: 4, column: 2 })
    handle.editActiveInput('=SUM(A1:A2)')
    handle.commitEdit()
    handle.cancelEdit()
    handle.selectCell(4, 1)
    expect(engineHandle.editActiveInput).toHaveBeenCalledWith('=SUM(A1:A2)')
    expect(engineHandle.commitEdit).toHaveBeenCalledOnce()
    expect(engineHandle.cancelEdit).toHaveBeenCalledOnce()
    expect(engineHandle.selectCell).toHaveBeenCalledWith(4, 1, undefined)
    unmount()
    expect(onReady).toHaveBeenLastCalledWith(null)
  })
})

describe('Sheet comment selection membership', () => {
  it('clears a previous anchor when the engine restores a view with no selection', () => {
    const onSelectionChange = vi.fn()
    render(<SheetbaseTableGridClient {...baseProps({ onSelectionChange })} />)
    lastProps().onSelectionChange?.({
      address: 'B2',
      range: 'B2',
      input: 'previous',
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ columnId: 'beta' }),
    )
    lastProps().onSelectionChange?.({ address: '', range: '', input: '' })
    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('resolves each sorted, filtered display row and reordered field independently', () => {
    const onSelectionChange = vi.fn()
    render(
      <SheetbaseTableGridClient
        {...baseProps({
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
          onSelectionChange,
        })}
      />,
    )
    // Display rows C/A/D differ from source rows A/B/C/D. Active address is
    // source B3, but the range is display B1:B2 and must capture C/A, not C/D.
    lastProps().onSelectionChange?.({
      address: 'B3',
      range: 'B1:B2',
      input: '91',
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      rowIndex: 2,
      rowId: 'row-c',
      columnId: 'amount',
      input: '91',
      rowIds: ['row-c', 'row-a'],
      columnIds: ['amount'],
    })
    lastProps().onSelectionChange?.({
      address: 'A4',
      range: 'B3:A2',
      input: 'keep',
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      rowIndex: 3,
      rowId: 'row-d',
      columnId: 'group',
      input: 'keep',
      rowIds: ['row-a', 'row-d'],
      columnIds: ['group', 'amount'],
    })
  })
})

describe('Sheet comment markers', () => {
  it('retains all notes arriving after mount without remounting the engine', async () => {
    const onReady = vi.fn()
    const { rerender, getByTestId } = render(
      <SheetbaseTableGridClient {...baseProps({ onReady })} />,
    )
    const engine = getByTestId('spreadsheet')
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
      expect(engine.getAttribute('data-annotation-texts')).toBe(
        'first|second|third',
      ),
    )
    expect(engineHandle.setAnnotation.mock.calls).toEqual([
      ['A1', 'first'],
      ['B2', 'second'],
      ['C2', 'third'],
    ])
    expect(engine.getAttribute('data-annotation-texts')).toBe(
      'first|second|third',
    )
    expect(getByTestId('spreadsheet')).toBe(engine)
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
      const { rerender, getByTestId } = render(
        <SheetbaseTableGridClient {...baseProps({ rows: rangeRows })} />,
      )
      rerender(
        <SheetbaseTableGridClient
          {...baseProps({ rows: rangeRows, annotations })}
        />,
      )
      await waitFor(() =>
        expect(
          getByTestId('spreadsheet').getAttribute('data-annotation-texts'),
        ).toBe(annotations.map((note) => note.text).join('|')),
      )
      expect(engineHandle.setAnnotation).toHaveBeenCalledTimes(64)
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('maps persisted identities to bound annotations after row and field reorder, never to deleted targets', () => {
    const annotations = [
      { rowId: 'row-2', columnId: 'beta', text: 'Check recovery' },
    ]
    const { rerender } = render(
      <SheetbaseTableGridClient {...baseProps({ annotations })} />,
    )
    expect(lastProps().initialAnnotations).toEqual([
      {
        address: 'B2',
        recordId: 'row-2',
        fieldId: 'beta',
        text: 'Check recovery',
      },
    ])
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          annotations,
          rows: [rows[1], rows[0]],
          columnOrder: ['beta', 'record', 'alpha'],
        })}
      />,
    )
    expect(lastProps().initialAnnotations).toEqual([
      {
        address: 'A1',
        recordId: 'row-2',
        fieldId: 'beta',
        text: 'Check recovery',
      },
    ])
    engineHandle.setAnnotation.mockClear()
    engineHandle.removeAnnotation.mockClear()
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          annotations,
          rows: [rows[0]],
          columnOrder: ['beta', 'record', 'alpha'],
        })}
      />,
    )
    expect(lastProps().initialAnnotations).toEqual([])
    expect(engineHandle.setAnnotation).not.toHaveBeenCalled()
    expect(engineHandle.removeAnnotation).not.toHaveBeenCalled()
  })

  it('refreshes and removes a visible note through the current identity, without a second persistence callback', () => {
    const annotations = [
      { rowId: 'row-2', columnId: 'beta', text: 'Check recovery' },
    ]
    const { rerender } = render(
      <SheetbaseTableGridClient {...baseProps({ annotations })} />,
    )
    rerender(
      <SheetbaseTableGridClient
        {...baseProps({
          annotations: [
            { ...annotations[0], text: 'Resolved: recovery confirmed' },
          ],
        })}
      />,
    )
    expect(engineHandle.setAnnotation).toHaveBeenLastCalledWith(
      'B2',
      'Resolved: recovery confirmed',
    )
    // This is an internal render acknowledgment, not a host persistence hook.
    expect(lastProps().onAnnotationsChange).toBeTypeOf('function')
    rerender(<SheetbaseTableGridClient {...baseProps({ annotations: [] })} />)
    expect(engineHandle.removeAnnotation).toHaveBeenLastCalledWith('B2')
  })
})

describe('SheetbaseTableGridClient row hooks', () => {
  it('routes the remove pair through the host preflight and persistence', () => {
    const before = vi.fn(() => false)
    const removed = vi.fn()
    render(
      <SheetbaseTableGridClient
        {...baseProps({ onBeforeRowsRemove: before, onRowsRemoved: removed })}
      />,
    )
    const props = lastProps()
    expect(props.onBeforeRowsRemove?.(1, 1)).toBe(false)
    expect(before).toHaveBeenCalledWith(1, 1)
    props.onRowsRemoved?.(1, 1)
    expect(removed).toHaveBeenCalledWith(1, 1, 'edit')
  })

  it('routes the insert pair through the host preflight and persistence', () => {
    const before = vi.fn()
    const inserted = vi.fn()
    render(
      <SheetbaseTableGridClient
        {...baseProps({ onBeforeRowsInsert: before, onRowsInserted: inserted })}
      />,
    )
    const props = lastProps()
    expect(props.onBeforeRowsInsert?.(0, 2)).toBeUndefined()
    expect(before).toHaveBeenCalledWith(0, 2)
    props.onRowsInserted?.(0, 2)
    expect(inserted).toHaveBeenCalledWith(0, 2, 'edit')
  })
})

describe('SheetbaseTableGridClient clipboard transforms', () => {
  it('re-serialises a returned copy transform for the engine', () => {
    const onCopy = vi.fn(
      (data: unknown[][], _range: SheetbaseGridClipboardRange) => {
        data[0][0] = '=SUM(A1:A2)'
        return data as string[][]
      },
    )
    render(
      <SheetbaseTableGridClient {...baseProps({ clipboard: { onCopy } })} />,
    )
    const result = lastProps().clipboard?.onCopy?.(clipboardPayload())
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
    const onCopy = vi.fn()
    render(
      <SheetbaseTableGridClient {...baseProps({ clipboard: { onCopy } })} />,
    )
    expect(lastProps().clipboard?.onCopy?.(clipboardPayload())).toBeUndefined()
  })

  it('applies an in-place paste transform', () => {
    const onPaste = vi.fn((data: unknown[][]) => {
      data[0][0] = '=A1+1'
    })
    render(
      <SheetbaseTableGridClient {...baseProps({ clipboard: { onPaste } })} />,
    )
    const result = lastProps().clipboard?.onPaste?.(clipboardPayload(), {
      row: 3,
      column: 2,
    })
    expect(result).toMatchObject({ text: '=A1+1\tb1\na2\tb2' })
    expect(onPaste).toHaveBeenCalledWith(expect.anything(), {
      row: 3,
      column: 2,
    })
  })
})

describe('SheetbaseTableGridClient Record editor', () => {
  it('offers a custom editor for relationship fields only', () => {
    const onOpenRecordPicker = vi.fn()
    render(<SheetbaseTableGridClient {...baseProps({ onOpenRecordPicker })} />)
    const editors = lastProps().customEditors
    expect(editors).toHaveLength(1)
    const relationship = {
      id: 'r',
      label: 'R',
      column: 0,
      dataType: 'relationship' as const,
    }
    const text = { id: 't', label: 'T', column: 1, dataType: 'text' as const }
    const point = { row: 0, column: 0 }
    expect(editors?.[0].matches({ point, field: relationship })).toBe(true)
    expect(editors?.[0].matches({ point, field: text })).toBe(false)
  })

  it('opens the shared picker with the editor commit/cancel handle', () => {
    const onOpenRecordPicker = vi.fn()
    render(<SheetbaseTableGridClient {...baseProps({ onOpenRecordPicker })} />)
    const editor = lastProps().customEditors?.[0]
    if (!editor) throw new Error('editor missing')
    let node: ReactNode = null
    act(() => {
      node = editor.render({
        point: { row: 0, column: 2 },
        address: 'C1',
        columnId: 'record',
        field: undefined,
        storedValue: 'rec-1',
        initialDraft: 'rec-1',
        commit: vi.fn(),
        cancel: vi.fn(),
      })
    })
    render(<>{node}</>)
    expect(onOpenRecordPicker).toHaveBeenCalledWith(
      { rowIndex: 0, columnIndex: 2, columnId: 'record' },
      expect.objectContaining({
        commit: expect.any(Function),
        cancel: expect.any(Function),
      }),
    )
  })
})
