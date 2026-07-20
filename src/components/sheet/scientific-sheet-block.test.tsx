import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type * as ScientificSheetData from '#/lib/scientific-sheet-data'
import { ScientificSheetBlock } from './scientific-sheet-block'
import { ScientificWorkbookProvider } from '#/components/notebook/scientific-workbook-provider'

const mocks = vi.hoisted(() => ({
  table: vi.fn(),
  rows: vi.fn(),
  allRows: vi.fn(),
  formulas: vi.fn(),
  dependencies: vi.fn(),
  calculationResults: vi.fn(),
  calculate: vi.fn(),
  formulaMutation: vi.fn(),
  apply: vi.fn(),
  add: vi.fn(),
  renameTable: vi.fn(),
  display: vi.fn(),
  convert: vi.fn(),
  retire: vi.fn(),
  settings: null as Record<string, any> | null,
}))
vi.mock('#/lib/scientific-sheet-data', async (load) => ({
  ...(await load<typeof ScientificSheetData>()),
  scientificDataClient: {},
  fetchScientificTable: mocks.table,
  fetchScientificRows: mocks.rows,
  fetchAllScientificRows: mocks.allRows,
  fetchScientificFormulas: mocks.formulas,
  fetchScientificDependencies: mocks.dependencies,
  fetchScientificCalculationResults: mocks.calculationResults,
  requestScientificCalculation: mocks.calculate,
  mutateScientificFormula: mocks.formulaMutation,
  applyScientificRowChanges: mocks.apply,
  addScientificColumn: mocks.add,
  renameScientificTable: mocks.renameTable,
  updateScientificColumnDisplay: mocks.display,
  preflightScientificConversion: mocks.convert,
  preflightScientificRetirement: mocks.retire,
}))
vi.mock('./sheetbase-grid', () => ({
  SheetbaseGrid: ({ settings }: { settings: Record<string, any> }) => {
    mocks.settings = settings
    return <div data-testid="grid" />
  },
}))

const columns = [
  {
    id: 'text',
    field_name: 'col_text',
    label: 'Name',
    display_order: 1,
    logical_type: 'text',
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [],
  },
  {
    id: 'number',
    field_name: 'col_number',
    label: 'Mass',
    display_order: 2,
    logical_type: 'decimal',
    nullable: true,
    unit: { symbol: 'mg' },
    validation: {},
    width: null,
    options: [],
  },
  {
    id: 'category',
    field_name: 'col_category',
    label: 'State',
    display_order: 3,
    logical_type: 'category',
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [{ id: 'option-id', label: 'Ready', display_order: 1 }],
  },
] as any
const table = {
  id: 'table-1',
  resource_name: `sheet_${'a'.repeat(26)}`,
  name: 'Results',
  schema_version: 2,
  lifecycle: 'active',
  columns,
}
const block = {
  id: 'block-1',
  recordId: 'record-1',
  type: 'sheet',
  payload: { tableId: 'table-1' },
  payloadSchemaVersion: 1,
  order: 1,
  version: 1,
} as any

function mount(props: { readOnly?: boolean; block?: any } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ScientificWorkbookProvider>
        <ScientificSheetBlock
          block={props.block ?? block}
          readOnly={props.readOnly}
        />
      </ScientificWorkbookProvider>
    </QueryClientProvider>,
  )
}
async function ready() {
  await screen.findByTestId('grid')
  return mocks.settings!
}

beforeEach(() => {
  mocks.allRows.mockResolvedValue([])
  mocks.formulas.mockResolvedValue([])
  mocks.dependencies.mockResolvedValue([])
  mocks.calculationResults.mockResolvedValue([])
  mocks.calculate.mockResolvedValue({ status: 'completed' })
  mocks.formulaMutation.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.settings = null
})

