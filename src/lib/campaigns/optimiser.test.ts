import { describe, expect, it } from 'vitest'

import { bestObservation, scoreObservations } from './campaign'
import type { Factor, Objective, Observation, TrialFactors } from './campaign'
import { buildSpace, proposeBatch } from './optimiser'
import { mulberry32 } from '#/lib/plate-designer'

const factors: Factor[] = [
  { key: 'temp', label: 'Temperature', kind: 'continuous', min: 20, max: 40 },
  { key: 'ph', label: 'pH', kind: 'discrete', values: [6, 6.5, 7, 7.5, 8] },
  {
    key: 'buffer',
    label: 'Buffer',
    kind: 'categorical',
    values: ['a', 'b', 'c'],
  },
]
const maximise: Objective[] = [
  { key: 'yield', label: 'Yield', direction: 'maximise' },
]

/** A made-up lab: yield peaks near 32 °C, pH 7 and buffer b. */
function yieldOf(t: TrialFactors): number {
  const temp = Number(t.temp)
  const ph = Number(t.ph)
  return (
    100 -
    ((temp - 32) / 4) ** 2 -
    ((ph - 7) / 0.5) ** 2 * 3 -
    (t.buffer === 'b' ? 0 : 8)
  )
}

function run(seed: number, rounds: number, batch: number, smart: boolean) {
  const observations: Observation[] = []
  const random = mulberry32(seed * 7919)
  const space = buildSpace(factors)
  for (let r = 0; r < rounds; r++) {
    const trials = smart
      ? proposeBatch({
          factors,
          objectives: maximise,
          observations,
          batchSize: batch,
          seed: seed + r,
        }).trials
      : Array.from({ length: batch }, () => space.sample(random))
    for (const t of trials)
      observations.push({ factors: t, values: { yield: yieldOf(t) } })
  }
  return Math.max(...observations.map((o) => o.values.yield))
}

describe('proposeBatch', () => {
  it('covers the space when nothing has been tried', () => {
    const out = proposeBatch({
      factors,
      objectives: maximise,
      observations: [],
      batchSize: 12,
      seed: 1,
    })
    expect(out.strategy).toBe('space-filling')
    expect(out.trials).toHaveLength(12)
    const keys = new Set(out.trials.map((t) => JSON.stringify(t)))
    expect(keys.size).toBe(12)
    for (const t of out.trials) {
      expect(Number(t.temp)).toBeGreaterThanOrEqual(20)
      expect(Number(t.temp)).toBeLessThanOrEqual(40)
      expect([6, 6.5, 7, 7.5, 8]).toContain(t.ph)
      expect(['a', 'b', 'c']).toContain(t.buffer)
    }
    expect(new Set(out.trials.map((t) => t.buffer)).size).toBe(3)
  })

  it('gives the same batch for the same campaign, results and seed', () => {
    const observations: Observation[] = proposeBatch({
      factors,
      objectives: maximise,
      observations: [],
      batchSize: 6,
      seed: 5,
    }).trials.map((t) => ({ factors: t, values: { yield: yieldOf(t) } }))
    const a = proposeBatch({
      factors,
      objectives: maximise,
      observations,
      batchSize: 5,
      seed: 9,
    })
    const b = proposeBatch({
      factors,
      objectives: maximise,
      observations,
      batchSize: 5,
      seed: 9,
    })
    expect(a).toEqual(b)
    expect(a.strategy).toBe('expected-improvement')
    expect(a.trials).toHaveLength(5)
  })

  it('never repeats a condition that was already tried or is in the batch', () => {
    const observations: Observation[] = proposeBatch({
      factors,
      objectives: maximise,
      observations: [],
      batchSize: 8,
      seed: 2,
    }).trials.map((t) => ({ factors: t, values: { yield: yieldOf(t) } }))
    const next = proposeBatch({
      factors,
      objectives: maximise,
      observations,
      batchSize: 10,
      seed: 3,
    })
    const tried = new Set(observations.map((o) => JSON.stringify(o.factors)))
    const keys = new Set(next.trials.map((t) => JSON.stringify(t)))
    expect(keys.size).toBe(next.trials.length)
    for (const key of keys) expect(tried.has(key)).toBe(false)
  })

  it('finds better conditions than picking at random with the same runs', () => {
    let smartTotal = 0
    let randomTotal = 0
    for (let seed = 1; seed <= 6; seed++) {
      smartTotal += run(seed, 5, 6, true)
      randomTotal += run(seed, 5, 6, false)
    }
    expect(smartTotal / 6).toBeGreaterThan(randomTotal / 6)
  })

  it('keeps covering the space while every result is the same', () => {
    const observations: Observation[] = proposeBatch({
      factors,
      objectives: maximise,
      observations: [],
      batchSize: 5,
      seed: 4,
    }).trials.map((t) => ({ factors: t, values: { yield: 50 } }))
    const next = proposeBatch({
      factors,
      objectives: maximise,
      observations,
      batchSize: 4,
      seed: 1,
    })
    expect(next.strategy).toBe('space-filling')
  })

  it('works for a target and several objectives', () => {
    const objectives: Objective[] = [
      { key: 'yield', label: 'Yield', direction: 'maximise', weight: 2 },
      { key: 'cost', label: 'Cost', direction: 'minimise' },
      { key: 'ph_out', label: 'pH out', direction: 'target', target: 7 },
    ]
    const observations: Observation[] = proposeBatch({
      factors,
      objectives,
      observations: [],
      batchSize: 6,
      seed: 11,
    }).trials.map((t, i) => ({
      factors: t,
      values: { yield: yieldOf(t), cost: 5 + i, ph_out: 6 + i * 0.3 },
    }))
    const next = proposeBatch({
      factors,
      objectives,
      observations,
      batchSize: 3,
      seed: 12,
    })
    expect(next.trials).toHaveLength(3)
  })

  it('refuses an empty design', () => {
    expect(() =>
      proposeBatch({
        factors: [],
        objectives: maximise,
        observations: [],
        batchSize: 2,
        seed: 1,
      }),
    ).toThrow(/no factors/)
    expect(() =>
      proposeBatch({
        factors,
        objectives: maximise,
        observations: [],
        batchSize: 0,
        seed: 1,
      }),
    ).toThrow(/empty/)
  })
})

describe('scoring', () => {
  it('flips minimise, measures distance for a target and weights objectives', () => {
    const obs: Observation[] = [
      { factors: {}, values: { a: 1, b: 10 } },
      { factors: {}, values: { a: 2, b: 7 } },
      { factors: {}, values: { a: 3, b: 3 } },
    ]
    const scores = scoreObservations(
      [
        { key: 'a', label: 'A', direction: 'maximise' },
        { key: 'b', label: 'B', direction: 'target', target: 7 },
      ],
      obs,
    )
    expect(scores[2]).toBeGreaterThan(scores[0])
    expect(
      bestObservation([{ key: 'a', label: 'A', direction: 'minimise' }], obs)
        ?.index,
    ).toBe(0)
  })
})
