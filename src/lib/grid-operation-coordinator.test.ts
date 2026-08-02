import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import {
  applyScientificRowChanges,
  mutateScientificFormula,
} from '#/lib/scientific-sheet-data'
import type {
  FormulaDefinitionWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import type * as DataClientModule from '#/lib/data-client'
import type * as ScientificSheetDataModule from '#/lib/scientific-sheet-data'

import { GridOperationCoordinator } from './grid-operation-coordinator'
import type {
  CoordinatorConfig,
  PendingCell,
} from './grid-operation-coordinator'

vi.mock('#/lib/scientific-sheet-data', async (importOriginal) => {
  const original = await importOriginal<typeof ScientificSheetDataModule>()
  return {
    ...original,
    applyScientificRowChanges: vi.fn(),
    mutateScientificFormula: vi.fn(),
  }
})

vi.mock('#/lib/data-client', async (importOriginal) => {
  const original = await importOriginal<typeof DataClientModule>()
  return { ...original, DataClientError: original.DataClientError }
})

const applyChanges = vi.mocked(applyScientificRowChanges)
const mutateFormula = vi.mocked(mutateScientificFormula)

const table: ScientificTableWire = {
  id: 'table-1',
  resource_name: 'scientific_rows_1',
  name: 'Test table',
  schema_version: 4,
  lifecycle: 'active',
  columns: [
    {
      id: 'col-a',
      field_name: 'a',
      label: 'A',
      logical_type: 'text',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
      display_order: 0,
    },
    {
      id: 'col-b',
      field_name: 'b',
      label: 'B',
      logical_type: 'text',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
      display_order: 1,
    },
  ],
}

const rows: ScientificRowWire[] = [
  { id: 'row-1', version: 2, a: 'old' },
  { id: 'row-2', version: 7, b: 'old' },
]

function cell(
  rowIndex: number,
  rowId: string | null,
  columnId: string,
  raw: unknown,
  generation = 1,
): PendingCell {
  return {
    rowIndex,
    rowId,
    columnId,
    fieldName: columnId === 'col-a' ? 'a' : 'b',
    raw,
    generation,
  }
}

function formula(rowId: string, columnId: string, version = 1) {
  return {
    id: `formula-${rowId}-${columnId}`,
    target_table_id: table.id,
    target_row_id: rowId,
    target_column_id: columnId,
    source_expression: '=1',
    template: {},
    bindings: {},
    engine_expression: '1',
    syntax_profile: 'default',
    function_profile: 'default',
    literal_profile: 'default',
    engine_version: '1',
    status: 'supported',
    version,
    created_at: '2026-01-01T00:00:00Z',
  } satisfies FormulaDefinitionWire
}

function setup(overrides: Partial<CoordinatorConfig> = {}) {
  const callbacks = {
    onRowsUpdated: vi.fn(),
    onProvisionalRowReplaced: vi.fn(),
    onDraftsCleared: vi.fn(),
    onIssues: vi.fn(),
    onStatusChange: vi.fn(),
    onCalculationNeeded: vi.fn(),
    onRefetchRows: vi.fn(),
  }
  const config: CoordinatorConfig = {
    client: {} as CoordinatorConfig['client'],
    getCanonicalRows: () => rows,
    getFormulaByCell: () => new Map(),
    getTable: () => table,
    isReadOnly: () => false,
    ...callbacks,
    ...overrides,
  }
  return {
    coordinator: new GridOperationCoordinator(config),
    callbacks,
  }
}

async function elapseCoalescingWindow() {
  await vi.advanceTimersByTimeAsync(300)
}

describe('GridOperationCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    applyChanges.mockResolvedValue({
      ok: true,
      schemaVersion: table.schema_version,
      rows,
    })
    mutateFormula.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('coalesces rapid changes to the same cell during the 300ms window', async () => {
    const { coordinator } = setup()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'first')])
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'second', 2)])

    await elapseCoalescingWindow()

    expect(applyChanges).toHaveBeenCalledTimes(1)
    expect(applyChanges.mock.calls[0][3]).toEqual([
      { rowId: 'row-1', expectedVersion: 2, values: { 'col-a': 'second' } },
    ])
  })

  it('preserves order across completed flushes', async () => {
    const { coordinator } = setup()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'first')])
    await elapseCoalescingWindow()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'second')])
    await elapseCoalescingWindow()

    expect(applyChanges).toHaveBeenCalledTimes(2)
    expect(applyChanges.mock.calls.map((call) => call[3][0].values)).toEqual([
      { 'col-a': 'first' },
      { 'col-a': 'second' },
    ])
  })

  it('uses one literal batch and separate writes for formulas on different rows', async () => {
    applyChanges.mockResolvedValue({
      ok: true,
      schemaVersion: table.schema_version,
      rows: [
        { id: 'row-1', version: 3 },
        { id: 'row-2', version: 8 },
      ],
    })
    const { coordinator } = setup()
    coordinator.enqueue([
      cell(0, 'row-1', 'col-a', 'literal one'),
      cell(1, 'row-2', 'col-a', 'literal two'),
      cell(0, 'row-1', 'col-b', '=1+1'),
      cell(1, 'row-2', 'col-b', '=2+2'),
    ])

    await elapseCoalescingWindow()

    expect(applyChanges).toHaveBeenCalledTimes(1)
    expect(applyChanges.mock.calls[0][3]).toHaveLength(2)
    expect(mutateFormula).toHaveBeenCalledTimes(2)
    expect(mutateFormula.mock.calls.map(([write]) => write.target.rowId)).toEqual([
      'row-1',
      'row-2',
    ])
  })

  it('writes multiple formulas in one batch with each row version', async () => {
    const { coordinator } = setup()
    coordinator.enqueue([
      cell(0, 'row-1', 'col-a', '=10'),
      cell(1, 'row-2', 'col-b', '=20'),
    ])

    await elapseCoalescingWindow()

    expect(applyChanges).not.toHaveBeenCalled()
    expect(mutateFormula).toHaveBeenCalledTimes(2)
    expect(mutateFormula.mock.calls.map(([write]) => write)).toEqual([
      expect.objectContaining({
        operation: 'create',
        expectedRowVersion: 2,
        source: '=10',
      }),
      expect.objectContaining({
        operation: 'create',
        expectedRowVersion: 7,
        source: '=20',
      }),
    ])
  })

  it('maps a registered provisional token to the inserted server UUID', async () => {
    applyChanges.mockResolvedValue({
      ok: true,
      schemaVersion: table.schema_version,
      rows: [{ id: 'real-uuid', version: 1 }],
    })
    const { coordinator, callbacks } = setup()
    coordinator.registerProvisionalRow('prov:new-row')

    await elapseCoalescingWindow()

    expect(applyChanges).toHaveBeenCalledWith(
      expect.anything(),
      table.id,
      table.schema_version,
      [],
      [{}],
    )
    expect(callbacks.onProvisionalRowReplaced).toHaveBeenCalledWith(
      'prov:new-row',
      'real-uuid',
    )
  })

  it('retries a transient failure after backoff', async () => {
    applyChanges
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: table.schema_version,
        rows,
      })
    const { coordinator, callbacks } = setup()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'new')])

    await vi.advanceTimersByTimeAsync(800)

    expect(applyChanges).toHaveBeenCalledTimes(2)
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('retrying')
    expect(callbacks.onRowsUpdated).toHaveBeenCalledTimes(1)
  })

  it('surfaces stale_version immediately without retrying', async () => {
    applyChanges.mockRejectedValue(
      new DataClientError('stale_version', 'Version conflict', 409),
    )
    const { coordinator, callbacks } = setup()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'new')])

    await elapseCoalescingWindow()
    await vi.runAllTimersAsync()

    expect(applyChanges).toHaveBeenCalledTimes(1)
    expect(callbacks.onRefetchRows).toHaveBeenCalledTimes(1)
    expect(callbacks.onIssues).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'row-1:conflict' }),
    ])
    expect(callbacks.onStatusChange).not.toHaveBeenCalledWith('retrying')
  })

  it('reports pending edits while queued and not after the flush', async () => {
    const { coordinator } = setup()
    expect(coordinator.hasPendingEdits()).toBe(false)
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'new')])
    expect(coordinator.hasPendingEdits()).toBe(true)

    await elapseCoalescingWindow()

    expect(coordinator.hasPendingEdits()).toBe(false)
  })

  it('prevents queued and in-flight callbacks after destroy', async () => {
    const queued = setup()
    queued.coordinator.destroy()
    queued.coordinator.enqueue([cell(0, 'row-1', 'col-a', 'ignored')])
    await elapseCoalescingWindow()
    expect(applyChanges).not.toHaveBeenCalled()

    let resolveWrite!: (value: Awaited<ReturnType<typeof applyChanges>>) => void
    applyChanges.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve
        }),
    )
    const active = setup()
    active.coordinator.enqueue([cell(0, 'row-1', 'col-a', 'in flight')])
    const timerAdvance = vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(0)
    active.coordinator.destroy()
    resolveWrite({ ok: true, schemaVersion: table.schema_version, rows })
    await timerAdvance

    expect(active.callbacks.onRowsUpdated).not.toHaveBeenCalled()
    expect(active.callbacks.onDraftsCleared).not.toHaveBeenCalled()
    expect(active.callbacks.onIssues).not.toHaveBeenCalled()
    expect(active.callbacks.onCalculationNeeded).not.toHaveBeenCalled()
  })

  it('increments versions for two formulas on the same row', async () => {
    const formulas = new Map([
      ['row-1/col-a', formula('row-1', 'col-a', 5)],
      ['row-1/col-b', formula('row-1', 'col-b', 8)],
    ])
    const { coordinator } = setup({ getFormulaByCell: () => formulas })
    coordinator.enqueue([
      cell(0, 'row-1', 'col-a', '=11'),
      cell(0, 'row-1', 'col-b', '=12'),
    ])
    await elapseCoalescingWindow()

    expect(mutateFormula.mock.calls.map(([write]) => write.expectedRowVersion)).toEqual([
      2, 3,
    ])
  })
})
