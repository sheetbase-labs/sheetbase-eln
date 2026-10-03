import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
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
      React.useImperativeHandle(ref, () => engineHandle, [])
      React.useEffect(() => {
        props.onReady?.(engineHandle)
      }, [])
      return React.createElement('div', { 'data-testid': 'spreadsheet' })
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

describe('SheetbaseTableGridClient neutral handle', () => {
  it('passes the engine handle through to onReady', () => {
    const onReady = vi.fn<(handle: SheetbaseGridHandle | null) => void>()
    render(<SheetbaseTableGridClient {...baseProps({ onReady })} />)
    expect(onReady).toHaveBeenCalledWith(engineHandle)
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
