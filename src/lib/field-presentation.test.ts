import { describe, expect, it } from 'vitest'

import {
  fieldEditorPresentation,
  selectableFieldOptions,
} from './field-presentation'
import type { FieldDefinition, FieldLogicalType } from './field-definition'

function categoryField(): FieldDefinition {
  return {
    fieldId: 'field-1',
    key: 'outcome',
    label: 'Outcome',
    description: null,
    logicalType: 'category',
    nullable: true,
    defaultValue: null,
    cardinality: 'one',
    quantity: null,
    validation: {},
    category: {
      kind: 'embedded',
      options: [
        {
          id: 'active',
          key: 'pass',
          label: 'Pass',
          displayOrder: 1,
          lifecycle: 'active',
        },
        {
          id: 'retired',
          key: 'old',
          label: 'Old',
          displayOrder: 2,
          lifecycle: 'retired',
        },
      ],
    },
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
  }
}

describe('field editor presentation', () => {
  it.each([
    ['text', 'text', 'text'],
    ['integer', 'number', 'number'],
    ['decimal', 'number', 'number'],
    ['boolean', 'checkbox', null],
    ['date', 'date', 'date'],
    ['timestamp', 'datetime-local', 'datetime-local'],
    ['category', 'category-select', null],
    ['reference', 'text', 'text'],
  ] as const)(
    'selects the %s editor',
    (logicalType: FieldLogicalType, kind, inputType) => {
      expect(fieldEditorPresentation(logicalType)).toMatchObject({
        kind,
        inputType,
      })
    },
  )

  it('distinguishes integer and decimal entry precision', () => {
    expect(fieldEditorPresentation('integer').step).toBe('1')
    expect(fieldEditorPresentation('decimal').step).toBe('any')
  })

  it('keeps a selected retired embedded option visible', () => {
    expect(
      selectableFieldOptions(categoryField(), 'old').map((o) => o.key),
    ).toEqual(['pass', 'old'])
    expect(
      selectableFieldOptions(categoryField(), 'pass').map((o) => o.key),
    ).toEqual(['pass'])
  })
})
