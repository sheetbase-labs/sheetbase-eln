import { describe, expect, it } from 'vitest'

import type { ModelType } from '#/lib/model-subtypes'
import { modelName, parentChoices, subtypeKey } from './model-subtype-ui'

function type(key: string, name: string, parentKey: string | null): ModelType {
  return {
    id: key,
    key,
    name,
    prefix: 'X',
    parentKey,
    lifecycle: 'active',
    publishedVersionId: null,
    versionIds: [],
  }
}

const types = [
  type('cell_culture', 'Cell culture', 'experiment'),
  type('perfusion', 'Perfusion', 'cell_culture'),
  type('cell_bank', 'Cell bank', null),
]

describe('subtype helpers', () => {
  it('makes a key the database accepts from any name', () => {
    expect(subtypeKey('Cell culture run')).toBe('cell_culture_run')
    expect(subtypeKey('  2-step  ')).toBe('type_2_step')
    expect(subtypeKey('!!!')).toBe('type')
  })

  it('names built-in models and workspace types', () => {
    expect(modelName(types, 'experiment')).toBe('Experiment')
    expect(modelName(types, 'perfusion')).toBe('Perfusion')
  })

  it('never offers a type itself or one of its own subtypes as its parent', () => {
    const keys = parentChoices(types, 'cell_culture').map((c) => c.key)
    expect(keys).toContain('experiment')
    expect(keys).toContain('cell_bank')
    expect(keys).not.toContain('cell_culture')
    expect(keys).not.toContain('perfusion')
    expect(
      parentChoices(types, 'cell_bank').find((c) => c.key === 'perfusion')
        ?.name,
    ).toBe('Cell culture › Perfusion')
  })
})
