import { describe, expect, it } from 'vitest'

import {
  SheetInstancePagedAdapter,
  presentationFiltersToQueryFilters,
  presentationSortsToQuerySorts,
} from './sheet-instance-paged-adapter'
import { SheetMixedAuthorityWriteError } from '#/lib/sheet-write-back'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { RevisionConflictError } from 'sheetbase-table/dev'
import type {
  PageRequest,
  RecordFieldWrite,
} from 'sheetbase-table/dev'
import { validSheetInstanceState } from '../sheet-instance.test'

const ids = {
  field: '10000000-0000-4000-8000-000000000004',
  row: '10000000-0000-4000-8000-000000000005',
}
const composedRow = `sb-row-v1:${'a'.repeat(64)}`
const editableBound = '30000000-0000-4000-8000-000000000001'
const derivedBound = '30000000-0000-4000-8000-000000000002'
const calcField = '30000000-0000-4000-8000-000000000003'
const calcId = '30000000-0000-4000-8000-000000000009'

function baseInstance(): SheetInstance {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000002',
    projectId: '20000000-0000-4000-8000-000000000003',
    notebookRecordId: '20000000-0000-4000-8000-000000000006',
    sourceDefinitionVersionId: null,
    name: 'Notebook sheet',
    description: null,
    lifecycle: 'active',
    revision: 1,
    state: validSheetInstanceState(),
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  } as unknown as SheetInstance
}

/** The matrix builder mirrors composed rowKeys into localValues — seed it. */
function composedInstance(): SheetInstance {
  const instance = baseInstance()
  instance.state.localValues = {
    ...instance.state.localValues,
    [composedRow]: {},
  }
  return instance
}

function composedSnapshot(): ComposedSheetSnapshot {
  return {
    boundProjection: {
      columns: [
        {
          id: editableBound,
          label: 'Governed result',
          presentation: { kind: 'text', inputType: 'text' },
          permission: { editability: 'editable' },
        },
        {
          id: derivedBound,
          label: 'Derived recovery',
          presentation: { kind: 'number', inputType: 'number' },
          permission: { editability: 'read_only' },
        },
      ],
      rows: [
        {
          rowKey: composedRow,
          values: {
            [editableBound]: { kind: 'present', value: 12 },
            [derivedBound]: { kind: 'present', value: 24 },
          },
        },
      ],
    },
  } as unknown as ComposedSheetSnapshot
}

function calculationInstance(): SheetInstance {
  const instance = composedInstance()
  const outputField = {
    ...(instance.state.localFields[0] as object),
    fieldId: calcField,
    key: 'calc_result',
    label: 'Calc Result',
    computation: { mode: 'computed', expressionId: calcId },
  }
  instance.state = {
    ...instance.state,
    instanceCalculations: [
      {
        id: calcId,
        key: 'calc_result',
        label: 'Calc Result',
        lifecycle: 'active',
        outputField,
        dependencies: [],
        expression: { language: 'sheetbase-formula-v1', source: '=1' },
      },
    ],
  } as unknown as SheetInstance['state']
  return instance
}

function request(overrides?: Partial<PageRequest>): PageRequest {
  return {
    datasetId: 'sheet-instance:20000000-0000-4000-8000-000000000001',
    rowStart: 0,
    rowCount: 50,
    fieldIds: [],
    queryKey: 'test',
    ...overrides,
  }
}

function localWrite(after: string): RecordFieldWrite {
  return {
    datasetId: 'sheet-instance:20000000-0000-4000-8000-000000000001',
    recordId: ids.row,
    fieldId: ids.field,
    after,
  }
}

describe('SheetInstancePagedAdapter.fetchPage', () => {
  it('serves the canonical matrix with total rows and field projection', async () => {
    const adapter = new SheetInstancePagedAdapter({
      instance: composedInstance(),
      composition: composedSnapshot(),
    })
    const page = await adapter.fetchPage(request({ rowCount: 1 }))
    expect(page.totalRows).toBe(2)
    expect(page.revision).toBe('r1')
    expect(page.records).toHaveLength(1)
    expect(page.records[0]?.recordId).toBe(composedRow)
    expect(page.records[0]?.values).toEqual({
      [editableBound]: 12,
      [derivedBound]: 24,
      [ids.field]: null,
    })

    const projected = await adapter.fetchPage(request({ fieldIds: [editableBound] }))
    expect(projected.records[0]?.values).toEqual({ [editableBound]: 12 })
  })

  it('resolves calculation columns from server-computed results', async () => {
    const adapter = new SheetInstancePagedAdapter({
      instance: calculationInstance(),
      calculationResults: { [ids.row]: { [calcField]: 42 } },
    })
    const page = await adapter.fetchPage(request())
    const localRow = page.records.find((record) => record.recordId === ids.row)
    expect(localRow?.values[calcField]).toBe(42)
    expect(
      adapter.resolve({
        kind: 'record-field',
        datasetId: adapter.datasetId,
        recordId: ids.row,
        fieldId: calcField,
      }),
    ).toBe(42)
  })

  it('applies engine filters and sorts in memory', async () => {
    const adapter = new SheetInstancePagedAdapter({
      instance: composedInstance(),
      composition: composedSnapshot(),
    })
    const filtered = await adapter.fetchPage(
      request({
        filters: [{ fieldId: editableBound, operator: 'eq', value: 12 }],
      }),
    )
    expect(filtered.records.map((record) => record.recordId)).toEqual([composedRow])

    const sorted = await adapter.fetchPage(
      request({
        sort: [{ fieldId: derivedBound, direction: 'desc' }],
      }),
    )
    // Descending with nulls last: the governed row (24) sorts first.
    expect(sorted.records.map((record) => record.recordId)).toEqual([
      composedRow,
      ids.row,
    ])
  })
})

