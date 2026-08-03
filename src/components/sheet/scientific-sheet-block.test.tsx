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
import type { ScientificWorkbook, WorkbookCellAddress } from '#/lib/scientific-workbook'
import { ScientificSheetBlock, safeWorkbookGet } from './scientific-sheet-block'
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
    mocks.allRows.mockResolvedValue([
      { id: 'r1', version: 1, col_category: 'option-id' },
    ])
    mount()
    const settings = await ready()
    expect(settings.columns.map((x: any) => x.type)).toEqual([
      'text',
      'numeric',
      'dropdown',
    ])
    expect(settings.colHeaders).toEqual(['A · Name', 'B · Mass (mg)', 'C · State'])
    expect(settings.data[0].col_category).toBe('Ready')
  })

  it('defers configuration and trusted-cache metadata until interaction', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mount()
    const settings = await ready()
    expect(mocks.dependencies).not.toHaveBeenCalled()
    expect(mocks.calculationResults).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    await waitFor(() => expect(mocks.dependencies).toHaveBeenCalledTimes(1))

    settings.afterSelectionEnd(0, 0)
    expect(mocks.calculationResults).not.toHaveBeenCalled()
  })

  it('submits one batch for multiple existing cells and mixed spare rows', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 4, col_text: 'old' }])
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
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 1 }])
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
    // Drafts are preserved in React state (not in settings.data — see the
    // gridData/localRows split) and the save status surfaces the failure.
    screen.getByLabelText('Save failed')
  })

  it('preserves stale drafts, identifies the row, and refetches', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mocks.apply.mockRejectedValue(
      new DataClientError('stale_version', 'stale', 409),
    )
    mount()
    const settings = await ready()
    settings.afterChange([[0, 'col_text', null, 'raw']], 'edit')
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Row 1 changed elsewhere',
    )
    // Drafts are preserved in React state (not in settings.data — see the
    // gridData/localRows split) and the save status surfaces the conflict.
    screen.getByLabelText('Save failed')
    await waitFor(() => expect(mocks.allRows.mock.calls.length).toBeGreaterThan(1))
  })

  it('coalesces rapid edits into one batch using the initial canonical version', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mocks.apply.mockResolvedValue({
      ok: true,
      schemaVersion: 2,
      rows: [{ id: 'r1', version: 2 }],
    })
    mount()
    const settings = await ready()
    // Two rapid edits within the coalescing window are merged into one
    // batch that uses the initial canonical version (1).
    settings.afterChange([[0, 'col_text', null, 'first']], 'edit')
    settings.afterChange([[0, 'col_number', null, '2']], 'edit')
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1))
    const edits = mocks.apply.mock.calls[0][3]
    expect(edits).toHaveLength(1)
    expect(edits[0].expectedVersion).toBe(1)
    expect(edits[0].values).toEqual({ text: 'first', number: 2 })
  })

  it('accepts a formula in a numeric cell before literal decoding', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 4 }])
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

  it('routes a formula bar commit on a provisional row through the coordinator', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([])
    mocks.apply.mockResolvedValue({
      ok: true,
      schemaVersion: 2,
      rows: [{ id: 'real-uuid', version: 1 }],
    })
    mocks.formulaMutation.mockResolvedValue({})
    mount()
    await ready()
    // Simulate clicking "Add row" — adds a provisional row to the cache.
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    // The provisional row appears in the grid data (read latest settings).
    await waitFor(() =>
      expect(
        mocks.settings!.data.some((r: any) => r.id?.startsWith('prov:')),
      ).toBe(true),
    )
    // Select the provisional row's first cell (column 1 = number column).
    // Use the latest afterSelectionEnd callback — the settings object was
    // recreated after the Add Row click re-rendered the component.
    mocks.settings!.afterSelectionEnd(0, 1)
    // Wait for the selection to take effect — the formula input should
    // become enabled and the address box should show B1.
    await waitFor(() =>
      expect(screen.getByLabelText('Active cell address').textContent).toBe(
        'B1',
      ),
    )
    // Type a formula in the formula bar and commit with Enter.
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Formula source',
    })
    fireEvent.change(input, { target: { value: '=2**3' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // The coordinator should enqueue the formula and trigger an insert
    // (applyScientificRowChanges), not mutateScientificFormula directly
    // with the prov: ID.
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1))
    // After the insert returns, the formula is applied to the real UUID.
    await waitFor(() =>
      expect(mocks.formulaMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'create',
          target: expect.objectContaining({ rowId: 'real-uuid' }),
          source: '=2^3',
        }),
      ),
    )
  })

  it('migrates selection to the real UUID after the empty insert completes, then formula bar commits directly', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([])
    mocks.apply.mockResolvedValue({
      ok: true,
      schemaVersion: 2,
      rows: [{ id: 'real-uuid', version: 1 }],
    })
    mocks.formulaMutation.mockResolvedValue({})
    mount()
    await ready()
    // Click Add Row — schedules an empty insert after the 300ms coalesce.
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    // Select the provisional row's first editable cell.
    await waitFor(() =>
      expect(
        mocks.settings!.data.some((r: any) => r.id?.startsWith('prov:')),
      ).toBe(true),
    )
    mocks.settings!.afterSelectionEnd(0, 1)
    await waitFor(() =>
      expect(screen.getByLabelText('Active cell address').textContent).toBe(
        'B1',
      ),
    )
    // Wait for the empty insert to flush and resolve — the coordinator
    // sends the insert after ~300ms, and onProvisionalRowReplaced swaps
    // the prov: id for real-uuid in both the cache and the selection.
    await waitFor(
      () => expect(mocks.apply).toHaveBeenCalledTimes(1),
      { timeout: 2000 },
    )
    // After the swap, the address box still shows B1 but the underlying
    // rowId is now real-uuid (not prov:). The formula bar commit should
    // go directly to mutateScientificFormula with the real UUID — no
    // second apply call.
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Formula source',
    })
    fireEvent.change(input, { target: { value: '=2**3' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(mocks.formulaMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'create',
          target: expect.objectContaining({ rowId: 'real-uuid' }),
          source: '=2^3',
        }),
      ),
    )
    // No second insert should have been sent — the formula went directly.
    expect(mocks.apply).toHaveBeenCalledTimes(1)
  })

  it('supports mixed formula and literal batches without partial writes', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([
      { id: 'r1', version: 1 },
      { id: 'r2', version: 1 },
    ])
    mocks.apply.mockResolvedValue({
      ok: true,
      schemaVersion: 2,
      rows: [{ id: 'r1', version: 2 }, { id: 'r2', version: 2 }],
    })
    mocks.formulaMutation.mockResolvedValue({})
    mount()
    const settings = await ready()
    // A batch containing both a formula and a literal is now supported.
    // The literal goes through applyScientificRowChanges; the formula
    // goes through mutateScientificFormula with the correct version.
    settings.afterChange(
      [
        [0, 'col_number', null, '=1+2'],
        [0, 'col_text', null, 'literal'],
        [1, 'col_number', null, '=2+3'],
      ],
      'CopyPaste.paste',
    )
    // Both the literal RPC and both formula writes should fire.
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(mocks.formulaMutation).toHaveBeenCalledTimes(2),
    )
    // The literal edit uses the initial version.
    const edits = mocks.apply.mock.calls[0][3]
    expect(edits[0].rowId).toBe('r1')
    expect(edits[0].values).toEqual({ text: 'literal' })
    // The formula on r1 uses the version returned by the literal RPC (2).
    const formulaCallR1 = mocks.formulaMutation.mock.calls.find(
      (c: any) => c[0].target.rowId === 'r1',
    )!
    expect(formulaCallR1[0].expectedRowVersion).toBe(2)
    expect(formulaCallR1[0].source).toBe('=1+2')
    // The formula on r2 uses its initial version (2, from the RPC).
    const formulaCallR2 = mocks.formulaMutation.mock.calls.find(
      (c: any) => c[0].target.rowId === 'r2',
    )!
    expect(formulaCallR2[0].source).toBe('=2+3')
  })

  it('reconstructs a persisted formula and shows its source in the formula bar', async () => {
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
        function_profile: 'scientific-core-v2',
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
    // The grid injects the HyperFormula engine expression for same-sheet
    // formulas so the Handsontable formulas plugin computes them inline.
    // The plugin itself doesn't run in this test (SheetbaseGrid is mocked),
    // so the cell value is the engine expression, not the computed result.
    await waitFor(() =>
      expect(mocks.settings!.data[1].col_number).toBe('=(A1*2)'),
    )
    // The formula bar is always visible (not conditionally hidden).
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Formula source',
    })
    // No cell selected yet — input is disabled with placeholder.
    expect(input.hasAttribute('disabled')).toBe(true)
    expect(input.placeholder).toBe('Select a cell')
    // Selecting a cell populates the formula source.
    mocks.settings!.afterSelectionEnd(1, 0)
    await waitFor(() => expect(input.value).toBe('=A1*2'))
    expect(input.hasAttribute('disabled')).toBe(false)
    // The simplified formula bar has no Apply, Remove, or Recalculate
    // buttons, no status row, and no dependency inspector.
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recalculate' })).toBeNull()
    expect(screen.queryByText(/supported ·/)).toBeNull()
    expect(screen.queryByText(/cache:/)).toBeNull()
    expect(screen.queryByText(/Inspect.*stable dependencies/)).toBeNull()
  })

  it('commits a formula via Enter in the formula bar and cancels via Escape', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mocks.formulaMutation.mockResolvedValue({})
    mocks.calculate.mockResolvedValue({ status: 'completed' })
    mount()
    const settings = await ready()
    // Select a cell.
    settings.afterSelectionEnd(0, 0)
    const input = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Formula source',
    })
    // The address box shows the A1 notation of the selected cell.
    const address = screen.getByLabelText('Active cell address')
    expect(address.textContent).toBe('A1')
    // Type a formula.
    fireEvent.change(input, { target: { value: '=1+2' } })
    expect(input.value).toBe('=1+2')
    // Enter commits the formula via mutateScientificFormula.
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(mocks.formulaMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'create',
          source: '=1+2',
        }),
      ),
    )
    // Recalculation is triggered after a formula write.
    await waitFor(() =>
      expect(mocks.calculate).toHaveBeenCalledWith(block.recordId),
    )
    // Escape cancels: typing then Escape reverts to the cell's current
    // formula (empty for a literal cell).
    fireEvent.change(input, { target: { value: '=999' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
  })

  it('normalises ** to ^ when committing a formula via the formula bar', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mocks.formulaMutation.mockResolvedValue({})
    mocks.calculate.mockResolvedValue({ status: 'completed' })
    mount()
    const settings = await ready()
    settings.afterSelectionEnd(0, 1)
    const input = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Formula source',
    })
    // The address box shows B1 for row 0, col 1.
    expect(screen.getByLabelText('Active cell address').textContent).toBe('B1')
    fireEvent.change(input, { target: { value: '=2**3' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(mocks.formulaMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          source: '=2^3',
        }),
      ),
    )
    // The formula bar displays the canonical ^ form.
    expect(input.value).toBe('=2^3')
  })

  it('fully disables mutation affordances in read-only mode', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([])
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
    // The formula bar is not rendered in read-only mode.
    expect(screen.queryByRole('textbox', { name: 'Formula source' })).toBeNull()
    expect(screen.queryByLabelText('Formula bar')).toBeNull()
  })

  it('uses an explicit context-menu item list with only truthful operations', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([])
    mount()
    const settings = await ready()
    // contextMenu is an object with an items array (not `true`) so only
    // truthful, data-model-backed operations are exposed. Column insert/
    // remove, read-only toggle, and alignment are absent — they would
    // mutate Handsontable locally without persisting.
    expect(settings.contextMenu).toBeTypeOf('object')
    expect(settings.contextMenu).not.toBe(false)
    const items = settings.contextMenu.items
    expect(Array.isArray(items)).toBe(true)
    const itemKeys = items.map((item: any) =>
      typeof item === 'string' ? item : item.name,
    )
    expect(itemKeys).toEqual(
      expect.arrayContaining([
        'row_above',
        'row_below',
        'remove_row',
        'undo',
        'redo',
      ]),
    )
    // Dishonest items are absent.
    expect(itemKeys).not.toContain('col_left')
    expect(itemKeys).not.toContain('col_right')
    expect(itemKeys).not.toContain('remove_col')
    expect(itemKeys).not.toContain('make_readonly')
    expect(itemKeys).not.toContain('alignment')
    // Custom items are present.
    expect(itemKeys).toContain('Clear contents')
    expect(itemKeys).toContain('Configure columns…')
  })

  it('adds a fully typed category column with stable option UUIDs', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([])
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
    mocks.allRows.mockResolvedValue([])
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
    mocks.allRows.mockResolvedValue([])
    mocks.add.mockRejectedValue(new Error('schema cache is not ready'))
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
    fireEvent.change(screen.getByLabelText('New column label'), {
      target: { value: 'Failed column' },
    })
    const tableFetches = mocks.table.mock.calls.length
    const rowFetches = mocks.allRows.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect((await screen.findByRole('status')).textContent).toContain(
      'schema cache is not ready',
    )
    expect(mocks.table).toHaveBeenCalledTimes(tableFetches)
    expect(mocks.allRows).toHaveBeenCalledTimes(rowFetches)
  })

  it.each(['service_unavailable', 'stale_version'])(
    'reconciles metadata and rows after ambiguous %s schema failures',
    async (code) => {
      mocks.table.mockResolvedValue(table)
      mocks.allRows.mockResolvedValue([])
      mocks.add.mockRejectedValue(new DataClientError(code, 'retry', 503))
      mount()
      await ready()
      fireEvent.click(screen.getByRole('button', { name: 'Configure table' }))
      fireEvent.change(screen.getByLabelText('New column label'), {
        target: { value: 'Maybe committed' },
      })
      const tableFetches = mocks.table.mock.calls.length
      const rowFetches = mocks.allRows.mock.calls.length
      fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
      await waitFor(() =>
        expect(mocks.table.mock.calls.length).toBeGreaterThan(tableFetches),
      )
      await waitFor(() =>
        expect(mocks.allRows.mock.calls.length).toBeGreaterThan(rowFetches),
      )
      expect(screen.getByRole('status').textContent).toContain(
        'Could not update schema',
      )
    },
  )

  it('preserves text null and rejects unsafe integers and duplicate category labels', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([])
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
    mocks.allRows.mockResolvedValue([{ id: 'r1', version: 1 }])
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
    mocks.allRows.mockResolvedValue([])
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
    mocks.allRows.mockResolvedValue([])
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

  it('loads all rows without pagination and always offers a spare row when editable', async () => {
    mocks.table.mockResolvedValue(table)
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: `r${i}`,
      version: 1,
    }))
    mocks.allRows.mockResolvedValue(many)
    mount()
    const settings = await ready()
    // No pagination controls — the full dataset is bound to the grid.
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
    expect(screen.queryByText(/Page \d+/)).toBeNull()
    // Every row is present (no 200-row page truncation).
    expect(settings.data).toHaveLength(250)
    expect(settings.minSpareRows).toBe(1)
    expect(screen.getByText('250 rows')).toBeTruthy()
  })

  it('provides no spare row in read-only mode', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.allRows.mockResolvedValue([
      { id: 'r1', version: 1 },
      { id: 'r2', version: 1 },
    ])
    mount({ readOnly: true })
    const settings = await ready()
    expect(settings.minSpareRows).toBe(0)
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })
})

