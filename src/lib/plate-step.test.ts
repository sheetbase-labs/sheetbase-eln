import { describe, expect, it } from 'vitest'

import { expectedPlateCount, suggestPlateStep } from './plate-step'
import type { PlateStepRow } from './plate-step'

const step = (
  id: string,
  text: string,
  status: PlateStepRow['status'] = 'not_started',
  current = false,
): PlateStepRow => ({
  block_id: id,
  step_number: null,
  step_text: text,
  status,
  is_current: current,
  result_count: 0,
})

describe('suggestPlateStep', () => {
  it('offers the first open step that names plates', () => {
    const steps = [
      step('a', 'Hold harvest', 'done'),
      step('b', 'Filtrate turbidity', 'not_started', true),
      step('c', 'Capsid titre by ELISA, plates 1–4'),
    ]

    expect(suggestPlateStep(steps)?.block_id).toBe('c')
  })

  it('does not guess the current step when none names a plate', () => {
    expect(
      suggestPlateStep([step('a', 'Hold harvest', 'in_progress', true)]),
    ).toBeNull()
  })

  it('skips a step that is already done', () => {
    expect(suggestPlateStep([step('a', 'Read plate 1', 'done')])).toBeNull()
  })
})

describe('expectedPlateCount', () => {
  it('counts a range, a number of plates and a single plate', () => {
    expect(expectedPlateCount('Capsid titre by ELISA, plates 1–4')).toBe(4)
    expect(expectedPlateCount('Read plates 2-3')).toBe(2)
    expect(expectedPlateCount('Run 6 plates')).toBe(6)
    expect(expectedPlateCount('plate 4 today')).toBe(1)
  })

  it('has no answer when the words name no plate', () => {
    expect(expectedPlateCount('Filtrate turbidity')).toBeNull()
    expect(expectedPlateCount(null)).toBeNull()
  })
})
