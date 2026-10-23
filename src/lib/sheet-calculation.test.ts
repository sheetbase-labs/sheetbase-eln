import { describe, expect, it } from 'vitest'

import type { FieldDefinition } from './field-definition'
import {
  buildSheetCalculationExpression,
  evaluateSheetCalculation,
  flaggedValueForProvenance,
  sheetCalculationDependenciesFromExpression,
  sheetInstanceCalculationSchema,
} from './sheet-calculation'
import { buildFlagIndex } from './dataset-flags'
import type { DatasetValueFlag } from './dataset-flags'

const RECOVERED = '21000000-0000-4000-8000-000000000001'
const INPUT = '21000000-0000-4000-8000-000000000002'
const OUTPUT = '21000000-0000-4000-8000-000000000003'
const quantity = {
  kind: 'mass',
  dimension: 'mass',
  storageUnit: 'mg',
}

function field(
  fieldId: string,
  logicalType: 'integer' | 'decimal' = 'decimal',
  fieldQuantity: FieldDefinition['quantity'] = null,
): FieldDefinition {
  return {
    fieldId,
    key: `field_${fieldId.at(-1)}`,
    label: 'Field',
    description: null,
    logicalType,
    nullable: true,
    defaultValue: null,
    cardinality: 'one',
    quantity: fieldQuantity,
    validation: {},
    category: null,
    relationship: null,
    computation:
      fieldId === OUTPUT
        ? { mode: 'computed', expressionId: OUTPUT }
        : { mode: 'stored' },
    lifecycle: 'active',
  }
}

const input = (
  id: string,
  value: unknown,
  inputField = field(id),
  state: 'present' | 'missing' | 'unmatched' = 'present',
) => ({
  dependency: { kind: 'column' as const, id },
  field: inputField,
  state,
  value,
  provenance: { id, revision: 7 },
})

describe('composed Sheet calculation profile', () => {
  it('calculates cross-source Recovery from stable semantic dependencies', () => {
    expect(
      evaluateSheetCalculation({
        calculationId: OUTPUT,
        expression: '=A1/B1*100',
        outputField: field(OUTPUT),
        inputs: [
          input(RECOVERED, 8, field(RECOVERED, 'decimal', quantity)),
          input(INPUT, 10, field(INPUT, 'decimal', quantity)),
        ],
      }),
    ).toMatchObject({
      status: 'value',
      value: 80,
      dependencyProvenance: [
        { id: RECOVERED, revision: 7 },
        { id: INPUT, revision: 7 },
      ],
    })
  })

  it('keeps dependency meaning independent from labels and presentation order', () => {
    const first = evaluateSheetCalculation({
      calculationId: OUTPUT,
      expression: '=A1-B1',
      outputField: field(OUTPUT, 'decimal', quantity),
      inputs: [
        input(RECOVERED, 10, field(RECOVERED, 'decimal', quantity)),
        input(INPUT, 3, field(INPUT, 'decimal', quantity)),
      ],
    })
    const renamed = [
      {
        ...input(RECOVERED, 10, field(RECOVERED, 'decimal', quantity)),
        field: { ...field(RECOVERED, 'decimal', quantity), label: 'Renamed' },
      },
      input(INPUT, 3, field(INPUT, 'decimal', quantity)),
    ]
    expect(
      evaluateSheetCalculation({
        calculationId: OUTPUT,
        expression: '=A1-B1',
        outputField: field(OUTPUT, 'decimal', quantity),
        inputs: renamed,
      }),
    ).toEqual(first)
  })

  it('requires exact quantity metadata without inferring conversion', () => {
    const grams = { ...quantity, storageUnit: 'g' }
    expect(
      evaluateSheetCalculation({
        calculationId: OUTPUT,
        expression: '=A1+B1',
        outputField: field(OUTPUT, 'decimal', quantity),
        inputs: [
          input(RECOVERED, 8, field(RECOVERED, 'decimal', quantity)),
          input(INPUT, 10, field(INPUT, 'decimal', grams)),
        ],
      }),
    ).toMatchObject({ status: 'error', errorCode: 'QUANTITY' })
  })

  it.each([
    [
      'missing',
      input(RECOVERED, undefined, field(RECOVERED), 'missing'),
      'MISSING',
    ],
    [
      'unmatched',
      input(RECOVERED, undefined, field(RECOVERED), 'unmatched'),
      'UNMATCHED',
    ],
    ['type', input(RECOVERED, '8', field(RECOVERED)), 'TYPE'],
  ] as const)('returns a durable %s error', (_name, badInput, errorCode) => {
    expect(
      evaluateSheetCalculation({
        calculationId: OUTPUT,
        expression: '=A1',
        outputField: field(OUTPUT),
        inputs: [badInput],
      }),
    ).toMatchObject({ status: 'error', errorCode })
  })

  it('returns divide-by-zero, then recalculates successfully without changing the expression', () => {
    const calculate = (divisor: number) =>
      evaluateSheetCalculation({
        calculationId: OUTPUT,
        expression: '=A1/B1',
        outputField: field(OUTPUT),
        inputs: [input(RECOVERED, 8), input(INPUT, divisor)],
      })
    expect(calculate(0)).toMatchObject({
      status: 'error',
      errorCode: 'DIV_BY_ZERO',
    })
    expect(calculate(2)).toMatchObject({ status: 'value', value: 4 })
  })

  it('validates bounded read-only Instance calculation definitions', () => {
    const definition = {
      id: OUTPUT,
      key: 'recovery',
      label: 'Recovery',
      lifecycle: 'active',
      outputField: field(OUTPUT),
      dependencies: [{ kind: 'local-field', id: RECOVERED }],
      expression: { language: 'sheetbase-formula-v1', source: '=A1' },
    }
    expect(sheetInstanceCalculationSchema.parse(definition)).toEqual(definition)
    expect(
      sheetInstanceCalculationSchema.safeParse({
        ...definition,
        dependencies: [{ kind: 'calculation', id: OUTPUT }],
      }).success,
    ).toBe(false)
    expect(
      sheetInstanceCalculationSchema.safeParse({
        ...definition,
        dependencies: [
          { kind: 'local-field', id: RECOVERED },
          { kind: 'column', id: RECOVERED },
        ],
      }).success,
    ).toBe(false)
  })
})

