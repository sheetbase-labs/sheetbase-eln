import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createDataClient } from './data-client'
import { buildPersistedFormulaArtifact, parseFormula } from './formula-ir'
import { pipelineJsonObjectSchema } from './pipelines/types'
import {
  addScientificColumn,
  applyScientificRowChanges,
  decodeScientificValue,
  fetchAllScientificRows,
  fetchScientificCalculationResults,
  fetchScientificDependencies,
  fetchScientificFormulas,
  fetchScientificRows,
  fetchScientificTable,
  FormulaMutationError,
  mutateScientificFormula,
  requestScientificCalculation,
  scientificRowSchema,
} from './scientific-sheet-data'
import type {
  FormulaResultWire,
  ScientificColumnWire,
  ScientificTableWire,
} from './scientific-sheet-data'

const tableId = '11111111-1111-4111-8111-111111111111'
const rowId = '21111111-1111-4111-8111-111111111111'
const columnId = '31111111-1111-4111-8111-111111111111'

const column: ScientificColumnWire = {
  id: columnId,
  field_name: '__proto__',
  label: 'Titre',
  display_order: 2,
  logical_type: 'decimal',
  nullable: true,
  unit: { symbol: 'vg/mL', code: 'vg_per_mL', storageUnit: 'vg/mL' },
  validation: { min: 0, max: 4000 },
  width: null,
  options: [],
}

const table: ScientificTableWire = {
  id: tableId,
  resource_name: 'scientific_rows_titre',
  name: 'Titre',
  schema_version: 7,
  lifecycle: 'active',
  columns: [column],
}

