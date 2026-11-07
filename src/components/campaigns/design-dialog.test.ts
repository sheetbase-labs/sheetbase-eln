import { describe, expect, it } from 'vitest'

import { buildDesign } from './design-dialog'

const factor = {
  label: 'Temperature',
  kind: 'continuous' as const,
  min: '20',
  max: '40',
  values: '',
  unit: '°C',
}
const objective = {
  label: 'Yield',
  direction: 'maximise' as const,
  target: '',
  weight: '',
  unit: '%',
}

describe('buildDesign', () => {
  it('turns the form into a design with keys made from the names', () => {
    const out = buildDesign(
      [
        factor,
        { ...factor, label: 'Buffer', kind: 'categorical', values: 'a, b' },
        { ...factor, label: 'pH', kind: 'discrete', values: '6, 7, 8' },
      ],
      [objective],
    )
    expect(out).toMatchObject({
      factors: [
        { key: 'temperature', min: 20, max: 40, unit: '°C' },
        { key: 'buffer', values: ['a', 'b'] },
        { key: 'ph', values: [6, 7, 8] },
      ],
      objectives: [{ key: 'yield', direction: 'maximise' }],
    })
  })

  it('says what to fix', () => {
    const problem = (f: unknown[], o: unknown[]) => {
      const out = buildDesign(f as never, o as never)
      return 'problem' in out ? out.problem : null
    }
    expect(problem([], [objective])).toMatch(/at least one factor/)
    expect(problem([factor], [])).toMatch(/at least one objective/)
    expect(problem([{ ...factor, min: '40', max: '20' }], [objective])).toMatch(
      /lowest value must be below/,
    )
    expect(
      problem([{ ...factor, kind: 'categorical', values: 'a' }], [objective]),
    ).toMatch(/at least two values/)
    expect(problem([factor], [{ ...objective, direction: 'target' }])).toMatch(
      /value to hit/,
    )
    expect(problem([factor, factor], [objective])).toMatch(/used twice/)
    expect(problem([{ ...factor, label: '  ' }], [objective])).toMatch(
      /Name every/,
    )
  })
})
