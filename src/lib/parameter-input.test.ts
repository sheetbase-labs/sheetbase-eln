import { describe, expect, it } from 'vitest'

import type { Parameter } from './parameter'
import {
  buildParameterInputs,
  defaultParameterDrafts,
  parseScalarParameterValue,
  scalarDefaultText,
} from './parameter-input'

function scalar(overrides: Partial<Parameter> & { id: string }): Parameter {
  return {
    key: 'value',
    label: 'Value',
    required: false,
    type: { kind: 'scalar', valueType: 'integer' },
    constraints: {},
    ...overrides,
  }
}

describe('defaultParameterDrafts', () => {
  it('pre-fills declared scalar defaults as visible draft strings', () => {
    const drafts = defaultParameterDrafts([
      scalar({
        id: '20000000-0000-4000-8000-000000000001',
        defaultValue: 5,
      }),
      scalar({
        id: '20000000-0000-4000-8000-000000000002',
        type: { kind: 'scalar', valueType: 'text' },
        defaultValue: 'wild-type',
      }),
      scalar({
        id: '20000000-0000-4000-8000-000000000003',
        type: { kind: 'scalar', valueType: 'boolean' },
        defaultValue: true,
      }),
      scalar({ id: '20000000-0000-4000-8000-000000000004' }),
      {
        id: '20000000-0000-4000-8000-000000000005',
        key: 'sample',
        label: 'Sample',
        required: false,
        type: { kind: 'record', modelKey: 'sample' },
        constraints: {},
      },
    ])
    expect(drafts).toEqual({
      '20000000-0000-4000-8000-000000000001': '5',
      '20000000-0000-4000-8000-000000000002': 'wild-type',
      '20000000-0000-4000-8000-000000000003': 'true',
    })
  })

  it('describes scalar defaults for visible hints', () => {
    expect(
      scalarDefaultText(
        scalar({
          id: '20000000-0000-4000-8000-000000000001',
          defaultValue: 5,
        }),
      ),
    ).toBe('5')
    expect(
      scalarDefaultText(scalar({ id: '20000000-0000-4000-8000-000000000004' })),
    ).toBeNull()
  })
})

describe('buildParameterInputs fail-closed', () => {
  it('names a missing required scalar without a default', () => {
    const parameter = scalar({
      id: '20000000-0000-4000-8000-000000000001',
      label: 'Passage number',
      required: true,
    })
    expect(() => parseScalarParameterValue(parameter, '')).toThrow(
      'Parameter "Passage number" is required.',
    )
    expect(() => buildParameterInputs([parameter], {})).toThrow(
      'Parameter "Passage number" is required.',
    )
  })

  it('applies a declared default only when the draft is empty', () => {
    const parameter = scalar({
      id: '20000000-0000-4000-8000-000000000001',
      label: 'Passage number',
      required: true,
      defaultValue: 5,
    })
    expect(buildParameterInputs([parameter], {})).toEqual([
      { parameterId: parameter.id, kind: 'scalar', value: 5 },
    ])
    expect(buildParameterInputs([parameter], { [parameter.id]: '7' })).toEqual([
      { parameterId: parameter.id, kind: 'scalar', value: 7 },
    ])
  })

  it('names a missing required object parameter', () => {
    const parameter = {
      id: '20000000-0000-4000-8000-000000000002',
      key: 'sample',
      label: 'Sample',
      required: true,
      type: { kind: 'record', modelKey: 'sample' },
      constraints: {},
    } as Parameter
    expect(() => buildParameterInputs([parameter], {})).toThrow(
      'Parameter "Sample" is required.',
    )
  })

  it('omits an optional parameter with no value and no default', () => {
    const parameter = scalar({
      id: '20000000-0000-4000-8000-000000000001',
      label: 'Note',
      required: false,
      type: { kind: 'scalar', valueType: 'text' },
    })
    expect(buildParameterInputs([parameter], {})).toEqual([])
  })
})
