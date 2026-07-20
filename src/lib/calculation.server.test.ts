// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { executeCalculation, handleCalculation } from './calculation.server'
import type { CalculationDeps, CalculationSnapshot } from './calculation.server'
import { buildPersistedFormulaArtifact, parseFormula } from './formula-ir'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

const recordId = '10000000-0000-4000-8000-000000000001'
const tableId = '10000000-0000-4000-8000-000000000002'
const rowId = '10000000-0000-4000-8000-000000000003'
const sourceColumnId = '10000000-0000-4000-8000-000000000004'
const targetColumnId = '10000000-0000-4000-8000-000000000005'
const formulaId = '10000000-0000-4000-8000-000000000006'

function snapshot(source = '=A1*2'): CalculationSnapshot {
  const formula = buildPersistedFormulaArtifact(
    parseFormula(source, {
      tableId,
      rowIds: [rowId],
      columnIds: [sourceColumnId, targetColumnId],
    }),
    tableId,
  )
  return {
    recordId,
    inputRevision: 7,
    schemaVersions: { [tableId]: 2 },
    formulas: [
      {
        id: formulaId,
        version: 3,
        status: 'supported',
        address: { tableId, rowId, columnId: targetColumnId },
      },
    ],
    tables: [
      {
        id: tableId,
        columns: [sourceColumnId, targetColumnId].map((id) => ({
          id,
          createdAt: id === sourceColumnId ? '2024-01-01' : '2024-01-02',
          logicalType: 'decimal' as const,
        })),
        rows: [
          {
            id: rowId,
            createdAt: '2024-01-01',
            cells: {
              [sourceColumnId]: { literal: 3 },
              [targetColumnId]: { formula },
            },
          },
        ],
      },
    ],
  }
}

describe('trusted calculation server', () => {
  it('calculates the whole snapshot and submits typed revision-bound values', async () => {
    const value = snapshot()
    const finalize = vi
      .fn()
      .mockImplementation(
        async (
          _actor,
          _snapshot,
          outcome,
          results: Array<Record<string, unknown>>,
        ) => ({
          recordId,
          inputRevision: 7,
          status: outcome,
          formulaCount: results.length,
        }),
      )
    await expect(
      executeCalculation('user', recordId, {
        loadSnapshot: vi.fn().mockResolvedValue(value),
        finalize,
      }),
    ).resolves.toMatchObject({ status: 'completed', formulaCount: 1 })
    expect(finalize).toHaveBeenCalledWith('user', value, 'completed', [
      {
        formulaId,
        formulaVersion: 3,
        status: 'completed',
        resultKind: 'value',
        value: 6,
      },
    ])
  })

  it('preserves structured calculation errors as current results', async () => {
    const value = snapshot('=1/0')
    const finalize = vi.fn().mockResolvedValue({
      recordId,
      inputRevision: 7,
      status: 'completed',
      formulaCount: 1,
    })
    await executeCalculation('user', recordId, {
      loadSnapshot: vi.fn().mockResolvedValue(value),
      finalize,
    })
    expect(finalize.mock.calls[0][3][0]).toMatchObject({
      status: 'completed',
      resultKind: 'error',
      errorCode: 'DIV_BY_ZERO',
    })
  })

  it('keeps unsupported definitions visible but unavailable', async () => {
    const value = snapshot('=RAND()')
    value.formulas[0].status = 'unsupported'
    const finalize = vi.fn().mockResolvedValue({
      recordId,
      inputRevision: 7,
      status: 'completed',
      formulaCount: 1,
    })
    await executeCalculation('user', recordId, {
      loadSnapshot: vi.fn().mockResolvedValue(value),
      finalize,
    })
    expect(finalize.mock.calls[0][3][0]).toEqual({
      formulaId,
      formulaVersion: 3,
      status: 'unavailable',
      resultKind: 'none',
      errorCode: 'UNSUPPORTED',
    })
  })

  it('records one safe failed state when workbook reconstruction fails', async () => {
    const value = snapshot()
    const table = value.tables[0]
    const row = table.rows[0]
    value.tables = [
      {
        ...table,
        rows: [
          {
            ...row,
            cells: {
              ...row.cells,
              [targetColumnId]: { formula: {} },
            },
          },
        ],
      },
    ]
    const finalize = vi
      .fn()
      .mockImplementation(async (_actor, _snapshot, outcome) => ({
        recordId,
        inputRevision: 7,
        status: outcome,
        formulaCount: 1,
      }))
    await expect(
      executeCalculation('user', recordId, {
        loadSnapshot: vi.fn().mockResolvedValue(value),
        finalize,
      }),
    ).resolves.toMatchObject({ status: 'failed' })
    expect(finalize).toHaveBeenCalledWith(
      'user',
      value,
      'failed',
      [],
      'Calculation worker failed.',
    )
  })

  it('does not replace a revision CAS failure with a worker-failed cache', async () => {
    const finalize = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('changed'), { code: 'SB001' }))
    await expect(
      executeCalculation('user', recordId, {
        loadSnapshot: vi.fn().mockResolvedValue(snapshot()),
        finalize,
      }),
    ).rejects.toMatchObject({ code: 'SB001' })
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(finalize.mock.calls[0][2]).toBe('completed')
  })

  it('enforces session, body and revision errors at the HTTP boundary', async () => {
    const base: CalculationDeps = {
      getSession: vi.fn().mockResolvedValue(null),
      loadSnapshot: vi.fn(),
      finalize: vi.fn(),
    }
    const request = (body: unknown) =>
      new Request('http://sheetbase.test/api/calculations', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    expect(await handleCalculation(request({ recordId }), base)).toMatchObject({
      status: 401,
    })
    base.getSession = vi.fn().mockResolvedValue({ user: { id: 'user' } })
    expect(
      await handleCalculation(request({ nope: true }), base),
    ).toMatchObject({ status: 400 })
    base.loadSnapshot = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('changed'), { code: 'SB001' }))
    expect(await handleCalculation(request({ recordId }), base)).toMatchObject({
      status: 409,
    })
  })
})
