import { describe, expect, it } from 'vitest'

import {
  applySheetRecordValidationRerun,
  nextSheetRecordGridError,
  sheetRecordGridErrorsFromValidation,
} from './sheet-record-grid-errors'

const errors = sheetRecordGridErrorsFromValidation({
  rows: [
    {
      rowKey: 'row-a',
      errors: [
        { code: 'required_value', fieldName: 'note', message: 'Required.' },
      ],
    },
    {
      rowKey: 'row-b',
      errors: [
        {
          code: 'duplicate_input_row',
          fieldName: 'matchIdentifier',
          message: 'Duplicate.',
        },
      ],
    },
    {
      rowKey: 'row-c',
      errors: [{ code: '42501', message: 'Denied.' }],
    },
  ],
})

describe('in-grid Sheet Record errors', () => {
  it('classifies mixed errors and cycles keyboard focus', () => {
    expect(errors.map((error) => error.kind)).toEqual([
      'validation',
      'duplicate',
      'permission',
    ])
    expect(nextSheetRecordGridError(errors, null)?.rowKey).toBe('row-a')
    expect(nextSheetRecordGridError(errors, errors[0])?.rowKey).toBe('row-b')
    expect(nextSheetRecordGridError(errors, errors[2])?.rowKey).toBe('row-a')
  })

  it('reruns validation against preserved pasted values plus edits', () => {
    expect(
      applySheetRecordValidationRerun(
        { note: 'cold' },
        { note: 'room', title: 'Fixed' },
      ),
    ).toEqual({ note: 'room', title: 'Fixed' })
  })
})