describe('ScientificSheetBlock', () => {
  it('renders loading, load failures, and a missing table id', async () => {
    mocks.table.mockReturnValue(new Promise(() => {}))
    mount()
    expect(screen.getByRole('status').textContent).toContain(
      'Loading scientific sheet',
    )
    cleanup()
    mocks.table.mockRejectedValue(new Error('metadata'))
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load',
    )
    cleanup()
    mount({ block: { ...block, payload: {} } })
    expect(screen.getByRole('alert').textContent).toContain(
      'Invalid sheet block',
    )
  })

  it('maps column types, units, and category UUIDs to grid labels', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([
      { id: 'r1', version: 1, col_category: 'option-id' },
    ])
    mount()
    const settings = await ready()
    expect(settings.columns.map((x: any) => x.type)).toEqual([
      'text',
      'numeric',
      'dropdown',
    ])
    expect(settings.colHeaders).toEqual(['Name', 'Mass (mg)', 'State'])
    expect(settings.data[0].col_category).toBe('Ready')
  })

  it('submits one batch for multiple existing cells and mixed spare rows', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 4, col_text: 'old' }])
    mocks.apply.mockResolvedValue({ ok: true, schemaVersion: 2, rows: [] })
    mount()
    const settings = await ready()
    settings.afterChange(
      [
        [0, 'col_text', 'old', 'new'],
        [0, 'col_number', null, '2.5'],
        [1, 'col_text', null, 'insert'],
      ],
      'CopyPaste.paste',
    )
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1))
    expect(mocks.apply.mock.calls[0].slice(3)).toEqual([
      [
        {
          rowId: 'r1',
          expectedVersion: 4,
          values: { text: 'new', number: 2.5 },
        },
      ],
      [{ text: 'insert' }],
    ])
  })

  it('rejects an entire invalid batch locally and preserves its draft', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mount()
    const settings = await ready()
    settings.afterChange(
      [
        [0, 'col_number', null, 'not-number'],
        [0, 'col_text', null, 'draft'],
      ],
      'edit',
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Mass must be a finite number.',
    )
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.settings!.data[0].col_number).toBe('not-number')
  })

  it('preserves stale drafts, identifies the row, and refetches', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mocks.apply.mockRejectedValue(
      new DataClientError('stale_version', 'stale', 409),
    )
    mount()
    const settings = await ready()
    settings.afterChange([[0, 'col_text', null, 'raw']], 'edit')
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Row 1 changed elsewhere',
    )
    expect(mocks.settings!.data[0].col_text).toBe('raw')
    await waitFor(() => expect(mocks.rows.mock.calls.length).toBeGreaterThan(1))
  })

  it('serializes rapid edits and uses the first canonical version for the second', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 1 }])
    let release!: () => void
    mocks.apply
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                ok: true,
                schemaVersion: 2,
                rows: [{ id: 'r1', version: 2, col_text: 'first' }],
              })
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 2,
        rows: [{ id: 'r1', version: 3 }],
      })
    mount()
    const settings = await ready()
    settings.afterChange([[0, 'col_text', null, 'first']], 'edit')
    settings.afterChange([[0, 'col_number', null, '2']], 'edit')
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1))
    release()
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2))
    expect(mocks.apply.mock.calls[1][3][0].expectedVersion).toBe(2)
  })

  it('accepts a formula in a numeric cell before literal decoding', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 4 }])
    mount()
    const settings = await ready()
    settings.afterChange([[0, 'col_number', null, '=1+2']], 'edit')
    await waitFor(() => expect(mocks.formulaMutation).toHaveBeenCalledTimes(1))
    expect(mocks.formulaMutation).toHaveBeenCalledWith({
      operation: 'create',
      target: { tableId: 'table-1', rowId: 'r1', columnId: 'number' },
      expectedSchemaVersion: 2,
      expectedRowVersion: 4,
      source: '=1+2',
    })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('rejects mixed formula batches before any partial write', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mount()
    const settings = await ready()
    settings.afterChange(
      [
        [0, 'col_number', null, '=1+2'],
        [0, 'col_text', null, 'partial'],
      ],
      'CopyPaste.paste',
    )
    expect(await screen.findByText(/one cell at a time/)).toBeTruthy()
    expect(mocks.formulaMutation).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('reconstructs a persisted formula and shows source, result and dependencies', async () => {
    const tableId = '10000000-0000-4000-8000-000000000001'
    const columnId = '10000000-0000-4000-8000-000000000002'
    const sourceRow = '10000000-0000-4000-8000-000000000003'
    const targetRow = '10000000-0000-4000-8000-000000000004'
    const formulaTable = {
      ...table,
      id: tableId,
      created_at: '2026-01-01T00:00:00Z',
      columns: [
        {
          ...columns[1],
          id: columnId,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    }
    const persistedRows = [
      {
        id: sourceRow,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        col_number: 3,
      },
      {
        id: targetRow,
        version: 2,
        created_at: '2026-01-02T00:00:00Z',
        col_number: null,
      },
    ]
    mocks.table.mockResolvedValue(formulaTable)
    mocks.rows.mockResolvedValue(persistedRows)
    mocks.allRows.mockResolvedValue(persistedRows)
    mocks.formulas.mockResolvedValue([
      {
        id: '10000000-0000-4000-8000-000000000005',
        target_table_id: tableId,
        target_row_id: targetRow,
        target_column_id: columnId,
        source_expression: '=A1*2',
        template: {
          kind: 'binary',
          operator: '*',
          left: { kind: 'reference', slot: 0 },
          right: { kind: 'number', value: 2 },
        },
        bindings: [
          {
            kind: 'cell',
            slot: 0,
            cell: { rowId: sourceRow, columnId },
            anchor: { columnAbsolute: false, rowAbsolute: false },
          },
        ],
        engine_expression: '=(A1*2)',
        syntax_profile: 'sheetbase-hf-en-us-v1',
        function_profile: 'scientific-core-v1',
        literal_profile: 'sheetbase-literal-v1',
        engine_version: '3.3.0',
        status: 'supported',
        version: 1,
        created_at: '2026-01-02T00:00:00Z',
      },
    ])
    mocks.calculationResults.mockResolvedValue([
      {
        formula_id: '10000000-0000-4000-8000-000000000005',
        target_table_id: tableId,
        target_row_id: targetRow,
        target_column_id: columnId,
        calculation_status: 'current',
        calculated_value: 6,
        calculation_error_code: null,
      },
    ])
    mount({ block: { ...block, payload: { tableId } } })
    await ready()
    await waitFor(() => expect(mocks.settings!.data[1].col_number).toBe(6))
    mocks.settings!.afterSelectionEnd(1, 0)
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>('textbox', {
          name: 'Formula source',
        }).value,
      ).toBe('=A1*2'),
    )
    expect(
      screen.getByText(/Result: 6 · supported · Dependencies: 1/),
    ).toBeTruthy()
    expect(screen.getByText(/Trusted cache: current · 6/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Recalculate trusted results' }),
    )
    await waitFor(() =>
      expect(mocks.calculate).toHaveBeenCalledWith(block.recordId),
    )
    expect(screen.getByText(/Inspect 1 stable dependencies/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Inspect 1 stable dependencies/))
    expect(screen.getByText(/Results · row 1 · Mass/)).toBeTruthy()
  })

  it('fully disables mutation affordances in read-only mode', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([])
    mount({ readOnly: true })
    const settings = await ready()
    expect(settings).toMatchObject({
      readOnly: true,
      minSpareRows: 0,
      fillHandle: false,
      contextMenu: false,
    })
    settings.afterChange([[0, 'col_text', null, 'x']], 'edit')
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Configure table' })).toBeNull()
  })

  it('adds a fully typed category column with stable option UUIDs', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([])
    mocks.add.mockResolvedValue({})
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    fireEvent.change(screen.getByLabelText('New column label'), {
      target: { value: 'Condition' },
    })
    fireEvent.change(screen.getByLabelText('New column type'), {
      target: { value: 'category' },
    })
    fireEvent.change(screen.getByLabelText('Category options'), {
      target: { value: 'Control\nTreated' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set default' }))
    fireEvent.change(screen.getByLabelText('Typed default'), {
      target: { value: 'Control' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    await waitFor(() => expect(mocks.add).toHaveBeenCalled())
    const input = mocks.add.mock.calls[0][3]
    expect(input.options).toHaveLength(2)
    expect(input.options[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(input.defaultValue).toBe(input.options[0].id)
  })

  it('renames and reorders display metadata without changing stable identities', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([])
    mocks.renameTable.mockResolvedValue({})
    mocks.display.mockResolvedValue({})
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    expect(
      screen.getAllByText(new RegExp(table.resource_name)).length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('col_text').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Sheet name'), {
      target: { value: 'Renamed results' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() =>
      expect(mocks.renameTable).toHaveBeenCalledWith(
        {},
        'table-1',
        2,
        'Renamed results',
      ),
    )
    await screen.findByText('Schema updated successfully.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Move right' })[0])
    await waitFor(() =>
      expect(mocks.display).toHaveBeenCalledWith({}, 'text', 3, null, 2),
    )
  })

  it('shows recoverable schema errors without refetching rows', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([])
    mocks.add.mockRejectedValue(new Error('schema cache is not ready'))
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    fireEvent.change(screen.getByLabelText('New column label'), {
      target: { value: 'Failed column' },
    })
    const tableFetches = mocks.table.mock.calls.length
    const rowFetches = mocks.rows.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect((await screen.findByRole('status')).textContent).toContain(
      'schema cache is not ready',
    )
    expect(mocks.table).toHaveBeenCalledTimes(tableFetches)
    expect(mocks.rows).toHaveBeenCalledTimes(rowFetches)
  })

  it.each(['service_unavailable', 'stale_version'])(
    'reconciles metadata and rows after ambiguous %s schema failures',
    async (code) => {
      mocks.table.mockResolvedValue(table)
      mocks.rows.mockResolvedValue([])
      mocks.add.mockRejectedValue(new DataClientError(code, 'retry', 503))
      mount()
      await ready()
      fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
      fireEvent.change(screen.getByLabelText('New column label'), {
        target: { value: 'Maybe committed' },
      })
      const tableFetches = mocks.table.mock.calls.length
      const rowFetches = mocks.rows.mock.calls.length
      fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
      await waitFor(() =>
        expect(mocks.table.mock.calls.length).toBeGreaterThan(tableFetches),
      )
      await waitFor(() =>
        expect(mocks.rows.mock.calls.length).toBeGreaterThan(rowFetches),
      )
      expect(screen.getByRole('status').textContent).toContain(
        'Could not update schema',
      )
    },
  )

  it('preserves text null and rejects unsafe integers and duplicate category labels', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([])
    mocks.add.mockResolvedValue({})
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    fireEvent.change(screen.getByLabelText('New column label'), {
      target: { value: 'Literal' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set default' }))
    fireEvent.change(screen.getByLabelText('Typed default'), {
      target: { value: 'null' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    await waitFor(() => expect(mocks.add).toHaveBeenCalled())
    expect(mocks.add.mock.calls[0][3].defaultValue).toBe('null')

    fireEvent.change(screen.getByLabelText('New column type'), {
      target: { value: 'integer' },
    })
    fireEvent.change(screen.getByLabelText('Typed default'), {
      target: { value: '9007199254740992' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect(screen.getByRole('status').textContent).toContain('valid integer')
    fireEvent.change(screen.getByLabelText('Typed default'), {
      target: { value: 'null' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect(screen.getByRole('status').textContent).toContain('valid integer')

    fireEvent.change(screen.getByLabelText('New column type'), {
      target: { value: 'category' },
    })
    fireEvent.change(screen.getByLabelText('Category options'), {
      target: { value: 'Same\nSame' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect(screen.getByRole('status').textContent).toContain('must be unique')
  })

  it('blocks destructive schema checks while drafts or row writes are pending', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mocks.apply.mockImplementation(() => new Promise(() => {}))
    mount()
    const settings = await ready()
    settings.afterChange([[0, 'col_text', null, 'draft']], 'edit')
    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    await screen.findByText(/Save or discard pending row changes/)
    expect(screen.getByLabelText('Convert Name').hasAttribute('disabled')).toBe(
      true,
    )
    expect(
      screen
        .getAllByRole('button', { name: 'Retire' })[0]
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(mocks.convert).not.toHaveBeenCalled()
    expect(mocks.retire).not.toHaveBeenCalled()
  })

  it('preflights conversion, blocks incompatible evidence, and supports cancellation', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([])
    mocks.convert.mockResolvedValue({
      schemaVersion: 2,
      targetType: 'integer',
      invalidRows: 2,
      formulaMarkers: 0,
      hash: 'evidence',
    })
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    fireEvent.change(screen.getByLabelText('Convert Name'), {
      target: { value: 'integer' },
    })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Invalid rows: 2')
    expect(
      screen
        .getByRole('button', { name: 'Confirm change' })
        .hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocks.convert).toHaveBeenCalledWith({}, 'text', 2, 'integer')
  })

  it('preflights and confirms retirement with the exact evidence hash', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([])
    mocks.retire
      .mockResolvedValueOnce({
        schemaVersion: 2,
        nonNullRows: 3,
        formulaMarkers: 1,
        hash: 'current',
      })
      .mockResolvedValueOnce({ retired: true })
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Retire' })[0])
    expect((await screen.findByRole('alertdialog')).textContent).toContain(
      'Non-null rows: 3',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    await waitFor(() =>
      expect(mocks.retire).toHaveBeenLastCalledWith({}, 'text', 2, 'current'),
    )
    expect(screen.getByRole('status').textContent).toMatch(
      /progress|successfully/,
    )
  })

  it('pages and only provides a spare row on the terminal page', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockImplementation((_c: any, _t: any, page: number) =>
      Promise.resolve(
        page === 0
          ? Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, version: 1 }))
          : [],
      ),
    )
    mount()
    expect((await ready()).minSpareRows).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(mocks.rows).toHaveBeenLastCalledWith({}, table, 1),
    )
    await waitFor(() => expect(mocks.settings!.minSpareRows).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(screen.getByText('Page 1')).toBeTruthy())
  })
})
