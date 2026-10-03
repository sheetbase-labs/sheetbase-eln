import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SampleHoldMeter, computeSampleHold } from './sample-hold-meter'

const NOW = new Date('2026-09-25T00:00:00.000Z')
const CREATED = '2026-09-20T00:00:00.000Z'
const EXPIRY = '2026-10-04'

afterEach(cleanup)

describe('computeSampleHold', () => {
  it('derives days used/left from the expiry and registration window', () => {
    const state = computeSampleHold(
      { createdAt: CREATED, properties: { expiryDate: EXPIRY } },
      NOW,
    )
    expect(state).not.toBeNull()
    expect(state!.totalDays).toBe(14)
    expect(state!.daysUsed).toBe(5)
    expect(state!.daysLeft).toBe(9)
    expect(state!.percentUsed).toBe(36)
    expect(state!.expired).toBe(false)
  })

  it('reads an expiry stored in custom fields', () => {
    const state = computeSampleHold(
      { createdAt: CREATED, customFields: { expiryDate: EXPIRY } },
      NOW,
    )
    expect(state?.daysLeft).toBe(9)
  })

  it('reports an expired sample', () => {
    const state = computeSampleHold(
      { createdAt: CREATED, properties: { expiryDate: EXPIRY } },
      new Date('2026-10-10T00:00:00.000Z'),
    )
    expect(state?.expired).toBe(true)
    expect(state?.daysLeft).toBe(0)
    expect(state?.daysAgo).toBe(6)
    expect(state?.percentUsed).toBe(100)
  })

  it('returns null when no expiry date is modelled', () => {
    expect(
      computeSampleHold({ createdAt: CREATED, properties: {} }, NOW),
    ).toBeNull()
  })

  it('returns null for an unparseable expiry date', () => {
    expect(
      computeSampleHold(
        { createdAt: CREATED, properties: { expiryDate: 'soon' } },
        NOW,
      ),
    ).toBeNull()
  })
})

describe('SampleHoldMeter', () => {
  it('renders the meter for a sample with an expiry date', () => {
    render(
      <SampleHoldMeter
        record={{ createdAt: CREATED, properties: { expiryDate: EXPIRY } }}
        now={NOW}
      />,
    )
    expect(screen.getByText('5 of 14 days used')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '36',
    )
    expect(screen.getByText(/use by/)).toBeTruthy()
  })

  it('states honestly when no expiry date is recorded', () => {
    render(<SampleHoldMeter record={{ createdAt: CREATED, properties: {} }} />)
    expect(screen.getByText('No hold or expiry date recorded.')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})
