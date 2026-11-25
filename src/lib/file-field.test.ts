import { describe, expect, it } from 'vitest'

import { FILE_RELATIONSHIP, isFileField } from './file-field'

describe('file fields', () => {
  it('knows a link to files from other links', () => {
    expect(
      isFileField({
        logicalType: 'reference',
        relationship: FILE_RELATIONSHIP,
      }),
    ).toBe(true)
    expect(
      isFileField({
        logicalType: 'reference',
        relationship: {
          target: { kind: 'model', modelKey: 'sample' },
        },
      }),
    ).toBe(false)
    expect(
      isFileField({
        logicalType: 'reference',
        validation: { targetModelKey: 'file' },
      }),
    ).toBe(true)
    expect(
      isFileField({
        logicalType: 'text',
        validation: { targetModelKey: 'file' },
      }),
    ).toBe(false)
  })
})