describe('scientific sheet transport contracts', () => {
  it('preserves scientific keys, extensions and omitted defaults in current metadata and rows', async () => {
    const scientific = pipelineJsonObjectSchema.parse(
      JSON.parse('{"__proto__":{"nested":{"__proto__":"retained"}}}'),
    )

    const row = { id: rowId, version: 3, ...scientific }
    const requests: string[] = []

    const client = createDataClient(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()

      requests.push(url)

      return url.includes('/rpc/scientific_table_metadata')
        ? Response.json([
            {
              ...table,
              columns: [{ ...column, unit: { ...column.unit, ...scientific } }],
            },
          ])
        : Response.json([row])
    })

    const metadata = await fetchScientificTable(client, tableId)

    expect(metadata?.columns[0]?.unit).toEqual({
      ...column.unit,
      ...scientific,
    })
    expect(metadata?.columns[0]).not.toHaveProperty('default_value')
    expect(metadata).not.toHaveProperty('created_at')
    expect(await fetchScientificRows(client, table, 2.8)).toEqual([row])
    expect(requests.at(-1)).toContain('limit=200&offset=400')
    expect(await fetchAllScientificRows(client, table)).toEqual([row])
    expect(requests.at(-1)).toContain('limit=10001')
    expect(
      Object.hasOwn(
        (await fetchAllScientificRows(client, table))[0],
        '__proto__',
      ),
    ).toBe(true)
    expect(
      scientificRowSchema.safeParse({ ...row, created_at: undefined }).success,
    ).toBe(false)
    expect(
      scientificRowSchema.safeParse({ ...row, extra: Infinity }).success,
    ).toBe(false)
  })

  it('rejects malformed current columns and rows instead of erasing invalid properties', async () => {
    const invalidColumnClient = createDataClient(async () =>
      Response.json([
        { ...table, columns: [{ ...column, validation: { min: 'zero' } }] },
      ]),
    )

    await expect(
      fetchScientificTable(invalidColumnClient, tableId),
    ).rejects.toThrow()

    const invalidRowsClient = createDataClient(async () =>
      Response.json([{ id: rowId, version: '3', __proto__: null }]),
    )

    await expect(
      fetchScientificRows(invalidRowsClient, table),
    ).rejects.toThrow()
    await expect(
      fetchAllScientificRows(invalidRowsClient, table),
    ).rejects.toThrow()
  })

  it('decodes current formulas, dependencies and non-authoritative results through canonical contracts', async () => {
    const artifact = buildPersistedFormulaArtifact(
      parseFormula('=A1*2', { rowIds: [rowId], columnIds: [columnId] }),
      tableId,
    )

    const formula = {
      id: 'formula-1',
      target_table_id: tableId,
      target_row_id: rowId,
      target_column_id: columnId,
      source_expression: artifact.source,
      template: artifact.template,
      bindings: artifact.bindings,
      engine_expression: artifact.engineExpression,
      syntax_profile: artifact.syntaxProfile,
      function_profile: artifact.functionProfile,
      literal_profile: artifact.literalProfile,
      engine_version: artifact.engineVersion,
      status: artifact.status,
      version: '4',
      created_at: '2026-11-10T10:00:00Z',
    }

    const dependency = {
      formula_id: formula.id,
      source_table_id: tableId,
      source_row_id: rowId,
      source_column_id: columnId,
    }

    const result: FormulaResultWire = {
      formula_id: formula.id,
      target_table_id: tableId,
      target_row_id: rowId,
      target_column_id: columnId,
      cell_kind: 'formula',
      value_is_authoritative: false,
      definition_status: 'supported',
      formula_version: '4',
      current_input_revision: '8',
      calculation_status: 'current',
      calculated_value: 2500,
      calculation_error_code: null,
      cache_input_revision: '8',
      engine_version: artifact.engineVersion,
      profile_fingerprint: null,
      runtime_fingerprint: null,
      calculated_at: null,
    }

    const client = createDataClient(async (input) => {
      const path = input instanceof Request ? input.url : input.toString()

      if (path.includes('/formula_definitions?'))
        return Response.json([formula])

      if (path.includes('/formula_dependencies?'))
        return Response.json([dependency])

      if (path.includes('/formula_results?')) return Response.json([result])

      throw new Error(`Unexpected scientific request: ${path}`)
    })

    expect(await fetchScientificFormulas(client, tableId)).toEqual([formula])
    expect(await fetchScientificDependencies(client, tableId)).toEqual([
      dependency,
    ])
    expect(await fetchScientificCalculationResults(client, tableId)).toEqual([
      result,
    ])

    const invalidBindingsClient = createDataClient(async () =>
      Response.json([{ ...formula, bindings: [{ kind: 'cell', slot: 1 }] }]),
    )

    await expect(
      fetchScientificFormulas(invalidBindingsClient, tableId),
    ).rejects.toThrow('binding slots must be bijective and ordered')

    const invalidResultClient = createDataClient(async () =>
      Response.json([{ ...result, value_is_authoritative: true }]),
    )

    await expect(
      fetchScientificCalculationResults(invalidResultClient, tableId),
    ).rejects.toThrow()
  })

  it('preserves zero, false, null and omitted defaults and scientific edit keys before committing', async () => {
    const requests: Array<{
      path: string
      body: ReturnType<typeof pipelineJsonObjectSchema.parse>
    }> = []

    const row = pipelineJsonObjectSchema.parse(
      JSON.parse(`{"id":"${rowId}","version":4,"__proto__":2}`),
    )

    const values = pipelineJsonObjectSchema.parse(JSON.parse('{"__proto__":2}'))

    const client = createDataClient(async (input, init) => {
      requests.push({
        path: input instanceof Request ? input.url : input.toString(),
        body: pipelineJsonObjectSchema.parse(
          JSON.parse(z.string().parse(init?.body)),
        ),
      })

      return Response.json({ ok: true, schemaVersion: 7, rows: [row] })
    })

    const base = {
      label: 'Titre',
      logicalType: column.logical_type,
      nullable: true,
      validation: column.validation,
    }

    await addScientificColumn(client, tableId, 7, base)
    await addScientificColumn(client, tableId, 7, { ...base, defaultValue: 0 })
    await addScientificColumn(client, tableId, 7, {
      ...base,
      defaultValue: false,
    })
    await addScientificColumn(client, tableId, 7, {
      ...base,
      defaultValue: null,
    })
    await addScientificColumn(client, tableId, 7, {
      ...base,
      defaultValue: undefined,
    })
    expect(
      requests.slice(0, 4).map((request) => request.body.p_default),
    ).toEqual([null, 0, false, null])
    expect(requests[4].body).not.toHaveProperty('p_default')
    expect(
      await applyScientificRowChanges(
        client,
        tableId,
        7,
        [{ rowId, expectedVersion: 3, values }],
        [],
      ),
    ).toEqual({ ok: true, schemaVersion: 7, rows: [row] })
    expect(requests.at(-1)?.body.p_edits).toEqual([
      { rowId, expectedVersion: 3, values },
    ])
    const before = requests.length

    await expect(
      applyScientificRowChanges(client, tableId, 7, [], [{ scientific: NaN }]),
    ).rejects.toThrow()
    expect(requests).toHaveLength(before)
  })

  it('retains formula error codes, calculation messages and malformed-envelope fallbacks', async () => {
    const input = {
      operation: 'remove',
      target: { tableId, rowId, columnId },
      expectedSchemaVersion: 7,
      expectedRowVersion: 3,
      expectedFormulaVersion: 4,
      replacement: null,
    } satisfies Parameters<typeof mutateScientificFormula>[0]

    const rejected = mutateScientificFormula(input, async () =>
      Response.json(
        { error: { code: 'stale_formula', message: 'Formula changed.' } },
        { status: 409 },
      ),
    )

    await expect(rejected).rejects.toBeInstanceOf(FormulaMutationError)
    await expect(rejected).rejects.toMatchObject({
      code: 'stale_formula',
      status: 409,
      message: 'Formula changed.',
    })
    await expect(
      mutateScientificFormula(
        input,
        async () => new Response('upstream unavailable', { status: 503 }),
      ),
    ).rejects.toMatchObject({ code: 'formula_write_failed', status: 503 })
    await expect(
      requestScientificCalculation('record-1', async () =>
        Response.json(
          { error: { message: 'Revision changed.' } },
          { status: 409 },
        ),
      ),
    ).rejects.toThrow('Revision changed.')
    await expect(
      requestScientificCalculation('record-1', async () =>
        Response.json({ error: { message: 42 } }, { status: 500 }),
      ),
    ).rejects.toThrow('Trusted calculation failed.')
  })

  it('validates current scalar conversion and boundaries without coercing objects or non-finite numbers', () => {
    expect(decodeScientificValue(column, '1250.5')).toBe(1250.5)
    expect(decodeScientificValue(column, 0)).toBe(0)
    expect(decodeScientificValue(column, '')).toBeNull()
    expect(() => decodeScientificValue(column, -1)).toThrow('below its minimum')
    expect(() => decodeScientificValue(column, 4001)).toThrow(
      'above its maximum',
    )
    expect(() => decodeScientificValue(column, Infinity)).toThrow()
    expect(() => decodeScientificValue(column, { value: 1250 })).toThrow(
      'scalar value',
    )
    expect(
      decodeScientificValue({ ...column, logical_type: 'boolean' }, 'false'),
    ).toBe(false)
    expect(() =>
      decodeScientificValue({ ...column, nullable: false }, null),
    ).toThrow('required')
    expect(
      decodeScientificValue({ ...column, logical_type: 'date' }, '2024-02-29'),
    ).toBe('2024-02-29')
    expect(() =>
      decodeScientificValue({ ...column, logical_type: 'date' }, '2023-02-29'),
    ).toThrow('not a valid date')
  })
})
