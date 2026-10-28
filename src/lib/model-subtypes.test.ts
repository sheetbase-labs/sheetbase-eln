import { describe, expect, it } from 'vitest'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import {
  pickableTypes,
  typeAncestors,
  typeDescendants,
  typeForVersion,
  typeHost,
  typeRoot,
  valuesForType,
} from './model-subtypes'
import type { FieldGroup, ModelType } from './model-subtypes'

function type(
  key: string,
  parentKey: string | null,
  published: string | null = `${key}-v1`,
): ModelType {
  return {
    id: key,
    key,
    name: key,
    prefix: key.slice(0, 3).toUpperCase(),
    parentKey,
    lifecycle: 'active',
    publishedVersionId: published,
    versionIds: published ? [published] : [],
  }
}

const types = [
  type('cell_culture', 'experiment'),
  type('perfusion', 'cell_culture'),
  type('draft_kind', 'experiment', null),
  type('cell_bank', null),
  type('master_bank', 'cell_bank'),
  type('cleanroom', 'project'),
]

function group(modelKey: string, ...names: string[]): FieldGroup {
  return {
    modelKey,
    modelName: modelKey,
    fields: names.map(
      (name) =>
        ({ fieldName: name, label: `${name} label` }) as ModelFieldDefinition,
    ),
  }
}

describe('model subtype chains', () => {
  it('walks up to the model at the top, nearest parent first', () => {
    expect(typeAncestors(types, 'perfusion').map((t) => t.key)).toEqual([
      'cell_culture',
    ])
    expect(typeRoot(types, 'perfusion')).toBe('experiment')
    expect(typeRoot(types, 'master_bank')).toBe('cell_bank')
  })

  it('lists every subtype below a model, with its depth', () => {
    expect(
      typeDescendants(types, 'experiment').map((o) => [o.type.key, o.depth]),
    ).toEqual([
      ['cell_culture', 1],
      ['perfusion', 2],
      ['draft_kind', 1],
    ])
    expect(pickableTypes(types, 'experiment').map((o) => o.type.key)).toEqual([
      'cell_culture',
      'perfusion',
    ])
  })

  it('stops on a loop rather than walking forever', () => {
    const looped = [type('a', 'b'), type('b', 'a')]
    expect(typeAncestors(looped, 'a').map((t) => t.key)).toEqual(['b'])
    expect(['a', 'b']).toContain(typeRoot(looped, 'a'))
  })

  it('traces a pinned version back to its type and host', () => {
    expect(typeForVersion(types, 'perfusion-v1')?.key).toBe('perfusion')
    expect(typeForVersion(types, null)).toBeNull()
    expect(typeHost(types, 'cleanroom').host).toBe('project')
    expect(typeHost(types, 'master_bank')).toMatchObject({
      root: 'cell_bank',
      builtIn: null,
      host: 'record',
    })
  })
})

describe('valuesForType', () => {
  it('keeps what the new type has and names what it drops', () => {
    const { kept, dropped } = valuesForType(
      { harvest: 6, cell_line: 'CHO', rate: '' },
      [
        group('experiment', 'harvest'),
        group('cell_culture', 'cell_line', 'rate'),
      ],
      [group('experiment', 'harvest')],
    )
    expect(kept).toEqual({ harvest: 6 })
    expect(dropped).toEqual(['cell_line label'])
  })
})
