import { describe, expect, it } from 'vitest'

import { templateOutline } from './-new-experiment-outline'

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`

describe('templateOutline', () => {
  it('lists sections, steps and sheets in order under their day', () => {
    const { lines, more } = templateOutline({
      formatVersion: 1,
      parameters: [],
      parts: [{ id: id(1), title: 'Harvest', dayOffset: 2 }],
      placements: [
        {
          id: id(2),
          kind: 'section_placeholder',
          order: 1,
          key: 'objective',
          label: 'Objective',
        },
        {
          id: id(3),
          kind: 'sheet',
          order: 2,
          partId: id(1),
          definitionVersionId: id(4),
          title: 'Titres',
          parameterMappings: [],
        },
      ],
    })

    expect(lines.map((line) => [line.kind, line.label, line.note])).toEqual([
      ['item', 'Objective', undefined],
      ['part', 'Harvest', 'Day 3'],
      ['item', 'Titres', 'Sheet'],
    ])
    expect(more).toBe(0)
  })

  it('says nothing for a template with no configuration', () => {
    expect(templateOutline(null)).toEqual({ lines: [], more: 0 })
  })
})
