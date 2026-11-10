import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SampleHoldMeter } from './sample-hold-meter'
import { computeSampleHold } from './sample-hold-data'

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

  it.each([
    { value: 3n, expiry: '2026-09-23T00:00:00.000Z' },
    { value: [2], expiry: '2026-09-22T00:00:00.000Z' },
    { value: false, expiry: '2026-09-20T00:00:00.000Z' },
    { value: '0x10', expiry: '2026-10-06T00:00:00.000Z' },
    { value: { valueOf: () => 5 }, expiry: '2026-09-25T00:00:00.000Z' },
  ])('retains native numeric hold duration $expiry', ({ value, expiry }) => {
    expect(
      computeSampleHold(
        { createdAt: CREATED, properties: { holdDurationDays: value } },
        NOW,
      )?.expiry.toISOString(),
    ).toBe(expiry)
  })

  it('reads and coerces only the needed members in their original order', () => {
    const reads: string[] = []

    const record = {
      createdAt: CREATED,
      properties: {
        get holdUntil() {
          reads.push('properties.until')

          return ''
        },
        get holdDurationDays() {
          reads.push('duration')

          return {
            [Symbol.toPrimitive](hint: string) {
              reads.push(`coerce:${hint}`)

              return '4'
            },
          }
        },
        get holdStartedAt() {
          reads.push('start')

          return CREATED
        },
        get expiryDate() {
          reads.push('legacy')

          return '2027-01-01'
        },
        get holdCondition() {
          reads.push('condition')

          return ' cold '
        },
        get unrelated() {
          throw new Error('unrelated member must not be read')
        },
      },
      customFields: {
        get holdUntil() {
          reads.push('custom.until')

          return ' '
        },
      },
    }

    const state = computeSampleHold(record, NOW)
    expect(state?.expiry.toISOString()).toBe('2026-09-24T00:00:00.000Z')
    expect(state?.condition).toBe('cold')
    expect(reads).toEqual([
      'properties.until',
      'custom.until',
      'duration',
      'coerce:number',
      'start',
      'legacy',
      'condition',
    ])
  })

  it('falls back after nonfinite durations but preserves native coercion failures', () => {
    expect(
      computeSampleHold(
        {
          createdAt: CREATED,
          properties: { holdDurationDays: Infinity },
          customFields: { holdDurationDays: 2 },
        },
        NOW,
      )?.expiry.toISOString(),
    ).toBe('2026-09-22T00:00:00.000Z')
    expect(() =>
      computeSampleHold(
        {
          createdAt: CREATED,
          properties: { holdDurationDays: Symbol('duration') },
        },
        NOW,
      ),
    ).toThrow(TypeError)
    const failure = new Error('native duration failed')
    expect(() =>
      computeSampleHold(
        {
          createdAt: CREATED,
          properties: {
            holdDurationDays: {
              valueOf() {
                throw failure
              },
            },
          },
        },
        NOW,
      ),
    ).toThrow(failure)
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
  })

  it('states honestly when no expiry date is recorded', () => {
    render(<SampleHoldMeter record={{ createdAt: CREATED, properties: {} }} />)
    expect(screen.getByText('No hold or expiry date recorded')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})
