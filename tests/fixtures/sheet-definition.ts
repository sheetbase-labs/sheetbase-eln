import { parseSheetDefinitionConfiguration } from '#/lib/sheet-definition'

const ids = {
  parameterA: '10000000-0000-4000-8000-000000000001',
  parameterB: '10000000-0000-4000-8000-000000000002',
  bindingA: '20000000-0000-4000-8000-000000000001',
  bindingB: '20000000-0000-4000-8000-000000000002',
  columnA: '30000000-0000-4000-8000-000000000001',
  columnB: '30000000-0000-4000-8000-000000000002',
  columnC: '30000000-0000-4000-8000-000000000003',
  sourceFieldA: '40000000-0000-4000-8000-000000000001',
  sourceFieldB: '40000000-0000-4000-8000-000000000002',
  calculation: '50000000-0000-4000-8000-000000000001',
  join: '60000000-0000-4000-8000-000000000001',
  writeBack: '70000000-0000-4000-8000-000000000001',
  action: '80000000-0000-4000-8000-000000000001',
  schemaVersion: '90000000-0000-4000-8000-000000000001',
}

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
    logicalType: 'text' as const,
    nullable: true,
    defaultValue: null,
    cardinality: 'one' as const,
    quantity: null,
    validation: {},
    category: null,
    relationship: null,
    computation,
    lifecycle: 'active' as const,
  }
}

export function validSheetDefinitionConfiguration() {
  return parseSheetDefinitionConfiguration({
    formatVersion: 1,
    parameters: [
      {
        id: ids.parameterA,
        key: 'results',
        label: 'Results',
        required: true,
        type: {
          kind: 'dataset',
          contract: { mode: 'exact', schemaVersionId: ids.schemaVersion },
        },
        constraints: {},
      },
      {
        id: ids.parameterB,
        key: 'comparison',
        label: 'Comparison',
        required: true,
        type: {
          kind: 'dataset-version',
          contract: {
            mode: 'semantic',
            requiredFieldIds: [ids.sourceFieldB],
          },
        },
        constraints: {},
      },
    ],
    bindings: [
      { id: ids.bindingA, key: 'results', parameterId: ids.parameterA },
      { id: ids.bindingB, key: 'comparison', parameterId: ids.parameterB },
    ],
    rowIdentity: {
      kind: 'composite',
      columnIds: [ids.columnA, ids.columnB],
    },
    joins: [
      {
        id: ids.join,
        leftBindingId: ids.bindingA,
        rightBindingId: ids.bindingB,
        leftColumnId: ids.columnA,
        rightColumnId: ids.columnB,
        joinType: 'left',
        cardinality: 'many-to-one',
      },
    ],
    columns: [
      {
        id: ids.columnA,
        field: field(ids.columnA, 'sample', { mode: 'stored' }),
        source: {
          kind: 'bound',
          bindingId: ids.bindingA,
          sourceFieldId: ids.sourceFieldA,
        },
      },
      {
        id: ids.columnB,
        field: field(ids.columnB, 'comparison', { mode: 'stored' }),
        source: {
          kind: 'bound',
          bindingId: ids.bindingB,
          sourceFieldId: ids.sourceFieldB,
        },
      },
      {
        id: ids.columnC,
        field: field(ids.columnC, 'summary', {
          mode: 'computed',
          expressionId: ids.calculation,
        }),
        source: { kind: 'calculated', calculationId: ids.calculation },
      },
    ],
    calculations: [
      {
        id: ids.calculation,
        key: 'summary',
        label: 'Summary',
        outputColumnId: ids.columnC,
        inputColumnIds: [ids.columnA, ids.columnB],
        expression: {
          language: 'sheetbase-formula-v1',
          source: '=A&B',
        },
      },
    ],
    writeBackRules: [
      {
        id: ids.writeBack,
        bindingId: ids.bindingA,
        mode: 'update',
        mappings: [{ columnId: ids.columnA, targetFieldId: ids.sourceFieldA }],
      },
    ],
    actions: [
      {
        id: ids.action,
        key: 'open_sample',
        label: 'Open sample',
        kind: 'open-record',
        bindingId: ids.bindingA,
        parameterId: ids.parameterA,
      },
    ],
    presentation: {
      columnOrder: [ids.columnA, ids.columnB, ids.columnC],
      hiddenColumnIds: [ids.columnB],
      columnWidths: { [ids.columnA]: 180 },
      frozenColumnCount: 1,
      density: 'standard',
    },
  })
}

