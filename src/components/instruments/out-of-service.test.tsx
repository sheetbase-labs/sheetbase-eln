import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { OutOfServiceNotice, isOutOfService } from './out-of-service'
import type { InstrumentRow } from './instruments-data'
import { describeCalendarError } from '#/lib/calendar'
import { DataClientError } from '#/lib/data-client'

const BASE: InstrumentRow = {
  id: 'i1',
  displayId: 'INS-0001',
  name: 'Plate reader',
  instrumentType: 'other',
  model: null,
  serialNumber: null,
  vendor: null,
  location: null,
  ownerId: null,
  retiredAt: null,
  intakeMethod: 'none',
  position: 0,
  updatedAt: '2026-11-04T09:00:00Z',
}

describe('out of service', () => {
  it('is down only while marked and not retired', () => {
    expect(isOutOfService(BASE)).toBe(false)
    expect(
      isOutOfService({ ...BASE, outOfServiceAt: '2026-11-03T09:00:00Z' }),
    ).toBe(true)
    expect(
      isOutOfService({
        ...BASE,
        outOfServiceAt: '2026-11-03T09:00:00Z',
        retiredAt: '2026-11-04T09:00:00Z',
      }),
    ).toBe(false)
  })

  it('says why, since when, until when and who marked it', () => {
    const html = renderToStaticMarkup(
      <OutOfServiceNotice
        instrument={{
          ...BASE,
          outOfServiceAt: '2026-11-03T09:00:00Z',
          outOfServiceReason: 'Lamp failed',
          outOfServiceBy: 'u1',
          expectedBackOn: '2026-11-10',
        }}
        names={{ userLabel: () => 'Dana' }}
      />,
    )

    expect(html).toContain('Out of service since')
    expect(html).toContain('Lamp failed')
    expect(html).toContain('Expected back')
    expect(html).toContain('Marked by Dana')
  })

  it('explains a refused booking in plain words', () => {
    const message = describeCalendarError(
      new DataClientError('SB135', 'refused', 400),
    )

    expect(message).toMatch(/out of service/)
  })
})
