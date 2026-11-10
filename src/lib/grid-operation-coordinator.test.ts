import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '#/lib/data-client'
import { buildPersistedFormulaArtifact, parseFormula } from '#/lib/formula-ir'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import type {
  FormulaDefinitionWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'

import { GridOperationCoordinator } from './grid-operation-coordinator'
import type {
  CoordinatorConfig,
  PendingCell,
} from './grid-operation-coordinator'

const literalRequestSchema = z.object({
  p_table_id: z.string(),
  p_expected_schema_version: z.number(),
  p_edits: z.array(
    z.object({
      rowId: z.string(),
      expectedVersion: z.number(),
      values: pipelineJsonObjectSchema,
    }),
  ),
  p_inserts: z.array(pipelineJsonObjectSchema),
})

const formulaRequestSchema = z.object({
  operation: z.enum(['create', 'update', 'remove']),
  target: z.object({
    tableId: z.string(),
    rowId: z.string(),
    columnId: z.string(),
  }),
  expectedSchemaVersion: z.number(),
  expectedRowVersion: z.number(),
  expectedFormulaVersion: z.number().optional(),
  source: z.string().optional(),
  replacement: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
})

const literalRequests: z.infer<typeof literalRequestSchema>[] = []
const formulaRequests: z.infer<typeof formulaRequestSchema>[] = []
const formulaResponses: Response[] = []
const requestOrder: string[] = []
const coordinators: GridOperationCoordinator[] = []
const applyChanges = vi.fn<typeof fetch>()

const transport: typeof fetch = async (input, init) => {
  const request =
    input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(input, 'http://localhost'), init)

  expect(request.method).toBe('POST')
  const path = new URL(request.url).pathname
  requestOrder.push(path)

  if (path === '/api/db/rpc/apply_scientific_row_changes') {
    literalRequests.push(literalRequestSchema.parse(await request.json()))

    return applyChanges(input, init)
  }

  if (path === '/api/formulas') {
    formulaRequests.push(formulaRequestSchema.parse(await request.json()))

    return formulaResponses.shift() ?? Response.json({ ok: true })
  }

  throw new Error(`Unexpected HTTP request: ${path}`)
}

function rowResponse(resultRows: ScientificRowWire[] = rows) {
  return Response.json({
    ok: true,
    schemaVersion: table.schema_version,
    rows: resultRows,
  })
}

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
  raw: string,
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
  const artifact = buildPersistedFormulaArtifact(
    parseFormula('=1', {
      rowIds: rows.map((row) => row.id),
      columnIds: table.columns.map((column) => column.id),
    }),
    table.id,
  )

  return {
    id: `formula-${rowId}-${columnId}`,
    target_table_id: table.id,
    target_row_id: rowId,
    target_column_id: columnId,
    source_expression: '=1',
    template: artifact.template,
    bindings: artifact.bindings,
    engine_expression: artifact.engineExpression,
    syntax_profile: artifact.syntaxProfile,
    function_profile: artifact.functionProfile,
    literal_profile: artifact.literalProfile,
    engine_version: artifact.engineVersion,
    status: artifact.status,
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
    client: createDataClient(transport),
    getCanonicalRows: () => rows,
    getFormulaByCell: () => new Map(),
    getTable: () => table,
    isReadOnly: () => false,
    ...callbacks,
    ...overrides,
  }

  const coordinator = new GridOperationCoordinator(config)
  coordinators.push(coordinator)

  return {
    coordinator,
    callbacks,
  }
}

async function elapseCoalescingWindow() {
  await vi.advanceTimersByTimeAsync(300)
}

