import { describe, expect, it } from 'vitest'

import type { FieldDefinition } from './field-definition'
import { evaluateSheetCalculation } from './sheet-calculation'

const TITRE_OUT = '22000000-0000-4000-8000-000000000001'
const TITRE_IN = '22000000-0000-4000-8000-000000000002'
const YIELD = '22000000-0000-4000-8000-000000000003'
const THRESHOLD = '22000000-0000-4000-8000-000000000004'
const MEETS = '22000000-0000-4000-8000-000000000005'
const TURBIDITY = '22000000-0000-4000-8000-000000000006'

const titreQuantity = {
  kind: 'measurement',
  dimension: 'cp/mL',
  storageUnit: 'cp/mL',
}

const turbidityQuantity = {
  kind: 'measurement',
  dimension: 'NTU',
  storageUnit: 'NTU',
}

function field(
  fieldId: string,
  logicalType: FieldDefinition['logicalType'] = 'decimal',
  quantity: FieldDefinition['quantity'] = null,
  computed = false,
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
    quantity,
    validation: {},
    category: null,
    relationship: null,
    computation: computed
      ? { mode: 'computed', expressionId: fieldId }
      : { mode: 'stored' },
    lifecycle: 'active',
  }
}

const column = (
  id: string,
  value: number | string,
  inputField: FieldDefinition,
  kind: 'column' | 'parameter' = 'column',
) => ({
  dependency: { kind, id },
  field: inputField,
  state: 'present' as const,
  value,
  provenance: { id },
})

/** Step yield = Titre out / Titre in * 100, as the Clarification sheet has it. */
function stepYield(out: number, titreIn: number) {
  return evaluateSheetCalculation({
    calculationId: YIELD,
    expression: '=A1/B1*100',
    outputField: field(YIELD, 'decimal', null, true),
    inputs: [
      column(TITRE_OUT, out, field(TITRE_OUT, 'decimal', titreQuantity)),
      column(TITRE_IN, titreIn, field(TITRE_IN, 'decimal', titreQuantity)),
    ],
  })
}

/** Meets criteria = IF(step yield >= threshold, "Pass", "Fail"). */
function meets(yieldValue: number, threshold: number) {
  return evaluateSheetCalculation({
    calculationId: MEETS,
    expression: '=IF(A1>=B1,"Pass","Fail")',
    outputField: field(MEETS, 'text', null, true),
    inputs: [
      column(YIELD, yieldValue, field(YIELD)),
      column(THRESHOLD, threshold, field(THRESHOLD), 'parameter'),
    ],
  })
}

describe('sheet formulas that compare and decide', () => {
  it('works out a step yield from two titres', () => {
    expect(stepYield(450, 500)).toMatchObject({ status: 'value', value: 90 })
  })

  it('answers Pass when the yield reaches the threshold', () => {
    expect(meets(90, 80)).toMatchObject({ status: 'value', value: 'Pass' })
    expect(meets(80, 80)).toMatchObject({ status: 'value', value: 'Pass' })
  })

  it('answers Fail when the yield falls short', () => {
    expect(meets(79.9, 80)).toMatchObject({ status: 'value', value: 'Fail' })
  })

  it('produces a boolean when the formula is a comparison', () => {
    expect(
      evaluateSheetCalculation({
        calculationId: MEETS,
        expression: '=AND(A1>=B1,A1<=100)',
        outputField: field(MEETS, 'boolean', null, true),
        inputs: [
          column(YIELD, 92, field(YIELD)),
          column(THRESHOLD, 80, field(THRESHOLD), 'parameter'),
        ],
      }),
    ).toMatchObject({ status: 'value', value: true })
  })

  it('compares like units with each other and a unit with a plain number', () => {
    const turbidity = (expression: string) =>
      evaluateSheetCalculation({
        calculationId: MEETS,
        expression,
        outputField: field(MEETS, 'text', null, true),
        inputs: [
          column(TURBIDITY, 12, field(TURBIDITY, 'decimal', turbidityQuantity)),
        ],
      })

    expect(turbidity('=IF(A1<=20,"Pass","Fail")')).toMatchObject({
      status: 'value',
      value: 'Pass',
    })

    expect(
      evaluateSheetCalculation({
        calculationId: MEETS,
        expression: '=IF(A1>B1,"More","Less")',
        outputField: field(MEETS, 'text', null, true),
        inputs: [
          column(TITRE_OUT, 9, field(TITRE_OUT, 'decimal', titreQuantity)),
          column(TITRE_IN, 5, field(TITRE_IN, 'decimal', titreQuantity)),
        ],
      }),
    ).toMatchObject({ status: 'value', value: 'More' })
  })

  it('refuses to compare two different units', () => {
    expect(
      evaluateSheetCalculation({
        calculationId: MEETS,
        expression: '=IF(A1>B1,"More","Less")',
        outputField: field(MEETS, 'text', null, true),
        inputs: [
          column(TITRE_OUT, 9, field(TITRE_OUT, 'decimal', titreQuantity)),
          column(TURBIDITY, 5, field(TURBIDITY, 'decimal', turbidityQuantity)),
        ],
      }),
    ).toMatchObject({ status: 'error', errorCode: 'QUANTITY' })
  })

  it('refuses a result that does not fit the declared output type', () => {
    expect(
      evaluateSheetCalculation({
        calculationId: MEETS,
        expression: '=IF(A1>=B1,"Pass","Fail")',
        outputField: field(MEETS, 'decimal', null, true),
        inputs: [
          column(YIELD, 90, field(YIELD)),
          column(THRESHOLD, 80, field(THRESHOLD), 'parameter'),
        ],
      }),
    ).toMatchObject({ status: 'error', errorCode: 'TYPE' })
  })

  it('reads a text input and compares it', () => {
    expect(
      evaluateSheetCalculation({
        calculationId: MEETS,
        expression: '=IF(A1="Released","Yes","No")',
        outputField: field(MEETS, 'text', null, true),
        inputs: [column(YIELD, 'Released', field(YIELD, 'text'))],
      }),
    ).toMatchObject({ status: 'value', value: 'Yes' })
  })

  it('still refuses a date input', () => {
    expect(
      evaluateSheetCalculation({
        calculationId: MEETS,
        expression: '=IF(A1>=B1,"Pass","Fail")',
        outputField: field(MEETS, 'text', null, true),
        inputs: [
          column(YIELD, '2026-01-01', field(YIELD, 'date')),
          column(THRESHOLD, 80, field(THRESHOLD), 'parameter'),
        ],
      }),
    ).toMatchObject({ status: 'error', errorCode: 'TYPE' })
  })

  it('keeps a zero titre in from dividing', () => {
    expect(stepYield(10, 0)).toMatchObject({
      status: 'error',
      errorCode: 'DIV_BY_ZERO',
    })
  })
})
