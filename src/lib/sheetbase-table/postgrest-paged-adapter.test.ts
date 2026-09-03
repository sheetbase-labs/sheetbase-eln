import { describe, expect, it } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import type { ScientificRowWire, ScientificTableWire } from '#/lib/scientific-sheet-data'
import {
  PostgrestPagedDataAdapter,
  postgrestFilterQuery,
} from './postgrest-paged-adapter'

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
    {
      id: 'col-status',
      field_name: 'status',
      label: 'Status',
      display_order: 2,
      logical_type: 'category',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [
        { id: 'opt-1', label: 'Complete', display_order: 0 },
        { id: 'opt-2', label: 'Review', display_order: 1 },
      ],
    },
  ],
}

const row = (id: string, version: number, values: Record<string, unknown>): ScientificRowWire => ({
  id,
  version,
  ...values,
})

function fakeClient(rows: ScientificRowWire[], total = rows.length): DataClient {
  const calls: Array<{ resource: string; query?: string }> = []
  const client: DataClient = {
    list: async (resource: string, query?: string) => {
      calls.push({ resource, query })
      const offset = Number(/offset=(\d+)/.exec(query ?? '')?.[1] ?? 0)
      const limit = Number(/limit=(\d+)/.exec(query ?? '')?.[1] ?? 200)
      return rows.slice(offset, offset + limit) as never
    },
    count: async () => total,
    rpc: async <T>(_name: string, _args: Record<string, unknown>) => ({}) as T,
    insert: async <T>(_resource: string, _row: Record<string, unknown>) => ({}) as T,
    patch: async <T>(_resource: string, _query: string, _row: Record<string, unknown>) =>
      ({}) as T,
    remove: async () => [],
  }
  ;(client as DataClient & { calls: typeof calls }).calls = calls
  return client
}

describe('postgrest filter mapping', () => {
  it('maps typed operators onto PostgREST conditions', () => {
    expect(postgrestFilterQuery([{ fieldId: 'title', operator: 'eq', value: 'x' }], 'and')).toBe(
      'title=eq.x',
    )
    expect(postgrestFilterQuery([{ fieldId: 'title', operator: 'contains', value: 'as' }], 'and')).toBe(
      'title=ilike.*as*',
    )
    expect(postgrestFilterQuery([{ fieldId: 'status', operator: 'in', value: ['Complete', 'Review'] }], 'and')).toBe(
      'status=in.(Complete,Review)',
    )
    expect(postgrestFilterQuery([{ fieldId: 'status', operator: 'isNull' }], 'and')).toBe(
      'status=is.null',
    )
    expect(postgrestFilterQuery([{ fieldId: 'result', operator: 'between', value: [1, 9] }], 'and')).toBe(
      'and=(result.gte.1,result.lte.9)',
    )
  })

  it('joins or-logic into a single PostgREST expression', () => {
    expect(
      postgrestFilterQuery(
        [
          { fieldId: 'title', operator: 'contains', value: 'as' },
          { fieldId: 'status', operator: 'eq', value: 'Review' },
        ],
        'or',
      ),
    ).toBe('or=(title.ilike.*as*,status.eq.Review)')
  })
})

describe('PostgrestPagedDataAdapter', () => {
  it('pages rows with ordering, maps records and caches cell values', async () => {
    const client = fakeClient([
      row('row-1', 3, { title: 'Sample A', result: 1.5, status: 'Complete' }),
      row('row-2', 1, { title: 'Sample B', result: null, status: 'Review' }),
    ])
    const adapter = new PostgrestPagedDataAdapter({ client, table })
    const page = await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 50,
      fieldIds: ['title', 'result', 'status'],
      queryKey: 'q1',
      sort: [{ fieldId: 'result', direction: 'desc' }],
    })
    expect(page.totalRows).toBe(2)
    expect(page.revision).toBe('sv4')
    expect(page.records).toEqual([
      { recordId: 'row-1', values: { title: 'Sample A', result: 1.5, status: 'Complete' } },
      { recordId: 'row-2', values: { title: 'Sample B', result: null, status: 'Review' } },
    ])
    const query = (client as DataClient & { calls: Array<{ query?: string }> }).calls[0]?.query ?? ''
    expect(query).toContain('order=result.desc,id.asc')
    expect(query).toContain('limit=50')
    expect(query).toContain('offset=0')
    expect(
      adapter.resolve({ kind: 'record-field', datasetId: 'ds-1', recordId: 'row-1', fieldId: 'title' } as never),
    ).toBe('Sample A')
  })

  it('commits edits through apply_scientific_row_changes with row versions', async () => {
    const client = fakeClient([
      row('row-1', 3, { title: 'Sample A', result: 1.5, status: 'Complete' }),
    ])
    let rpcArgs: Record<string, unknown> | undefined
    ;(client as DataClient & { rpc: DataClient['rpc'] }).rpc = async <T,>(
      _name: string,
      args: Record<string, unknown>,
    ) => {
      rpcArgs = args
      return {
        ok: true,
        schemaVersion: 5,
        rows: [row('row-1', 4, { title: 'Renamed', result: 1.5, status: 'Complete' })],
      } as T
    }
    const adapter = new PostgrestPagedDataAdapter({ client, table })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['title'],
      queryKey: 'q',
    })
    const result = await adapter.commit([
      {
        datasetId: 'ds-1',
        recordId: 'row-1',
        fieldId: 'title',
        before: 'Sample A',
        after: 'Renamed',
      },
    ])
    expect(rpcArgs).toMatchObject({
      p_table_id: 'table-1',
      p_expected_schema_version: 4,
      p_edits: [{ rowId: 'row-1', expectedVersion: 3, values: { title: 'Renamed' } }],
    })
    expect(result).toEqual({
      revision: 'sv5',
      accepted: [
        {
          datasetId: 'ds-1',
          recordId: 'row-1',
          fieldId: 'title',
          before: 'Sample A',
          after: 'Renamed',
        },
      ],
      rejected: [],
    })
  })

  it('surfaces version mismatches as revision conflicts', async () => {
    const client = fakeClient([row('row-1', 3, { title: 'Sample A' })])
    ;(client as DataClient & { rpc: DataClient['rpc'] }).rpc = async <T,>() =>
      ({
        ok: false,
        errors: [{ rowId: 'row-1', columnId: 'col-title', code: 'row_version_conflict', message: 'Row changed' }],
      }) as T
    const adapter = new PostgrestPagedDataAdapter({ client, table })
    await adapter.fetchPage({
      datasetId: 'ds-1',
      rowStart: 0,
      rowCount: 10,
      fieldIds: ['title'],
      queryKey: 'q',
    })
    await expect(
      adapter.commit([
        { datasetId: 'ds-1', recordId: 'row-1', fieldId: 'title', before: 'Sample A', after: 'x' },
      ]),
    ).rejects.toThrow(/Revision conflict/)
  })
})