describe('SheetInstancePagedAdapter.commit', () => {
  it('routes local cells through the local mutation and reports the fresh revision', async () => {
    const written: Array<{ input: unknown }> = []
    const adapter = new SheetInstancePagedAdapter({
      instance: baseInstance(),
      writeLocalCells: (async (input: unknown) => {
        written.push({ input })
        return { ...baseInstance(), revision: 7 }
      }) as never,
    })
    const result = await adapter.commit([
      localWrite('edited observation'),
    ])
    expect(written).toHaveLength(1)
    const input = written[0]!.input as {
      expectedRevision: number
      cells: Array<{ rowKey: string; fieldId: string; value: unknown }>
    }
    expect(input.expectedRevision).toBe(1)
    expect(input.cells).toEqual([
      { rowKey: ids.row, fieldId: ids.field, value: 'edited observation' },
    ])
    expect(result.revision).toBe('r7')
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toEqual([])
  })

  it('rejects writes to read-only and calculation columns fail-closed', async () => {
    const adapter = new SheetInstancePagedAdapter({
      instance: calculationInstance(),
      composition: composedSnapshot(),
      writeBoundCells: (async () => {
        throw new Error('should not dispatch')
      }) as never,
      writeLocalCells: (async () => {
        throw new Error('should not dispatch')
      }) as never,
    })
    const readOnlyWrite: RecordFieldWrite = {
      datasetId: adapter.datasetId,
      recordId: composedRow,
      fieldId: derivedBound,
      after: '1',
    }
    const calcWrite: RecordFieldWrite = {
      ...readOnlyWrite,
      recordId: ids.row,
      fieldId: calcField,
    }
    const result = await adapter.commit([readOnlyWrite, calcWrite])
    expect(result.accepted).toEqual([])
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      'read_only_column',
      'read_only_column',
    ])
    expect(result.revision).toBe('r1')
  })

  it('routes bound cells through the batch write-back with the composition', async () => {
    const calls: Array<{ cells: Array<{ rowKey: string; columnId: string }> }> = []
    const adapter = new SheetInstancePagedAdapter({
      instance: composedInstance(),
      composition: composedSnapshot(),
      writeBoundCells: (async (input: unknown) => {
        calls.push({ cells: (input as { cells: Array<{ rowKey: string; columnId: string }> }).cells })
      }) as never,
      refetchInstance: (async () => ({
        ...baseInstance(),
        revision: 4,
      })) as never,
    })
    const result = await adapter.commit([
      {
        datasetId: adapter.datasetId,
        recordId: composedRow,
        fieldId: editableBound,
        after: 'governed edit',
      },
    ])
    expect(calls[0]?.cells).toEqual([
      { rowKey: composedRow, columnId: editableBound, value: 'governed edit' },
    ])
    expect(result.revision).toBe('r4')
  })

  it('fails closed when one batch spans bound and local authorities', async () => {
    const adapter = new SheetInstancePagedAdapter({
      instance: composedInstance(),
      composition: composedSnapshot(),
      writeBoundCells: (async () => {
        throw new Error('should not dispatch')
      }) as never,
      writeLocalCells: (async () => {
        throw new Error('should not dispatch')
      }) as never,
    })
    await expect(
      adapter.commit([
        {
          datasetId: adapter.datasetId,
          recordId: composedRow,
          fieldId: editableBound,
          after: 'x',
        },
        localWrite('y'),
      ]),
    ).rejects.toThrow(SheetMixedAuthorityWriteError)
  })

  it('surfaces stale-revision rejections as the engine conflict error', async () => {
    const adapter = new SheetInstancePagedAdapter({
      instance: baseInstance(),
      writeLocalCells: (async () => {
        throw new Error('SB001 stale revision')
      }) as never,
    })
    const write = localWrite('stale edit')
    await expect(adapter.commit([write])).rejects.toThrow(RevisionConflictError)
  })

  it('coerces typed editor strings before persisting', async () => {
    const written: Array<{ input: unknown }> = []
    const instance = baseInstance()
    instance.state = {
      ...instance.state,
      localFields: [
        {
          ...(instance.state.localFields[0] as object),
          fieldId: ids.field,
          logicalType: 'integer',
        },
      ],
      localValues: { [ids.row]: { [ids.field]: 5 } },
    } as SheetInstance['state']
    const adapter = new SheetInstancePagedAdapter({
      instance,
      writeLocalCells: (async (input: unknown) => {
        written.push({ input })
        return baseInstance()
      }) as never,
    })
    await adapter.commit([localWrite('42')])
    const input = written[0]!.input as {
      cells: Array<{ value: unknown }>
    }
    expect(input.cells[0]?.value).toBe(42)
  })
})

describe('presentation mapping', () => {
  it('maps presentation filters and sorts onto the engine vocabulary', () => {
    const filters = presentationFiltersToQueryFilters([
      { columnId: ids.field, operator: 'equals', value: 'x' },
      { columnId: ids.field, operator: 'not-equals', value: 'y' },
      { columnId: ids.field, operator: 'is-empty' },
      { columnId: ids.field, operator: 'is-not-empty' },
    ])
    expect(filters).toEqual([
      { fieldId: ids.field, operator: 'eq', value: 'x' },
      { fieldId: ids.field, operator: 'neq', value: 'y' },
      { fieldId: ids.field, operator: 'isNull' },
      { fieldId: ids.field, operator: 'notNull' },
    ])
    expect(
      presentationSortsToQuerySorts([{ columnId: ids.field, direction: 'desc' }]),
    ).toEqual([{ fieldId: ids.field, direction: 'desc' }])
  })
})
