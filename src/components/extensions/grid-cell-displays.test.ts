import { describe, expect, it } from 'vitest'

import { gridCellDisplays } from './grid-cell-displays'

const pill = { kind: 'badge', tones: { pass: 'success' } } as const
const bar = { kind: 'bar', max: 100 } as const

const columns = [
  { id: 'c1', key: 'result', logicalType: 'text' },
  { id: 'c2', key: 'viability', logicalType: 'number' },
  { id: 'c3', key: 'notes', logicalType: 'text' },
]

describe('plugin cell displays for dataset grid columns', () => {
  it('matches a column on its key', () => {
    const found = gridCellDisplays(
      [{ declaration: { appliesTo: { fields: ['result'] }, display: pill } }],
      columns,
    )

    expect(found).toEqual({ c1: pill })
  })

  it('matches a column on its type', () => {
    const found = gridCellDisplays(
      [
        {
          declaration: { appliesTo: { fieldTypes: ['number'] }, display: bar },
        },
      ],
      columns,
    )

    expect(found).toEqual({ c2: bar })
  })

  it('takes the first point that fits and leaves other columns alone', () => {
    const found = gridCellDisplays(
      [
        { declaration: { appliesTo: { fields: ['result'] }, display: pill } },
        { declaration: { appliesTo: { fields: ['result'] }, display: bar } },
      ],
      columns,
    )

    expect(found).toEqual({ c1: pill })
  })

  it('skips points that name models or plugin field types', () => {
    const found = gridCellDisplays(
      [
        {
          declaration: {
            appliesTo: { models: ['sample'], fields: ['result'] },
            display: pill,
          },
        },
        {
          declaration: {
            appliesTo: { pluginTypes: ['batch-code'] },
            display: bar,
          },
        },
      ],
      columns,
    )

    expect(found).toEqual({})
  })

  it('skips a point that has no display', () => {
    expect(
      gridCellDisplays(
        [{ declaration: { appliesTo: { fields: ['result'] } } }],
        columns,
      ),
    ).toEqual({})
  })
})
