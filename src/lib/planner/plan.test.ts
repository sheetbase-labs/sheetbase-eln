import { describe, expect, it } from 'vitest'

import {
  parsePlanAnswer,
  planReference,
  plannerInstruction,
  plateCounts,
} from './plan'
import type { PlannerContext } from './plan'

const context: PlannerContext = {
  protocols: [{ id: 'p-1', identifier: 'PRT-0001', title: 'Cell viability' }],
  instruments: [
    { id: 'i-1', name: 'Plate reader' },
    { id: 'i-2', name: 'Incubator' },
  ],
  samples: [
    {
      id: 's-1',
      identifier: 'SAM-0001',
      title: 'Compound X',
      quantity: 100,
      unit: 'µL',
    },
    {
      id: 's-2',
      identifier: 'SAM-0002',
      title: 'Cells',
      quantity: 2,
      unit: 'mL',
    },
  ],
}

const answer = {
  summary: 'Dose response of compound X.',
  rationale: 'Eight doses in triplicate fit one plate.',
  experimentTitle: 'Dose response of X',
  protocol: 't1',
  parts: [
    {
      title: 'Seed cells',
      day: 0,
      handsOnMinutes: 45,
      waitMinutes: 1440,
      instruments: [{ key: 'i2', minutes: 1440 }],
    },
    {
      title: 'Read the plate',
      day: 1,
      handsOnMinutes: 30,
      instruments: [
        { key: 'i1', minutes: 30 },
        { key: 'i9', minutes: 5 },
      ],
    },
  ],
  plate: {
    format: '96_well',
    conditions: [
      { label: 'Compound X', count: 8 },
      { label: 'Vehicle', count: 1 },
    ],
    replicates: 3,
    blanks: 3,
    negatives: 3,
    positives: 3,
    volumeUl: 20,
  },
  worklist: { format: 'csv', sourcePlate: 'Dilutions' },
  samples: [
    { key: 's1', quantity: 5 },
    { key: 's2', quantity: 5 },
    { key: 's7', quantity: 1 },
  ],
  schedule: true,
  warnings: ['Assumed 24 hour incubation.'],
}

describe('plannerInstruction', () => {
  it('names only what the lab has, by short keys', () => {
    const text = plannerInstruction('Test compound X', context)
    expect(text).toContain('Goal: "Test compound X"')
    expect(text).toContain('- t1 | PRT-0001 | Cell viability')
    expect(text).toContain('- i2 | Incubator')
    expect(text).toContain('- s1 | SAM-0001 | Compound X | 100 µL')
    expect(text).not.toContain('p-1')
    expect(text).not.toContain('i-1')
  })
})

describe('parsePlanAnswer', () => {
  it('turns an answer into a plan with the real ids, a plate and a worklist', () => {
    const plan = parsePlanAnswer(
      JSON.stringify(answer),
      'Test compound X',
      context,
    )!
    expect(plan.experiment).toMatchObject({
      title: 'Dose response of X',
      templateRecordId: 'p-1',
      templateLabel: 'PRT-0001 Cell viability',
    })
    expect(plan.parts).toHaveLength(2)
    expect(plan.parts[0]).toMatchObject({
      dayOffset: 0,
      handsOnMinutes: 45,
      waitAfterMinutes: 1440,
    })
    expect(plan.parts[0].needs).toEqual([
      { instrumentId: 'i-2', name: 'Incubator', minutes: 1440 },
    ])
    expect(plan.parts[1].needs).toEqual([
      { instrumentId: 'i-1', name: 'Plate reader', minutes: 30 },
    ])
    // 9 conditions in triplicate, plus 9 control wells.
    expect(plateCounts(plan)).toEqual({ samples: 27, controls: 9 })
    expect(
      plan.plate?.wells.find((w) => w.role === 'sample')?.sampleLabel,
    ).toMatch(/Compound X|Vehicle/)
    expect(plan.worklist).toMatchObject({
      format: 'csv',
      mode: 'stamp',
      sourcePlate: 'Dilutions',
    })
    expect(plan.worklist?.transfers).toHaveLength(27)
    expect(plan.samples).toEqual([
      {
        recordId: 's-1',
        quantity: 5,
        unit: 'µL',
        label: 'SAM-0001 Compound X',
      },
      { recordId: 's-2', quantity: 5, unit: 'mL', label: 'SAM-0002 Cells' },
    ])
    expect(plan.schedule).toBe(true)
  })

  it('leaves out what it cannot match and says so', () => {
    const plan = parsePlanAnswer(
      JSON.stringify(answer),
      'Test compound X',
      context,
    )!
    expect(plan.warnings).toContain('Assumed 24 hour incubation.')
    expect(
      plan.warnings.some((w) =>
        w.includes('instrument for “Read the plate” was not found'),
      ),
    ).toBe(true)
    expect(
      plan.warnings.some((w) =>
        w.includes('sample the plan named was not found'),
      ),
    ).toBe(true)
    // 5 mL asked of 2 mL left.
    expect(
      plan.warnings.some((w) => w.startsWith('SAM-0002 has 2 mL left')),
    ).toBe(true)
    const unknownProtocol = parsePlanAnswer(
      JSON.stringify({ ...answer, protocol: 't9' }),
      'g',
      context,
    )!
    expect(unknownProtocol.experiment.templateRecordId).toBeUndefined()
    expect(unknownProtocol.warnings.some((w) => w.includes('protocol'))).toBe(
      true,
    )
  })

  it('does not ask for a schedule when no part needs an instrument', () => {
    const plan = parsePlanAnswer(
      JSON.stringify({
        ...answer,
        parts: [{ title: 'Think', instruments: [] }],
        plate: null,
        worklist: null,
        samples: [],
      }),
      'g',
      context,
    )!
    expect(plan.schedule).toBe(false)
    expect(plan.plate).toBeNull()
  })

  it('falls back to a 96-well plate and a plain file, and explains a plate that does not fit', () => {
    const odd = parsePlanAnswer(
      JSON.stringify({
        ...answer,
        plate: { ...answer.plate, format: '97_well' },
        worklist: { format: 'laser' },
      }),
      'g',
      context,
    )!
    expect(odd.plate?.format).toBe('96_well')
    expect(odd.worklist?.format).toBe('csv')
    expect(odd.warnings.some((w) => w.includes('not supported'))).toBe(true)

    const tooBig = parsePlanAnswer(
      JSON.stringify({
        ...answer,
        plate: {
          ...answer.plate,
          format: '24_well',
          conditions: [{ label: 'A', count: 20 }],
        },
      }),
      'g',
      context,
    )!
    expect(tooBig.plate).toBeNull()
    expect(tooBig.warnings.some((w) => w.includes('needs'))).toBe(true)
  })

  it('is repeatable', () => {
    const a = parsePlanAnswer(JSON.stringify(answer), 'Same goal', context)
    const b = parsePlanAnswer(JSON.stringify(answer), 'Same goal', context)
    expect(a).toEqual(b)
  })

  it('returns nothing for an answer that is not a plan', () => {
    expect(parsePlanAnswer('I could not do that.', 'g', context)).toBeNull()
    expect(parsePlanAnswer('{"summary":"x"}', 'g', context)).toBeNull()
    expect(parsePlanAnswer('{"parts":[{"title":""}]}', 'g', context)).toBeNull()
    expect(
      parsePlanAnswer('Here you go: ' + JSON.stringify(answer), 'g', context),
    ).not.toBeNull()
  })
})

describe('planReference', () => {
  it('pads the number', () => expect(planReference(7)).toBe('PLN-0007'))
})
