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
    displayOrder: 1,
    unit: null,
    validation: {},
    lifecycle: 'active',
    options: [],
    ...over,
  }
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

  it('preserves an own scientific __proto__ field through edit and clearing', () => {
    const scientific = field({ fieldName: '__proto__', logicalType: 'text' })
    const stored = JSON.parse('{"__proto__":"before"}')
    const initial = initialModelFieldValues([scientific], stored)
    expect(Object.hasOwn(initial, '__proto__')).toBe(true)
    expect(initial.__proto__).toBe('before')
    const current = Object.fromEntries([['__proto__', 'after']])
    const changed = changedModelFieldValues([scientific], initial, current)
    expect(Object.hasOwn(changed, '__proto__')).toBe(true)
    expect(changed.__proto__).toBe('after')
    expect(
      changedModelFieldValues(
        [scientific],
        initial,
        Object.fromEntries([['__proto__', '']]),
      ),
    ).toEqual(JSON.parse('{"__proto__":null}'))
  })

  it('names a concurrent edit and a locked record', () => {
    expect(describeFieldEditError({ code: 'SB001' })).toMatch(/Someone else/)
    expect(describeFieldEditError({ code: 'SB011' })).toMatch(/locked/)
    expect(describeFieldEditError({ code: { nested: 'SB011' } })).toBe(
      'Could not save the changes.',
    )
  })
})
