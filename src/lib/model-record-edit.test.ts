import { describe, expect, it } from 'vitest'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import {
  changedModelFieldValues,
  describeFieldEditError,
  initialModelFieldValues,
} from './model-record-edit'

function field(over: Partial<ModelFieldDefinition>): ModelFieldDefinition {
  return {
    id: over.fieldName ?? 'f',
    modelKey: 'cell_bank',
    fieldName: 'passage',
    label: 'Passage',
    description: null,
    logicalType: 'integer',
    nullable: true,
    defaultValue: null,
    options: [],
    ...over,
  } as unknown as ModelFieldDefinition
}

describe('model record edit', () => {
  const passage = field({ fieldName: 'passage' })
  const note = field({
    fieldName: 'note',
    logicalType: 'text',
    nullable: false,
  })
  const flag = field({ fieldName: 'ok', logicalType: 'boolean' })

  it('starts from the stored values', () => {
    expect(
      initialModelFieldValues([passage, note, flag], { passage: 4, ok: true }),
    ).toEqual({ passage: '4', note: '', ok: true })
  })

  it('sends only what changed and clears a nullable field with null', () => {
    const initial = { passage: '4', note: 'a', ok: false }
    expect(
      changedModelFieldValues([passage, note, flag], initial, {
        passage: '',
        note: 'a',
        ok: true,
      }),
    ).toEqual({ passage: null, ok: true })
  })

  it('leaves a cleared required field out', () => {
    expect(
      changedModelFieldValues([note], { note: 'a' }, { note: '' }),
    ).toEqual({})
  })

  it('names a concurrent edit and a locked record', () => {
    expect(describeFieldEditError({ code: 'SB001' })).toMatch(/Someone else/)
    expect(describeFieldEditError({ code: 'SB011' })).toMatch(/locked/)
  })
})
