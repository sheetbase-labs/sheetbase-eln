import { describe, expect, it } from 'vitest'

import { instantFromLocal } from './assistant-booking'
import {
  buildBookingProposal,
  resolveInstrument,
  runLabReadTool,
} from './assistant-lab-tools.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const WS = '33333333-3333-4333-8333-333333333333'
const ME = 'user-me'
const TZ = 'Europe/London'
const QPCR = '11111111-1111-4111-8111-111111111111'
const PLATE = '22222222-2222-4222-8222-222222222222'
const MINE = '44444444-4444-4444-8444-444444444444'
const THEIRS = '55555555-5555-4555-8555-555555555555'

const instruments = [
  {
    id: QPCR,
    display_id: 'INS-0001',
    name: 'QuantStudio 5 qPCR',
    location: 'Lab 2',
    instrument_type: 'qpcr',
    retired_at: null,
    out_of_service_at: null,
  },
  {
    id: PLATE,
    display_id: 'INS-0002',
    name: 'Plate reader',
    location: 'Lab 1',
    instrument_type: 'other',
    retired_at: null,
    out_of_service_at: '2026-11-01T00:00:00Z',
  },
]

const at = (local: string) => instantFromLocal(local, TZ).toISOString()

function booking(overrides: Record<string, unknown>) {
  return {
    id: 'b1',
    workspace_id: WS,
    resource_id: QPCR,
    title: 'Someone’s run',
    status: 'tentative',
    starts_at: at('2026-11-06T09:00'),
    ends_at: at('2026-11-06T11:00'),
    timezone: TZ,
    created_by_user_id: 'user-other',
    metadata_version: 2,
    cancelled_at: null,
    linked_experiment_identifier: null,
    linked_experiment_title: null,
    ...overrides,
  }
}

function fakeClient(data: {
  bookings?: Array<Record<string, unknown>>
  rules?: Array<Record<string, unknown>>
  training?: Array<Record<string, unknown>>
  records?: Array<Record<string, unknown>>
  requestForms?: Array<Record<string, unknown>>
}) {
  const calls: string[] = []

  const client = {
    list: (resource: string, query = '') => {
      calls.push(`${resource}${query}`)

      switch (resource) {
        case 'instruments':
          return Promise.resolve(
            query.startsWith('?id=eq.')
              ? instruments.filter((row) => query.includes(row.id))
              : instruments,
          )
        case 'calendar_bookings': {
          const rows = data.bookings ?? []
          const id = /id=eq\.([\w-]+)/.exec(query)?.[1]

          if (query.startsWith('?id=eq.')) {
            return Promise.resolve(rows.filter((row) => row.id === id))
          }

          const start = decodeURIComponent(
            /ends_at=gt\.([^&]+)/.exec(query)?.[1] ?? '',
          )

          const end = decodeURIComponent(
            /starts_at=lt\.([^&]+)/.exec(query)?.[1] ?? '',
          )

          return Promise.resolve(
            rows.filter(
              (row) =>
                String(row.starts_at) < end && String(row.ends_at) > start,
            ),
          )
        }

        case 'instrument_booking_rules':
          return Promise.resolve(data.rules ?? [])
        case 'records':
          return Promise.resolve(data.records ?? [])
        case 'request_forms':
          return Promise.resolve(data.requestForms ?? [])
        default:
          return Promise.resolve([])
      }
    },
    rpc: (name: string) => {
      if (name === 'my_instrument_training_gaps') {
        return Promise.resolve(data.training ?? [])
      }

      if (name === 'workspace_members_list') {
        return Promise.resolve([{ user_id: 'user-other', name: 'Priya Shah' }])
      }

      return Promise.resolve([])
    },
  } as unknown as DataClient

  return { client, calls }
}

function context(client: DataClient): LabToolContext {
  return {
    client,
    workspaceId: WS,
    userId: ME,
    timeZone: TZ,
    now: new Date(at('2026-11-05T20:00')),
  }
}

describe('resolveInstrument', () => {
  it('finds an instrument by the words a person uses', async () => {
    const { client } = fakeClient({})
    const byWords = await resolveInstrument(client, WS, 'the qpcr')
    expect(byWords.ok).toBe(false)
    const byName = await resolveInstrument(client, WS, 'qpcr')
    expect(byName).toMatchObject({ ok: true, instrument: { id: QPCR } })
    const byNumber = await resolveInstrument(client, WS, 'ins-0002')
    expect(byNumber).toMatchObject({ ok: true, instrument: { id: PLATE } })
  })

  it('lists the instruments by name when nothing matches, never by id', async () => {
    const { client } = fakeClient({})
    const result = await resolveInstrument(client, WS, 'mass spec')
    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.message).toContain('QuantStudio 5 qPCR (INS-0001)')
      expect(result.message).not.toContain(QPCR)
    }
  })
})

