import { describe, expect, it } from 'vitest'

import {
  NO_LIMITS,
  describeLimits,
  incidentSummary,
  keepTimeLabel,
  limitsProblem,
  parseLimit,
  readableValue,
  specVerdict,
  worstVerdict,
} from './result-quality'

const purity = {
  lowerLimit: 90,
  upperLimit: 100,
  alertLower: 95,
  alertUpper: null,
}

describe('specVerdict', () => {
  it('passes inside the limits and the alert band', () => {
    expect(specVerdict(97, purity)).toBe('pass')
  })
  it('treats a value on a limit as inside it', () => {
    expect(specVerdict(100, purity)).toBe('pass')
    expect(specVerdict(90, { ...purity, alertLower: null })).toBe('pass')
  })
  it('raises an alert inside the limits but outside the alert band', () => {
    expect(specVerdict(92, purity)).toBe('alert')
  })
  it('fails outside the limits', () => {
    expect(specVerdict(89.9, purity)).toBe('fail')
    expect(specVerdict(100.1, purity)).toBe('fail')
  })
  it('judges against one side when only one is set', () => {
    const atLeast = { ...NO_LIMITS, lowerLimit: 1000 }
    expect(specVerdict(500, atLeast)).toBe('fail')
    expect(specVerdict(5000, atLeast)).toBe('pass')
  })
  it('gives no verdict for no value', () => {
    expect(specVerdict(null, purity)).toBeNull()
    expect(specVerdict(undefined, purity)).toBeNull()
    expect(specVerdict(Number.NaN, purity)).toBeNull()
  })
})

describe('limitsProblem', () => {
  it('accepts no limits at all, which clears them', () => {
    expect(limitsProblem(NO_LIMITS)).toBeNull()
  })
  it('wants a lowest or highest value', () => {
    expect(limitsProblem({ ...NO_LIMITS, alertLower: 3 })).toBe('needsLimit')
  })
  it('wants the lowest below the highest', () => {
    expect(limitsProblem({ ...NO_LIMITS, lowerLimit: 5, upperLimit: 1 })).toBe(
      'order',
    )
  })
  it('wants alert values inside the limits', () => {
    expect(limitsProblem({ ...purity, alertLower: 80 })).toBe('alertOutside')
    expect(limitsProblem({ ...purity, alertUpper: 120 })).toBe('alertOutside')
    expect(limitsProblem(purity)).toBeNull()
  })
})

describe('reading and describing limits', () => {
  it('reads an empty box as no limit and a typo as no number', () => {
    expect(parseLimit('')).toBeNull()
    expect(parseLimit(' 2.5 ')).toBe(2.5)
    expect(parseLimit('abc')).toBeNull()
  })
  it('puts the limits in words', () => {
    expect(describeLimits(purity)).toBe('90 to 100')
    expect(describeLimits({ ...NO_LIMITS, lowerLimit: 4 })).toBe('at least 4')
    expect(describeLimits({ ...NO_LIMITS, upperLimit: 9 })).toBe('at most 9')
  })
  it('finds the worst verdict', () => {
    expect(worstVerdict([{ verdict: 'pass' }, { verdict: 'alert' }])).toBe(
      'alert',
    )
    expect(worstVerdict([{ verdict: 'alert' }, { verdict: 'fail' }])).toBe(
      'fail',
    )
    expect(worstVerdict([])).toBeNull()
  })
})

describe('incident lines', () => {
  it('turns stored keys into words', () => {
    expect(readableValue('near_miss')).toBe('Near miss')
    expect(readableValue('Door left open')).toBe('Door left open')
    expect(readableValue('2026-11-01')).toBe('2026-11-01')
    expect(readableValue(null)).toBe('')
  })
  it('summarises the first three things filled in, leaving dates out', () => {
    const entry = {
      id: '1',
      identifier: 'INC-0001',
      title: 'Freezer alarm',
      kind: 'incident',
      status: 'draft',
      created_at: '2026-11-01T00:00:00Z',
      archived_at: null,
      custom_fields: {
        kind: 'deviation',
        severity: 'major',
        occurred_on: '2026-11-01',
        what_happened: 'Door left open',
        root_cause: 'Tired',
      },
    }

    expect(incidentSummary(entry)).toBe('Deviation · Major · Door left open')
  })
})

describe('keepTimeLabel', () => {
  it('says whole years as years and anything else as months', () => {
    expect(keepTimeLabel(12)).toBe('1 year')
    expect(keepTimeLabel(24)).toBe('2 years')
    expect(keepTimeLabel(18)).toBe('18 months')
    expect(keepTimeLabel(1)).toBe('1 month')
  })
})
