import { describe, expect, it, vi } from 'vitest'

import {
  describeSlot,
  findFreeGaps,
  instantFromLocal,
  localFromInstant,
  runAssistantAction,
} from './assistant-booking'
import type { DataClient } from './data-client'

const LONDON = 'Europe/London'

describe('wall-clock times', () => {
  it('reads a local time in the person’s zone, across a clock change', () => {
    // Summer: London is UTC+1.
    expect(instantFromLocal('2026-07-01T09:30', LONDON).toISOString()).toBe(
      '2026-07-01T08:30:00.000Z',
    )
    // Winter: London is UTC.
    expect(instantFromLocal('2026-11-06T09:30', LONDON).toISOString()).toBe(
      '2026-11-06T09:30:00.000Z',
    )
    expect(
      instantFromLocal('2026-11-06T09:30', 'America/New_York').toISOString(),
    ).toBe('2026-11-06T14:30:00.000Z')
  })

  it('round-trips a local time', () => {
    const instant = instantFromLocal('2026-03-29T14:15', LONDON)
    expect(localFromInstant(instant, LONDON)).toBe('2026-03-29T14:15')
  })

  it('describes a slot the way a person reads it', () => {
    expect(
      describeSlot(
        instantFromLocal('2026-11-06T09:30', LONDON),
        instantFromLocal('2026-11-06T11:00', LONDON),
        LONDON,
      ),
    ).toBe('Fri 6 Nov, 09:30–11:00')
  })
})

describe('findFreeGaps', () => {
  const at = (local: string) => instantFromLocal(local, LONDON)

  const base = {
    dayStart: '08:00',
    dayEnd: '18:00',
    timeZone: LONDON,
    now: at('2026-11-05T20:00'),
  }

  it('lists the gaps between bookings inside working hours', () => {
    const gaps = findFreeGaps({
      ...base,
      days: ['2026-11-06'],
      minutes: 60,
      busy: [
        { start: at('2026-11-06T09:00'), end: at('2026-11-06T11:00') },
        { start: at('2026-11-06T11:30'), end: at('2026-11-06T13:00') },
      ],
    })

    expect(
      gaps.map((gap) => [
        localFromInstant(gap.start, LONDON),
        localFromInstant(gap.end, LONDON),
      ]),
    ).toEqual([
      ['2026-11-06T08:00', '2026-11-06T09:00'],
      ['2026-11-06T13:00', '2026-11-06T18:00'],
    ])
  })

  it('leaves out gaps too short for the time asked', () => {
    const gaps = findFreeGaps({
      ...base,
      days: ['2026-11-06'],
      minutes: 120,
      busy: [{ start: at('2026-11-06T09:00'), end: at('2026-11-06T17:00') }],
    })

    expect(gaps).toEqual([])
  })

  it('never offers time that has passed, and starts on a quarter hour', () => {
    const gaps = findFreeGaps({
      ...base,
      now: at('2026-11-06T10:07'),
      days: ['2026-11-06'],
      minutes: 30,
      busy: [],
    })

    expect(localFromInstant(gaps[0].start, LONDON)).toBe('2026-11-06T10:15')
  })
})

describe('runAssistantAction', () => {
  it('books through the ordinary booking call, as tentative', async () => {
    const rpc = vi.fn().mockResolvedValue({})
    const client = { rpc } as unknown as DataClient
    await runAssistantAction(client, {
      kind: 'booking.create',
      workspaceId: 'ws',
      instrumentId: 'ins',
      title: 'qPCR run',
      startsAt: '2026-11-06T09:00:00.000Z',
      endsAt: '2026-11-06T10:00:00.000Z',
      timezone: LONDON,
      notes: null,
      linkedExperimentRecordId: null,
    })
    expect(rpc).toHaveBeenCalledWith(
      'create_booking',
      expect.objectContaining({
        p_workspace_id: 'ws',
        p_resource_id: 'ins',
        p_status: 'tentative',
        p_timezone: LONDON,
      }),
    )
  })

  it('moves and cancels with the version the card was built against', async () => {
    const rpc = vi.fn().mockResolvedValue({})
    const client = { rpc } as unknown as DataClient
    await runAssistantAction(client, {
      kind: 'booking.move',
      bookingId: 'b',
      startsAt: 's',
      endsAt: 'e',
      expectedMetadataVersion: 3,
    })
    await runAssistantAction(client, {
      kind: 'booking.cancel',
      bookingId: 'b',
      expectedMetadataVersion: 4,
    })
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'edit_booking',
      expect.objectContaining({
        p_booking_id: 'b',
        p_expected_metadata_version: 3,
      }),
    )
    expect(rpc).toHaveBeenNthCalledWith(2, 'cancel_booking', {
      p_booking_id: 'b',
      p_expected_metadata_version: 4,
    })
  })
})
