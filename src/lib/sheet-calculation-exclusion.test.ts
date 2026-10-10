// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import type { DatasetValueFlag } from './dataset-flags'
import { projectBoundColumns } from './sheet-bound-columns'
import { calculateSheetSnapshotReport } from './sheet-calculation.server'
import type { ComposedSheetRow } from './sheet-composition-data'
import { parseSheetDefinitionConfiguration } from './sheet-definition'
import { parseSheetInstanceState } from './sheet-instance'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

const ids = {
  instance: 'a1000000-0000-4000-8000-000000000001',
  definitionVersion: 'a1000000-0000-4000-8000-000000000002',
  dataset: 'a2000000-0000-4000-8000-000000000001',
  datasetRow: 'a3000000-0000-4000-8000-000000000001',
  parameter: 'b1000000-0000-4000-8000-000000000001',
  binding: 'b2000000-0000-4000-8000-000000000001',
  valueColumn: 'c1000000-0000-4000-8000-000000000001',
  outputColumn: 'c2000000-0000-4000-8000-000000000001',
  sourceField: 'd1000000-0000-4000-8000-000000000001',
  calculation: 'e1000000-0000-4000-8000-000000000001',
  schemaVersion: 'f1000000-0000-4000-8000-000000000001',
}
const WORKSPACE = 'workspace-1'
const ROW_KEY = `sb-row-v1:${'a'.repeat(64)}`
const quantity = { kind: 'mass', dimension: 'mass', storageUnit: 'mg' }

function field(
  fieldId: string,
  key: string,
  computation: { mode: 'stored' } | { mode: 'computed'; expressionId: string },
) {
  return {
    fieldId,
    key,
    label: key,
    description: null,
    logicalType: 'decimal' as const,
    nullable: true,
    defaultValue: null,
    cardinality: 'one' as const,
    quantity,
    validation: {},
    category: null,
    relationship: null,
    computation,
    lifecycle: 'active' as const,
  }
}

const configuration = parseSheetDefinitionConfiguration({
  formatVersion: 1,
  parameters: [
    {
      id: ids.parameter,
      key: 'results',
      label: 'Results',
      required: true,
      type: {
        kind: 'dataset',
        contract: { mode: 'exact', schemaVersionId: ids.schemaVersion },
      },
      constraints: {},
    },
  ],
  bindings: [{ id: ids.binding, key: 'results', parameterId: ids.parameter }],
  rowIdentity: { kind: 'source', columnIds: [ids.valueColumn] },
  joins: [],
  columns: [
    {
      id: ids.valueColumn,
      field: field(ids.valueColumn, 'value', { mode: 'stored' }),
      source: {
        kind: 'bound',
        bindingId: ids.binding,
        sourceFieldId: ids.sourceField,
      },
    },
    {
      id: ids.outputColumn,
      field: field(ids.outputColumn, 'doubled', {
        mode: 'computed',
        expressionId: ids.calculation,
      }),
      source: { kind: 'calculated', calculationId: ids.calculation },
    },
  ],
  calculations: [
    {
      id: ids.calculation,
      key: 'doubled',
      label: 'Doubled',
      outputColumnId: ids.outputColumn,
      inputColumnIds: [ids.valueColumn],
      expression: { language: 'sheetbase-formula-v1', source: '=A1*2' },
    },
  ],
  writeBackRules: [],
  actions: [],
  presentation: {
    columnOrder: [ids.valueColumn, ids.outputColumn],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  },
})

const compositionRow: ComposedSheetRow = {
  rowKey: ROW_KEY,
  identityValues: [10],
  sources: [
    {
      sourceKind: 'dataset',
      bindingId: ids.binding,
      datasetId: ids.dataset,
      datasetRevision: 8,
      rowId: ids.datasetRow,
      revision: 7,
      matched: true,
      values: { [ids.sourceField]: 10 },
    },
  ],
  compositionOffset: 0,
}

function snapshot(flags: DatasetValueFlag[]) {
  const boundProjection = projectBoundColumns({
    definitionVersionId: ids.definitionVersion,
    configuration,
    rows: [compositionRow],
  })
  return {
    instanceId: ids.instance,
    workspaceId: WORKSPACE,
    definitionVersionId: ids.definitionVersion,
    revision: 2,
    state: parseSheetInstanceState({
      bindings: [],
      localFields: [],
      localValues: {},
      calculationOverrides: {},
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
      provenance: { createdFrom: 'definition_version' },
    }),
    composition: {
      instanceId: ids.instance,
      definitionVersionId: ids.definitionVersion,
      definitionConfiguration: configuration,
      revision: 2,
      offset: 0,
      limit: 200,
      hasMore: false,
      localFieldIds: [],
      identity: {
        kind: 'source',
        columnIds: [ids.valueColumn],
        logicalTypes: ['decimal'],
      },
      rows: [compositionRow],
      boundProjection,
    },
    flags,
  } as Parameters<typeof calculateSheetSnapshotReport>[0]
}

const activeFlag: DatasetValueFlag = {
  id: 'a4000000-0000-4000-8000-000000000001',
  datasetId: ids.dataset,
  rowId: ids.datasetRow,
  fieldId: ids.sourceField,
  kind: 'out_of_range',
  reason: 'Above top standard',
  comment: null,
  setAt: '2026-09-25T09:40:00Z',
}

describe('ƒx calculation exclusion of flagged Dataset values', () => {
  it('excludes a flagged value from evaluation and reports the count', () => {
    const { results, exclusions } = calculateSheetSnapshotReport(
      snapshot([activeFlag]),
    )
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      calculationId: ids.calculation,
      rowKey: ROW_KEY,
      resultKind: 'error',
      errorCode: 'EXCLUDED',
      value: null,
    })
    expect(exclusions).toEqual({
      valueCount: 1,
      rowCount: 1,
      kinds: ['out_of_range'],
    })
  })

  it('keeps and computes an unflagged value', () => {
    const { results, exclusions } = calculateSheetSnapshotReport(snapshot([]))
    expect(results[0]).toMatchObject({
      calculationId: ids.calculation,
      resultKind: 'value',
      value: 20,
    })
    expect(exclusions).toEqual({ valueCount: 0, rowCount: 0, kinds: [] })
  })

  it('restores the value once the flag is cleared', () => {
    const flagged = calculateSheetSnapshotReport(snapshot([activeFlag]))
    expect(flagged.results[0]).toMatchObject({ errorCode: 'EXCLUDED' })

    const cleared = calculateSheetSnapshotReport(snapshot([]))
    expect(cleared.results[0]).toMatchObject({ resultKind: 'value', value: 20 })
    expect(cleared.exclusions.valueCount).toBe(0)
  })
})
