import { describe, expect, it } from 'vitest'

import { safeParseParameter } from './parameter'

const id = '15000000-0000-4000-8000-000000000001'
const version = '15000000-0000-4000-8000-000000000002'

function scalar() {
  return {
    id,
    key: 'threshold',
    label: 'Threshold',
    required: true,
    type: { kind: 'scalar', valueType: 'decimal' },
    defaultValue: 1.5,
    constraints: { min: 0, max: 10, allowedValues: [1.5, 2] },
  }
}

describe('shared Parameter contract', () => {
  it('parses constrained scalar defaults independently of Sheet Definitions', () => {
    expect(safeParseParameter(scalar()).success).toBe(true)
  })

  it('accepts exact, compatible-lineage and semantic Dataset contracts', () => {
    for (const contract of [
      { mode: 'exact', schemaVersionId: version },
      { mode: 'lineage', baselineSchemaVersionId: version },
      {
        mode: 'semantic',
        baselineSchemaVersionId: version,
        requiredFieldIds: [id],
      },
      { mode: 'semantic', requiredFieldIds: [id] },
    ]) {
      expect(
        safeParseParameter({
          id,
          key: 'results',
          label: 'Results',
          required: true,
          type: { kind: 'dataset', contract },
          constraints: {},
        }).success,
      ).toBe(true)
    }
  })

  it('rejects invalid constraints, typed defaults and object defaults', () => {
    const invalid = [
      { ...scalar(), constraints: { min: 2, max: 1 } },
      { ...scalar(), defaultValue: '1.5' },
      {
        ...scalar(),
        type: { kind: 'record', modelKey: 'sample' },
        defaultValue: id,
        constraints: {},
      },
      { ...scalar(), constraints: { pattern: '[' } },
    ]
    expect(invalid.every((value) => !safeParseParameter(value).success)).toBe(
      true,
    )
  })
})