describe('GridOperationCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    literalRequests.length = 0
    formulaRequests.length = 0
    formulaResponses.length = 0
    requestOrder.length = 0
    applyChanges.mockReset().mockImplementation(async () => rowResponse())
    vi.stubGlobal('fetch', transport)
  })

  afterEach(() => {
    for (const coordinator of coordinators) coordinator.destroy()
    coordinators.length = 0
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('coalesces rapid changes to the same cell during the 300ms window', async () => {
    const { coordinator } = setup()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'first')])
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'second', 2)])

    await elapseCoalescingWindow()

    expect(applyChanges).toHaveBeenCalledTimes(1)
    expect(literalRequests[0].p_edits).toEqual([
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
    expect(literalRequests.map((request) => request.p_edits[0].values)).toEqual(
      [{ 'col-a': 'first' }, { 'col-a': 'second' }],
    )
  })

  it('uses one literal batch and separate writes for formulas on different rows', async () => {
    applyChanges.mockImplementation(async () =>
      rowResponse([
        { id: 'row-1', version: 3 },
        { id: 'row-2', version: 8 },
      ]),
    )
    const { coordinator } = setup()
    coordinator.enqueue([
      cell(0, 'row-1', 'col-a', 'literal one'),
      cell(1, 'row-2', 'col-a', 'literal two'),
      cell(0, 'row-1', 'col-b', '=1+1'),
      cell(1, 'row-2', 'col-b', '=2+2'),
    ])

    await elapseCoalescingWindow()

    expect(applyChanges).toHaveBeenCalledTimes(1)
    expect(literalRequests[0].p_edits).toHaveLength(2)
    expect(formulaRequests).toHaveLength(2)
    expect(formulaRequests.map((write) => write.target.rowId)).toEqual([
      'row-1',
      'row-2',
    ])
    expect(requestOrder).toEqual([
      '/api/db/rpc/apply_scientific_row_changes',
      '/api/formulas',
      '/api/formulas',
    ])
    expect(formulaRequests.map((write) => write.expectedRowVersion)).toEqual([
      3, 8,
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
    expect(formulaRequests).toHaveLength(2)
    expect(formulaRequests).toEqual([
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
    applyChanges.mockImplementation(async () =>
      rowResponse([{ id: 'real-uuid', version: 1 }]),
    )
    const { coordinator, callbacks } = setup()
    coordinator.registerProvisionalRow('prov:new-row')

    await elapseCoalescingWindow()

    expect(literalRequests).toEqual([
      {
        p_table_id: table.id,
        p_expected_schema_version: table.schema_version,
        p_edits: [],
        p_inserts: [{}],
      },
    ])
    expect(callbacks.onProvisionalRowReplaced).toHaveBeenCalledWith(
      'prov:new-row',
      'real-uuid',
    )
  })

  it('retries a transient failure after backoff', async () => {
    applyChanges
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockImplementationOnce(async () => rowResponse())
    const { coordinator, callbacks } = setup()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'new')])

    await vi.advanceTimersByTimeAsync(800)

    expect(applyChanges).toHaveBeenCalledTimes(2)
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('retrying')
    expect(callbacks.onRowsUpdated).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest cell value when an in-flight batch fails', async () => {
    let rejectWrite: ((error: Error) => void) | undefined
    applyChanges.mockImplementationOnce(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectWrite = reject
        }),
    )
    const { coordinator, callbacks } = setup({ coalesceMs: 1000 })
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'older')])
    const firstFlush = vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(literalRequests).toHaveLength(1)
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'newer', 2)])

    if (!rejectWrite) throw new Error('The first HTTP write did not start.')
    rejectWrite(new Error('network unavailable'))
    await vi.advanceTimersByTimeAsync(500)
    await firstFlush

    expect(literalRequests.map((request) => request.p_edits)).toEqual([
      [{ rowId: 'row-1', expectedVersion: 2, values: { 'col-a': 'older' } }],
      [{ rowId: 'row-1', expectedVersion: 2, values: { 'col-a': 'newer' } }],
    ])
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('retrying')
    expect(callbacks.onRowsUpdated).toHaveBeenCalledTimes(1)
  })

  it.each([
    { raw: { nested: 'not a scalar' } },
    { raw: ['not a scalar'] },
    { raw: Number.NaN },
    { raw: Number.POSITIVE_INFINITY },
    { raw: 1n },
  ])(
    'rejects malformed raw input without HTTP writes or retries: $raw',
    async ({ raw }) => {
      const { coordinator, callbacks } = setup()
      coordinator.enqueue([{ ...cell(0, 'row-1', 'col-a', ''), raw }])
      await elapseCoalescingWindow()
      await vi.runAllTimersAsync()

      expect(requestOrder).toEqual([])
      expect(callbacks.onIssues).toHaveBeenCalledWith([
        { key: '0:col-a', message: 'A must be a scalar value.' },
      ])
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('error')
      expect(callbacks.onStatusChange).not.toHaveBeenCalledWith('retrying')
    },
  )

  it.each([
    { raw: undefined, expected: null },
    { raw: null, expected: null },
    { raw: false, expected: false },
    { raw: 0, expected: false },
    { raw: true, expected: true },
  ])(
    'decodes optional and boolean raw inputs before writing: $raw',
    async ({ raw, expected }) => {
      const { coordinator } = setup({
        getTable: () => ({
          ...table,
          columns: table.columns.map((column) => ({
            ...column,
            logical_type: 'boolean',
          })),
        }),
      })

      coordinator.enqueue([{ ...cell(0, 'row-1', 'col-a', ''), raw }])
      await elapseCoalescingWindow()

      expect(literalRequests[0].p_edits).toEqual([
        { rowId: 'row-1', expectedVersion: 2, values: { 'col-a': expected } },
      ])
    },
  )

  it('surfaces stale_version immediately without retrying', async () => {
    applyChanges.mockImplementation(async () =>
      Response.json(
        { error: { code: 'stale_version', message: 'Version conflict' } },
        { status: 409 },
      ),
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

  it('surfaces 400 bad request immediately without retrying', async () => {
    applyChanges.mockImplementation(async () =>
      Response.json(
        { error: { code: 'validation_error', message: 'Invalid value' } },
        { status: 400 },
      ),
    )
    const { coordinator, callbacks } = setup()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'bad')])

    await elapseCoalescingWindow()
    await vi.runAllTimersAsync()

    expect(applyChanges).toHaveBeenCalledTimes(1)
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('error')
    expect(callbacks.onStatusChange).not.toHaveBeenCalledWith('retrying')
    expect(callbacks.onIssues).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'row-1:col-a', message: 'Invalid value' }),
    ])
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

    let resolveWrite: ((response: Response) => void) | undefined
    applyChanges.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveWrite = resolve
        }),
    )
    const active = setup()
    active.coordinator.enqueue([cell(0, 'row-1', 'col-a', 'in flight')])
    const timerAdvance = vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(0)
    active.coordinator.destroy()

    if (!resolveWrite)
      throw new Error('The in-flight HTTP write did not start.')
    resolveWrite(rowResponse())
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

    expect(formulaRequests.map((write) => write.expectedRowVersion)).toEqual([
      2, 3,
    ])
    expect(
      formulaRequests.map((write) => write.expectedFormulaVersion),
    ).toEqual([5, 8])
  })

  it('removes a formula with a scalar replacement and advances the next literal version', async () => {
    const formulas = new Map([['row-1/col-a', formula('row-1', 'col-a', 5)]])
    const onFormulaPersisted = vi.fn()

    const { coordinator } = setup({
      getFormulaByCell: () => formulas,
      onFormulaPersisted,
    })

    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'replacement')])
    await elapseCoalescingWindow()

    expect(literalRequests).toEqual([])
    expect(formulaRequests).toEqual([
      {
        operation: 'remove',
        target: { tableId: table.id, rowId: 'row-1', columnId: 'col-a' },
        expectedSchemaVersion: 4,
        expectedRowVersion: 2,
        expectedFormulaVersion: 5,
        replacement: 'replacement',
      },
    ])
    expect(onFormulaPersisted).toHaveBeenCalledWith(
      { tableId: table.id, rowId: 'row-1', columnId: 'col-a' },
      null,
    )

    formulas.clear()
    coordinator.enqueue([cell(0, 'row-1', 'col-a', 'later literal')])
    await elapseCoalescingWindow()
    expect(literalRequests[0].p_edits).toEqual([
      {
        rowId: 'row-1',
        expectedVersion: 3,
        values: { 'col-a': 'later literal' },
      },
    ])
  })

  it('stops at a failed formula without advancing the row version or starting later writes', async () => {
    formulaResponses.push(
      Response.json(
        { error: { code: 'formula_write_failed', message: 'Write failed' } },
        { status: 500 },
      ),
    )
    const onFormulaPersisted = vi.fn()

    const { coordinator, callbacks } = setup({
      maxRetries: 0,
      onFormulaPersisted,
    })

    coordinator.enqueue([
      cell(0, 'row-1', 'col-a', '=11'),
      cell(0, 'row-1', 'col-b', '=12'),
    ])
    await elapseCoalescingWindow()

    expect(formulaRequests).toHaveLength(1)
    expect(formulaRequests[0].source).toBe('=11')
    expect(onFormulaPersisted).not.toHaveBeenCalled()
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('error')
    expect(callbacks.onRefetchRows).toHaveBeenCalledTimes(1)

    coordinator.enqueue([cell(0, 'row-1', 'col-a', '=13')])
    await elapseCoalescingWindow()
    expect(formulaRequests.map((write) => write.expectedRowVersion)).toEqual([
      2, 2,
    ])
    expect(onFormulaPersisted).toHaveBeenCalledTimes(1)
  })

  it('writes a provisional formula only after receiving its durable row identity', async () => {
    applyChanges.mockImplementation(async () =>
      rowResponse([{ id: 'real-uuid', version: 1 }]),
    )
    const { coordinator, callbacks } = setup()
    coordinator.registerProvisionalRow('prov:new-row')
    coordinator.enqueue([cell(2, 'prov:new-row', 'col-b', '=2**3')])
    await elapseCoalescingWindow()

    expect(literalRequests[0].p_inserts).toEqual([{}])
    expect(requestOrder).toEqual([
      '/api/db/rpc/apply_scientific_row_changes',
      '/api/formulas',
    ])
    expect(formulaRequests).toEqual([
      {
        operation: 'create',
        target: { tableId: table.id, rowId: 'real-uuid', columnId: 'col-b' },
        expectedSchemaVersion: 4,
        expectedRowVersion: 1,
        source: '=2^3',
      },
    ])
    expect(callbacks.onProvisionalRowReplaced).toHaveBeenCalledWith(
      'prov:new-row',
      'real-uuid',
    )
  })

  it('preserves engine-translated formula strings from autofill (relative, absolute, mixed)', async () => {
    // When a user drags the fill handle down, the grid engine translates
    // references and produces formula strings (e.g. =A2, =$A$1, =$A2, =A$1).
    // The coordinator must pass these through verbatim — no regex A1
    // translation on our side.
    const { coordinator } = setup()
    coordinator.enqueue([
      cell(0, 'row-1', 'col-a', '=A2'),
      cell(1, 'row-2', 'col-a', '=$A$1'),
      cell(0, 'row-1', 'col-b', '=$A2'),
      cell(1, 'row-2', 'col-b', '=A$1'),
    ])
    await elapseCoalescingWindow()

    expect(applyChanges).not.toHaveBeenCalled()
    expect(formulaRequests).toHaveLength(4)
    // Each formula source must be exactly what the engine produced.
    expect(formulaRequests.map((write) => write.source)).toEqual([
      '=A2',
      '=$A$1',
      '=$A2',
      '=A$1',
    ])
  })
})