const COL_A = 'aa000000-0000-4000-8000-000000000001'
const COL_B = 'bb000000-0000-4000-8000-000000000002'
const COL_C = 'cc000000-0000-4000-8000-000000000003'
const COL_D = 'dd000000-0000-4000-8000-000000000004'
const COL_E = 'ee000000-0000-4000-8000-000000000005'
const COL_F = 'ff000000-0000-4000-8000-000000000006'
const COL_G = '11000000-0000-4000-8000-000000000007'
const COL_H = '12000000-0000-4000-8000-000000000008'
const COL_I = '13000000-0000-4000-8000-000000000009'

const eightLocals = [
  { id: COL_A, origin: 'local' as const },
  { id: COL_B, origin: 'local' as const },
  { id: COL_C, origin: 'local' as const },
  { id: COL_D, origin: 'local' as const },
  { id: COL_E, origin: 'local' as const },
  { id: COL_F, origin: 'local' as const },
  { id: COL_G, origin: 'local' as const },
  { id: COL_H, origin: 'local' as const },
  { id: COL_I, origin: 'local' as const },
]

describe('sheetCalculationDependenciesFromExpression', () => {
  it('preserves non-leading, reordered grid operands when saving a calculation', () => {
    const expression = buildSheetCalculationExpression({
      source: '=C1-B1',
      columns: [
        { id: COL_A, origin: 'bound' },
        { id: INPUT, origin: 'bound' },
        { id: RECOVERED, origin: 'local' },
      ],
    })
    const values = new Map([
      [INPUT, 3],
      [RECOVERED, 10],
    ])
    expect(
      evaluateSheetCalculation({
        calculationId: OUTPUT,
        expression: expression.source,
        outputField: field(OUTPUT),
        inputs: expression.dependencies.map((dependency) => ({
          ...input(dependency.id, values.get(dependency.id)),
          dependency,
        })),
      }),
    ).toMatchObject({ status: 'value', value: 7 })
  })

  it('rejects references to other rows in a row-wise calculation', () => {
    expect(() =>
      buildSheetCalculationExpression({
        source: '=A2*2',
        columns: eightLocals,
      }),
    ).toThrow()
  })

  it('claims only columns referenced by the expression', () => {
    expect(
      sheetCalculationDependenciesFromExpression({
        source: '=B1+C1',
        columns: eightLocals,
      }),
    ).toEqual([
      { kind: 'local-field', id: COL_B },
      { kind: 'local-field', id: COL_C },
    ])
  })

  it('does not invent the first eight local fields as dependencies', () => {
    const claimed = sheetCalculationDependenciesFromExpression({
      source: '=I1*2',
      columns: eightLocals,
    })
    expect(claimed).toEqual([{ kind: 'local-field', id: COL_I }])
    expect(claimed.map((item) => item.id)).not.toContain(COL_A)
  })

  it('maps bound columns to column dependencies and local fields to local-field', () => {
    expect(
      sheetCalculationDependenciesFromExpression({
        source: '=A1+B1',
        columns: [
          { id: COL_A, origin: 'bound' },
          { id: COL_B, origin: 'local' },
        ],
      }),
    ).toEqual([
      { kind: 'column', id: COL_A },
      { kind: 'local-field', id: COL_B },
    ])
  })

  it('maps calculation columns used in the expression', () => {
    expect(
      sheetCalculationDependenciesFromExpression({
        source: '=C1',
        columns: [
          { id: COL_A, origin: 'local' },
          { id: COL_B, origin: 'local' },
          { id: COL_C, origin: 'calculation' },
        ],
      }),
    ).toEqual([{ kind: 'calculation', id: COL_C }])
  })

  it('expands range references to every member column', () => {
    expect(
      sheetCalculationDependenciesFromExpression({
        source: '=SUM(A1:C1)',
        columns: [
          { id: COL_A, origin: 'bound' },
          { id: COL_B, origin: 'local' },
          { id: COL_C, origin: 'local' },
        ],
      }),
    ).toEqual([
      { kind: 'column', id: COL_A },
      { kind: 'local-field', id: COL_B },
      { kind: 'local-field', id: COL_C },
    ])
  })

  it('returns no dependencies for a constant expression', () => {
    expect(
      sheetCalculationDependenciesFromExpression({
        source: '=1+2',
        columns: eightLocals,
      }),
    ).toEqual([])
  })
})

