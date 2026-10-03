import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { SampleQuantityBalances } from '#/lib/samples'

import {
  UsageBalanceBar,
  computeUsageSegments,
  reservationStateLabel,
} from './sample-usage'

afterEach(cleanup)

const BALANCES: SampleQuantityBalances = {
  sampleRecordId: 's-1',
  unit: 'mL',
  current: 4600,
  used: 10400,
  reserved: 3000,
  free: 1600,
}

describe('computeUsageSegments', () => {
  it('fills the bar from used + current and splits reserved from free', () => {
    const segments = computeUsageSegments(BALANCES)
    expect(segments.total).toBe(15000)
    expect(segments.usedPct).toBeCloseTo(69.333, 2)
    expect(segments.reservedPct).toBe(20)
    expect(segments.freePct).toBeCloseTo(10.667, 2)
    expect(
      segments.usedPct + segments.reservedPct + segments.freePct,
    ).toBeCloseTo(100, 2)
  })

  it('is all zero when there is no balance yet', () => {
    const segments = computeUsageSegments(null)
    expect(segments.total).toBe(0)
    expect(segments.usedPct).toBe(0)
    expect(segments.reservedPct).toBe(0)
    expect(segments.freePct).toBe(0)
  })
})

describe('reservationStateLabel', () => {
  it('maps the reservation lifecycle to the design status vocabulary', () => {
    expect(reservationStateLabel('active')).toEqual({
      tone: 'progress',
      label: 'Active',
    })
    expect(reservationStateLabel('cancelled')).toEqual({
      tone: 'none',
      label: 'Cancelled',
    })
    expect(reservationStateLabel('fulfilled')).toEqual({
      tone: 'ok',
      label: 'Fulfilled',
    })
  })
})

describe('UsageBalanceBar', () => {
  it('renders the used / reserved / free legend and an accessible bar label', () => {
    render(<UsageBalanceBar balances={BALANCES} />)
    expect(screen.getByText(/Used 10,400 mL/)).toBeTruthy()
    expect(screen.getByText(/Reserved 3,000 mL/)).toBeTruthy()
    expect(screen.getByText(/Free 1,600 mL/)).toBeTruthy()
    expect(
      screen.getByRole('img', {
        name: /15,000 mL registered: 10,400 mL used, 3,000 mL reserved, 1,600 mL free/,
      }),
    ).toBeTruthy()
  })
})