describe('safeWorkbookGet', () => {
  const address: WorkbookCellAddress = {
    tableId: 'table-1',
    rowId: 'r1',
    columnId: 'number',
  }

  it('returns the workbook result when get() succeeds', () => {
    const workbook = {
      get: vi.fn().mockReturnValue({ status: 'ok', logical: { ok: true, value: 42 } }),
    } as unknown as ScientificWorkbook
    expect(safeWorkbookGet(workbook, address)).toEqual({
      status: 'ok',
      logical: { ok: true, value: 42 },
    })
  })

  it('returns null when get() throws (stale workbook)', () => {
    const workbook = {
      get: vi.fn().mockImplementation(() => {
        throw new Error('Unknown stable cell identity.')
      }),
    } as unknown as ScientificWorkbook
    expect(safeWorkbookGet(workbook, address)).toBeNull()
  })

  it('does not swallow non-locate errors silently — any throw returns null', () => {
    // The guard is intentionally broad: any throw from the workbook (stale
    // maps, destroyed engine, etc.) degrades to null rather than crashing
    // render.
    const workbook = {
      get: vi.fn().mockImplementation(() => {
        throw new TypeError('engine destroyed')
      }),
    } as unknown as ScientificWorkbook
    expect(safeWorkbookGet(workbook, address)).toBeNull()
  })
})