export const sheetDefinitionInvalidCases: Array<{
  name: string
  mutate: (value: any) => void
}> = [
  {
    name: 'string format version',
    mutate: (value) => (value.formatVersion = '1'),
  },
  {
    name: 'string minimum length',
    mutate: (value) => (value.columns[0].field.validation.minLength = '1'),
  },
  {
    name: 'duplicate parameter key',
    mutate: (value) => (value.parameters[1].key = value.parameters[0].key),
  },
  {
    name: 'duplicate binding key',
    mutate: (value) => (value.bindings[1].key = value.bindings[0].key),
  },
  {
    name: 'duplicate semantic required field ID',
    mutate: (value) =>
      value.parameters[1].type.contract.requiredFieldIds.push(
        value.parameters[1].type.contract.requiredFieldIds[0],
      ),
  },
  {
    name: 'duplicate column semantic key',
    mutate: (value) =>
      (value.columns[1].field.key = value.columns[0].field.key),
  },
  {
    name: 'calculation output mismatch',
    mutate: (value) =>
      (value.calculations[0].outputColumnId = value.columns[0].id),
  },
  {
    name: 'join column and binding mismatch',
    mutate: (value) => (value.joins[0].leftColumnId = value.columns[1].id),
  },
  {
    name: 'integer scalar string default',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'integer' }
      value.parameters[0].defaultValue = '12'
    },
  },
  {
    name: 'integer scalar array default',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'integer' }
      value.parameters[0].defaultValue = [12]
    },
  },
  {
    name: 'reversed Parameter constraint bounds',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'decimal' }
      value.parameters[0].constraints = { min: 2, max: 1 }
    },
  },
  {
    name: 'invalid Parameter regex',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'text' }
      value.parameters[0].constraints = { pattern: '[' }
    },
  },
  {
    name: 'numeric Parameter with ignored text constraint',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'decimal' }
      value.parameters[0].constraints = { minLength: 1 }
    },
  },
  {
    name: 'text Parameter with ignored numeric constraint',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'text' }
      value.parameters[0].constraints = { min: 1 }
    },
  },
  {
    name: 'Parameter default outside numeric constraint',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'integer' }
      value.parameters[0].defaultValue = 11
      value.parameters[0].constraints = { max: 10 }
    },
  },
  {
    name: 'Parameter default outside allowed values',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'boolean' }
      value.parameters[0].defaultValue = true
      value.parameters[0].constraints = { allowedValues: [false] }
    },
  },
  {
    name: 'baseline-free semantic field missing its bound column',
    mutate: (value) =>
      (value.parameters[1].type.contract.requiredFieldIds = [
        '40000000-0000-4000-8000-000000000099',
      ]),
  },
  {
    name: 'FieldDefinition default type mismatch',
    mutate: (value) => (value.columns[0].field.defaultValue = 12),
  },
  {
    name: 'reversed numeric validation bounds',
    mutate: (value) => {
      value.columns[0].field.validation.min = 2
      value.columns[0].field.validation.max = 1
    },
  },
  {
    name: 'invalid validation regex',
    mutate: (value) => (value.columns[0].field.validation.pattern = '['),
  },
  {
    name: 'duplicate quantity input unit',
    mutate: (value) => {
      value.columns[0].field.logicalType = 'decimal'
      value.columns[0].field.quantity = {
        kind: 'mass',
        dimension: 'mass',
        storageUnit: 'mg',
        allowedInputUnits: ['g', 'g'],
      }
    },
  },
  {
    name: 'unknown preferred display unit',
    mutate: (value) => {
      value.columns[0].field.logicalType = 'decimal'
      value.columns[0].field.quantity = {
        kind: 'mass',
        dimension: 'mass',
        storageUnit: 'mg',
        allowedInputUnits: ['g'],
        preferredDisplayUnit: 'kg',
      }
    },
  },
  {
    name: 'UUID version 0',
    mutate: (value) =>
      (value.columns[0].source.sourceFieldId =
        'a0000000-0000-0000-8000-000000000001'),
  },
  {
    name: 'UUID version 9',
    mutate: (value) =>
      (value.columns[0].source.sourceFieldId =
        'a0000000-0000-9000-8000-000000000001'),
  },
  {
    name: 'UUID version f',
    mutate: (value) =>
      (value.columns[0].source.sourceFieldId =
        'a0000000-0000-f000-8000-000000000001'),
  },
  {
    name: 'nil UUID',
    mutate: (value) =>
      (value.columns[0].source.sourceFieldId =
        '00000000-0000-0000-0000-000000000000'),
  },
  {
    name: 'malformed date scalar',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'date' }
      value.parameters[0].defaultValue = 'not-a-date'
    },
  },
  {
    name: 'malformed timestamp scalar',
    mutate: (value) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'timestamp' }
      value.parameters[0].defaultValue = 'not-a-timestamp'
    },
  },
  ...[
    ['February 30 timestamp', '2026-02-30T12:30:00Z'],
    ['non-leap February 29 timestamp', '2025-02-29T12:30:00Z'],
    ['24-hour timestamp', '2026-08-14T24:00:00Z'],
    ['invalid timestamp minute', '2026-08-14T12:60:00Z'],
    ['invalid timestamp second', '2026-08-14T12:30:60Z'],
    ['out-of-range timestamp offset hour', '2026-08-14T12:30:00+24:00'],
    ['out-of-range timestamp offset minute', '2026-08-14T12:30:00+12:60'],
  ].map(([name, timestamp]) => ({
    name,
    mutate: (value: any) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'timestamp' }
      value.parameters[0].defaultValue = timestamp
    },
  })),
  {
    name: 'one calculation referenced by two calculated columns',
    mutate: (value) => {
      const duplicate = structuredClone(value.columns[2])
      duplicate.id = '30000000-0000-4000-8000-000000000004'
      duplicate.field.fieldId = duplicate.id
      duplicate.field.key = 'second_summary'
      value.columns.push(duplicate)
      value.presentation.columnOrder.push(duplicate.id)
    },
  },
]

export const sheetDefinitionValidCases: Array<{
  name: string
  mutate: (value: any) => void
}> = [
  {
    name: 'compatible-lineage Dataset contract',
    mutate: (value) =>
      (value.parameters[0].type.contract = {
        mode: 'lineage',
        baselineSchemaVersionId: ids.schemaVersion,
      }),
  },
  {
    name: 'UUID version 7',
    mutate: (value) =>
      (value.columns[0].source.sourceFieldId =
        'a0000000-0000-7000-8000-000000000001'),
  },
  {
    name: 'UUID version 8',
    mutate: (value) =>
      (value.columns[0].source.sourceFieldId =
        'a0000000-0000-8000-b000-000000000001'),
  },
  ...[
    ['leap-day timestamp', '2024-02-29T23:59:59Z'],
    ['Z timestamp', '2026-08-14T12:30:00.123Z'],
    ['offset timestamp', '2026-08-14T12:30:00-23:59'],
  ].map(([name, timestamp]) => ({
    name,
    mutate: (value: any) => {
      value.parameters[0].type = { kind: 'scalar', valueType: 'timestamp' }
      value.parameters[0].defaultValue = timestamp
    },
  })),
]

export { ids as sheetDefinitionFixtureIds }
