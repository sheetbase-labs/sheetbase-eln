import { describe, expect, it } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import type { ScientificRowWire, ScientificTableWire } from '#/lib/scientific-sheet-data'
import { FormulaMutationError } from '#/lib/scientific-sheet-data'
import { PostgrestPagedDataAdapter } from './postgrest-paged-adapter'
import {
  ScientificFormulaAdapter,
  formulaKey,
  isFormulaSource,
} from './scientific-formula-adapter'
import type { FormulaDefinitionWire, FormulaResultWire } from '#/lib/scientific-sheet-data'

const table: ScientificTableWire = {
  id: 'table-1',
  resource_name: 'sheet_aaaa',
  name: 'Assay results',
  schema_version: 4,
  lifecycle: 'active',
  columns: [
    {
      id: 'col-title',
      field_name: 'title',
      label: 'Title',
      display_order: 0,
      logical_type: 'text',
      nullable: false,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
    {
      id: 'col-result',
      field_name: 'result',
      label: 'Result',
      display_order: 1,
      logical_type: 'decimal',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
  ],
}

const row = (id: string, version: number, values: Record<string, unknown>): ScientificRowWire => ({
  id,
  version,
  ...values,
})

function fakeClient(rows: ScientificRowWire[], total = rows.length): DataClient {
  const client: DataClient = {
    list: async (_resource: string, query?: string) => {
      const offset = Number(/offset=(\d+)/.exec(query ?? '')?.[1] ?? 0)
      const limit = Number(/limit=(\d+)/.exec(query ?? '')?.[1] ?? 200)
      return rows.slice(offset, offset + limit) as never
    },
    count: async () => total,
    rpc: async <T>(_name: string, _args: Record<string, unknown>) =>
      ({
        ok: true,
        schemaVersion: 4,
        rows,
      }) as T,
    insert: async <T>(_resource: string, _row: Record<string, unknown>) => ({}) as T,
    patch: async <T>(_resource: string, _query: string, _row: Record<string, unknown>) =>
      ({}) as T,
    remove: async () => [],
  }
  return client
}

function fakeFetch(response: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const calls: Array<{ source: string; input: unknown }> = []
  const fetchImpl = (async (_input: string, init?: RequestInit) => {
    calls.push({
      source: JSON.parse(String(init?.body ?? '{}')).source ?? JSON.parse(String(init?.body ?? '{}')).operation,
      input: JSON.parse(String(init?.body ?? '{}')),
    })
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    } as Response
  }) as typeof fetch
  return { fetchImpl, calls }
}

function formulaDefinition(version: number | string = 2): FormulaDefinitionWire {
  return {
    id: 'formula-1',
    target_table_id: 'table-1',
    target_row_id: 'row-1',
    target_column_id: 'col-result',
    source_expression: '=ROUND(3.14159,2)',
    template: null,
    bindings: null,
    engine_expression: 'ROUND(3.14159,2)',
    syntax_profile: 'sheetbase-formula-v1',
    function_profile: 'scientific-core-v2',
    literal_profile: 'literal-v1',
    engine_version: '3.3.0',
    status: 'supported',
    version,
    created_at: '2026-09-01T00:00:00Z',
  }
}

function calculatedResult(
  value: unknown,
  calculationStatus: FormulaResultWire['calculation_status'] = 'current',
): FormulaResultWire {
  return {
    formula_id: 'formula-1',
    target_table_id: 'table-1',
    target_row_id: 'row-1',
    target_column_id: 'col-result',
    cell_kind: 'formula',
    value_is_authoritative: false,
    definition_status: 'supported',
    formula_version: 2,
    current_input_revision: 1,
    calculation_status: calculationStatus,
    calculated_value: value,
    calculation_error_code: null,
    cache_input_revision: 1,
    engine_version: '3.3.0',
    profile_fingerprint: 'fp',
    runtime_fingerprint: 'fp',
    calculated_at: '2026-09-01T00:00:00Z',
  }
}

async function buildAdapter(
  rows: ScientificRowWire[],
  options: {
    formulas?: Map<string, FormulaDefinitionWire>
    results?: Map<string, FormulaResultWire>
    fetch?: typeof fetch
    afterFormulaChange?: () => void
  } = {},
) {
  const inner = new PostgrestPagedDataAdapter({ client: fakeClient(rows), table })
  return new ScientificFormulaAdapter({
    inner,
    table,
    formulas: () => options.formulas ?? new Map(),
    results: () => options.results ?? new Map(),
    afterFormulaChange: options.afterFormulaChange ?? (() => {}),
    fetchImpl: options.fetch ?? fakeFetch().fetchImpl,
  })
}

describe('ScientificFormulaAdapter', () => {
  it('detects formula sources', () => {
    expect(isFormulaSource('=ROUND(1,2)')).toBe(true)
    expect(isFormulaSource('plain note')).toBe(false)
    expect(isFormulaSource(null)).toBe(false)
  })

  it('routes a = edit to formula create without a row commit', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: null })], {
      fetch: fetchImpl,
    })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['title', 'result'],
      queryKey: 'q',
    })
    const result = await adapter.commit([
      { datasetId: 'ds-1', recordId: 'row-1', fieldId: 'result', before: '', after: '=ROUND(3.14159,2)' },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.input).toMatchObject({
      operation: 'create',
      target: { tableId: 'table-1', rowId: 'row-1', columnId: 'col-result' },
      expectedSchemaVersion: 4,
      expectedRowVersion: 3,
      source: '=ROUND(3.14159,2)',
    })
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  it('updates the existing formula when one is registered for the cell', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const formulas = new Map([[formulaKey('row-1', 'col-result'), formulaDefinition(7)]])
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: 3.14 })], {
      fetch: fetchImpl,
      formulas,
    })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['result'],
      queryKey: 'q',
    })
    await adapter.commit([
      { datasetId: 'ds-1', recordId: 'row-1', fieldId: 'result', before: '3.14', after: '=ROUND(2.5,0)' },
    ])
    expect(calls[0]?.input).toMatchObject({
      operation: 'update',
      expectedFormulaVersion: 7,
      source: '=ROUND(2.5,0)',
    })
  })

  it('removes the formula before committing a plain value over a formula cell', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const formulas = new Map([[formulaKey('row-1', 'col-result'), formulaDefinition()]])
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: 3.14 })], {
      fetch: fetchImpl,
      formulas,
    })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['result'],
      queryKey: 'q',
    })
    await adapter.commit([
      { datasetId: 'ds-1', recordId: 'row-1', fieldId: 'result', before: '3.14', after: 'manual' },
    ])
    expect(calls[0]?.input).toMatchObject({ operation: 'remove', expectedFormulaVersion: 2 })
  })

  it('overlays calculated values onto fetched pages', async () => {
    const results = new Map([[formulaKey('row-1', 'col-result'), calculatedResult(3.14)]])
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: '=ROUND(3.14159,2)' })], {
      results,
    })
    const page = await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['title', 'result'],
      queryKey: 'q',
    })
    expect(page.records[0]?.values.result).toBe(3.14)
    expect(page.records[0]?.values.title).toBe('A')
  })

  it('leaves pending and failed results untouched', async () => {
    const results = new Map([
      [formulaKey('row-1', 'col-result'), calculatedResult(3.14, 'pending')],
    ])
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: '=ROUND(3.14159,2)' })], {
      results,
    })
    const page = await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['result'],
      queryKey: 'q',
    })
    expect(page.records[0]?.values.result).toBe('=ROUND(3.14159,2)')
  })

  it('resolves calculated values for binding lookups', async () => {
    const results = new Map([[formulaKey('row-1', 'col-result'), calculatedResult(3.14)]])
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: '=ROUND(3.14159,2)' })], {
      results,
    })
    expect(
      adapter.resolve({
        kind: 'record-field',
        datasetId: 'ds-1',
        recordId: 'row-1',
        fieldId: 'result',
      } as never),
    ).toBe(3.14)
  })

  it('rejects the write when the formula API refuses it', async () => {
    const { fetchImpl } = fakeFetch({
      ok: false,
      status: 422,
      body: { error: { code: 'invalid_formula', message: 'Formula changed' } },
    })
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: null })], {
      fetch: fetchImpl,
    })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['result'],
      queryKey: 'q',
    })
    const result = await adapter.commit([
      { datasetId: 'ds-1', recordId: 'row-1', fieldId: 'result', before: '', after: '=1+1' },
    ])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]?.reason).toBe('Formula changed')
  })

  it('raises a revision conflict when the row version is stale', async () => {
    const { fetchImpl } = fakeFetch({
      ok: false,
      status: 409,
      body: { error: { code: 'stale_version', message: 'Row changed' } },
    })
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: null })], {
      fetch: fetchImpl,
    })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['result'],
      queryKey: 'q',
    })
    await expect(
      adapter.commit([
        { datasetId: 'ds-1', recordId: 'row-1', fieldId: 'result', before: '', after: '=1+1' },
      ]),
    ).rejects.toThrow(/Revision conflict/)
  })

  it('fires the afterFormulaChange hook after a formula mutation', async () => {
    const { fetchImpl } = fakeFetch()
    let fired = 0
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: null })], {
      fetch: fetchImpl,
      afterFormulaChange: () => {
        fired += 1
      },
    })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['result'],
      queryKey: 'q',
    })
    await adapter.commit([
      { datasetId: 'ds-1', recordId: 'row-1', fieldId: 'result', before: '', after: '=1+1' },
    ])
    expect(fired).toBe(1)
  })

  it('surfaces FormulaMutationError instances as rejections for non-conflict codes', async () => {
    const failingFetch = (async () => {
      throw new FormulaMutationError('unsupported_function', 422, 'Function is not supported')
    }) as unknown as typeof fetch
    const adapter = await buildAdapter([row('row-1', 3, { title: 'A', result: null })], {
      fetch: failingFetch,
    })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['result'],
      queryKey: 'q',
    })
    const result = await adapter.commit([
      { datasetId: 'ds-1', recordId: 'row-1', fieldId: 'result', before: '', after: '=NOSUCH(1)' },
    ])
    expect(result.rejected[0]?.reason).toBe('Function is not supported')
  })
})
