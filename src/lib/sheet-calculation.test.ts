import { describe, expect, it } from 'vitest'

import type { FieldDefinition } from './field-definition'
import {
  evaluateSheetCalculation,
  sheetInstanceCalculationSchema,
} from './sheet-calculation'

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
