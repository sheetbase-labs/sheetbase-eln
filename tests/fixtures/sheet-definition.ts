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

export { ids as sheetDefinitionFixtureIds }