describe('schedule reads', () => {
  it('reads bookings with names, on the person’s clock', async () => {
    const { client } = fakeClient({ bookings: [booking({})] })

    const result = await runLabReadTool(
      'sheetbase.schedule.read',
      { from: '2026-11-06', days: 1 },
      context(client),
    )

    expect(result.isError).toBe(false)

    const parsed = JSON.parse(result.text) as {
      bookings: Array<Record<string, string>>
    }

    expect(parsed.bookings[0]).toMatchObject({
      instrument: 'QuantStudio 5 qPCR (INS-0001)',
      when: 'Fri 6 Nov, 09:00–11:00',
      bookedBy: 'Priya Shah',
    })
  })

  it('finds free time around existing bookings, with what stands in the way', async () => {
    const { client } = fakeClient({
      bookings: [booking({})],
      training: [{ identifier: 'PRO-4', title: 'qPCR training' }],
      rules: [{ max_booking_minutes: 240, max_advance_days: 14 }],
    })

    const result = await runLabReadTool(
      'sheetbase.schedule.free_time',
      { instrument: 'qpcr', from: '2026-11-06', days: 1, durationMinutes: 60 },
      context(client),
    )

    const parsed = JSON.parse(result.text) as {
      free: Array<{ when: string }>
      cannotBookBecause: string[]
      rules: Record<string, string>
    }

    expect(parsed.free.map((gap) => gap.when)).toEqual([
      'Fri 6 Nov, 08:00–09:00',
      'Fri 6 Nov, 11:00–18:00',
    ])
    expect(parsed.rules.longestBooking).toBe('4 hours')
    expect(parsed.cannotBookBecause[0]).toContain('PRO-4 qPCR training')
  })

  it('lists requests from the models set up as request forms', async () => {
    const { client, calls } = fakeClient({
      requestForms: [{ model_key: 'sequencing_request' }],
      records: [
        { identifier: 'REQ-3', title: 'Sanger run', status: 'requested' },
      ],
    })

    const result = await runLabReadTool(
      'sheetbase.lab.list',
      { area: 'requests', openOnly: true, query: 'sanger' },
      context(client),
    )

    expect(JSON.parse(result.text)).toMatchObject({
      area: 'requests',
      returned: 1,
      page: '/requests',
    })
    const recordsCall = calls.find((call) => call.startsWith('records'))
    expect(recordsCall).toContain('kind=in.(sequencing_request)')
    expect(recordsCall).toContain('status=in.(requested,accepted)')
    expect(recordsCall).toContain('title.ilike.*sanger*')
  })
})

describe('booking proposals', () => {
  it('proposes a free slot as a card the person confirms', async () => {
    const { client } = fakeClient({ bookings: [booking({})] })

    const outcome = await buildBookingProposal(
      'sheetbase.booking.create',
      {
        title: 'Book the qPCR',
        summary: 'Friday afternoon for your plate',
        instrument: 'QuantStudio',
        start: '2026-11-06T13:00',
        durationMinutes: 90,
      },
      context(client),
    )

    expect(outcome.ok).toBe(true)

    if (!outcome.ok) return
    expect(outcome.proposal.changes).toContainEqual({
      label: 'When',
      before: null,
      after: 'Fri 6 Nov, 13:00–14:30',
    })
    expect(outcome.proposal.action).toEqual({
      kind: 'booking.create',
      workspaceId: WS,
      instrumentId: QPCR,
      title: 'Book the qPCR',
      startsAt: '2026-11-06T13:00:00.000Z',
      endsAt: '2026-11-06T14:30:00.000Z',
      timezone: TZ,
      notes: null,
      linkedExperimentRecordId: null,
    })
    expect(outcome.proposal.operation).toBeUndefined()
  })

  it('says why when the time is taken or the instrument is out of service', async () => {
    const { client } = fakeClient({ bookings: [booking({})] })

    const taken = await buildBookingProposal(
      'sheetbase.booking.create',
      {
        title: 't',
        summary: 's',
        instrument: 'qpcr',
        start: '2026-11-06T10:00',
        durationMinutes: 60,
      },
      context(client),
    )

    expect(taken).toMatchObject({ ok: false })

    if (!taken.ok) expect(taken.message).toContain('already booked')

    const broken = await buildBookingProposal(
      'sheetbase.booking.create',
      {
        title: 't',
        summary: 's',
        instrument: 'plate reader',
        start: '2026-11-06T10:00',
        durationMinutes: 60,
      },
      context(client),
    )

    expect(broken).toMatchObject({ ok: false })

    if (!broken.ok) expect(broken.message).toContain('out of service')
  })

  it('only moves the person’s own booking, keeping its length', async () => {
    const mine = booking({ id: MINE, created_by_user_id: ME })

    const theirs = booking({
      id: THEIRS,
      starts_at: at('2026-11-07T09:00'),
      ends_at: at('2026-11-07T10:00'),
    })

    const { client } = fakeClient({ bookings: [mine, theirs] })

    const moved = await buildBookingProposal(
      'sheetbase.booking.move',
      {
        title: 'Move it',
        summary: 'Later',
        bookingId: MINE,
        start: '2026-11-06T14:00',
      },
      context(client),
    )

    expect(moved).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'booking.move',
          bookingId: MINE,
          startsAt: '2026-11-06T14:00:00.000Z',
          endsAt: '2026-11-06T16:00:00.000Z',
          expectedMetadataVersion: 2,
        },
      },
    })

    const refused = await buildBookingProposal(
      'sheetbase.booking.cancel',
      { title: 'Cancel', summary: 'x', bookingId: THEIRS },
      context(client),
    )

    expect(refused).toMatchObject({ ok: false })
  })
})
