import { describe, expect, it } from 'vitest'

import { layoutRound, wellsNeeded } from './layout'
import type { Trial } from './layout'

const trials: Trial[] = Array.from({ length: 6 }, (_, i) => ({
  trial: i + 1,
  factors: { temp: 20 + i },
}))

describe('layoutRound', () => {
  it('uses no plate when no format is given', () => {
    const out = layoutRound(trials, {}, 1)
    expect(out.plate).toBeNull()
    expect(out.trials).toHaveLength(6)
  })

  it('gives every trial its own wells, with controls in the first column', () => {
    const { plate, trials: placed } = layoutRound(
      trials,
      {
        plateFormat: '96_well',
        replicates: 2,
        blanks: 2,
        negatives: 1,
        positives: 1,
      },
      7,
    )

    expect(plate?.format).toBe('96_well')
    const samples = plate!.wells.filter((w) => w.role === 'sample')
    expect(samples).toHaveLength(12)
    expect(placed.every((t) => t.wells?.length === 2)).toBe(true)
    expect(new Set(plate!.wells.map((w) => w.wellCode)).size).toBe(
      plate!.wells.length,
    )
    const controls = plate!.wells.filter((w) => w.role !== 'sample')
    expect(controls.map((w) => w.wellCode)).toEqual(['A1', 'B1', 'C1', 'D1'])
    expect(controls.map((w) => w.role)).toEqual([
      'blank',
      'blank',
      'negative_control',
      'positive_control',
    ])
    expect(
      samples.every((w) => !['A1', 'B1', 'C1', 'D1'].includes(w.wellCode)),
    ).toBe(true)
  })

  it('is repeatable for a seed and different for another', () => {
    const layout = { plateFormat: '96_well', replicates: 1 } as const
    const a = layoutRound(trials, layout, 3).trials.map((t) => t.wells)
    const b = layoutRound(trials, layout, 3).trials.map((t) => t.wells)
    const c = layoutRound(trials, layout, 4).trials.map((t) => t.wells)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('stamps the conditions with a worklist when a liquid handler is set', () => {
    const { plate } = layoutRound(
      trials,
      { plateFormat: '96_well', worklistFormat: 'csv', volumeUl: 50 },
      1,
    )

    expect(plate!.transfers).toHaveLength(6)
    expect(
      plate!.transfers.every(
        (t) => t.sourceWell === t.destWell && t.volumeUl === 50,
      ),
    ).toBe(true)

    const none = layoutRound(
      trials,
      { plateFormat: '96_well', worklistFormat: 'csv' },
      1,
    )

    expect(none.plate!.transfers).toHaveLength(0)
  })

  it('says when the batch does not fit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      trial: i + 1,
      factors: {},
    }))

    expect(wellsNeeded({ replicates: 3 }, 30)).toBe(90)
    expect(() =>
      layoutRound(many, { plateFormat: '24_well', replicates: 1 }, 1),
    ).toThrow(/needs 30 wells/)
    expect(() => layoutRound(trials, { plateFormat: '97_well' }, 1)).toThrow(
      /not supported/,
    )
  })
})