describe('flagged value exclusion in ƒx evaluation', () => {
  const DATASET = '31000000-0000-4000-8000-000000000001'
  const ROW = '32000000-0000-4000-8000-000000000001'
  const FIELD = '33000000-0000-4000-8000-000000000001'
  const provenance = {
    sourceKind: 'dataset',
    sourceDatasetId: DATASET,
    sourceRowId: ROW,
    sourceFieldId: FIELD,
  }
  const flagged: DatasetValueFlag = {
    id: '34000000-0000-4000-8000-000000000001',
    datasetId: DATASET,
    rowId: ROW,
    fieldId: FIELD,
    kind: 'out_of_range',
    reason: 'Above top standard',
    comment: null,
    setAt: '2026-09-25T09:40:00Z',
  }

  it('resolves a flag only for the flagged Dataset value', () => {
    const index = buildFlagIndex([flagged])
    expect(flaggedValueForProvenance(provenance, index)).toEqual(flagged)
    // Cleared/absent flag: the value is not excluded.
    expect(flaggedValueForProvenance(provenance, new Map())).toBeUndefined()
    // Record and unmatched provenance can never carry a Dataset value flag.
    expect(
      flaggedValueForProvenance(
        { sourceKind: 'record', sourceRowId: ROW, sourceFieldId: FIELD },
        index,
      ),
    ).toBeUndefined()
    expect(
      flaggedValueForProvenance(
        { sourceKind: 'dataset', sourceRowId: null, sourceFieldId: FIELD },
        index,
      ),
    ).toBeUndefined()
  })

  it('returns EXCLUDED and keeps provenance for a flagged dependency', () => {
    const result = evaluateSheetCalculation({
      calculationId: OUTPUT,
      expression: '=A1',
      outputField: field(OUTPUT),
      inputs: [
        {
          dependency: { kind: 'column', id: RECOVERED },
          field: field(RECOVERED),
          state: 'excluded',
          provenance,
        },
      ],
    })
    expect(result).toMatchObject({ status: 'error', errorCode: 'EXCLUDED' })
    if (result.status === 'error')
      expect(result.dependencyProvenance).toEqual([provenance])
  })

  it('restores the computed value once the flag is cleared', () => {
    const present = {
      dependency: { kind: 'column' as const, id: RECOVERED },
      field: field(RECOVERED),
      state: 'present' as const,
      value: 8,
      provenance,
    }
    const index = buildFlagIndex([flagged])
    const excluded = evaluateSheetCalculation({
      calculationId: OUTPUT,
      expression: '=A1',
      outputField: field(OUTPUT),
      inputs: [{ ...present, state: 'excluded' }],
    })
    expect(excluded).toMatchObject({ status: 'error', errorCode: 'EXCLUDED' })
    // Clearing the flag leaves the provenance but no index entry, so a present
    // input evaluates normally again.
    expect(flaggedValueForProvenance(provenance, index)).toEqual(flagged)
    expect(
      flaggedValueForProvenance(provenance, buildFlagIndex([])),
    ).toBeUndefined()
    const restored = evaluateSheetCalculation({
      calculationId: OUTPUT,
      expression: '=A1',
      outputField: field(OUTPUT),
      inputs: [present],
    })
    expect(restored).toMatchObject({ status: 'value', value: 8 })
  })
})
