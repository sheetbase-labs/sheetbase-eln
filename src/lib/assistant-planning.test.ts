import { describe, expect, it, vi } from 'vitest'

import { runAssistantAction } from './assistant-booking'
import { repeatDates } from './assistant-planning'
import type { DataClient } from './data-client'

vi.mock('./step-timer-alert', () => ({
  prepareTimerAlerts: () => Promise.resolve(),
}))

function recordingClient() {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    list: () => Promise.resolve([]),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args })
      if (name === 'instantiate_template') {
        return Promise.resolve({ record: { id: 'new-exp' } })
      }
      if (name === 'create_shipment') return Promise.resolve({ id: 'ship-1' })
      return Promise.resolve({})
    },
  } as unknown as DataClient
  return { client, rpcs }
}

describe('repeatDates', () => {
  it('lists every Monday for eight weeks', () => {
    const dates = repeatDates({
      firstDay: '2026-11-09',
      frequency: 'weekly',
      every: 1,
      weekdays: [1],
      count: 8,
      until: null,
    })
    expect(dates).toHaveLength(8)
    expect(dates[0]).toBe('2026-11-09')
    expect(dates[7]).toBe('2026-12-28')
  })

  it('skips weeks for every other week on two weekdays', () => {
    expect(
      repeatDates({
        firstDay: '2026-11-09',
        frequency: 'weekly',
        every: 2,
        weekdays: [1, 3],
        count: 4,
        until: null,
      }),
    ).toEqual(['2026-11-09', '2026-11-11', '2026-11-23', '2026-11-25'])
  })

  it('keeps the day of the month, using the last day of a short month', () => {
    expect(
      repeatDates({
        firstDay: '2027-01-31',
        frequency: 'monthly',
        every: 1,
        weekdays: [],
        count: 3,
        until: null,
      }),
    ).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('stops at the last day', () => {
    expect(
      repeatDates({
        firstDay: '2026-11-09',
        frequency: 'daily',
        every: 2,
        weekdays: [],
        count: null,
        until: '2026-11-15',
      }),
    ).toEqual(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-15'])
  })
})

describe('running a planning card', () => {
  it('starts an experiment from a template and says where it opened', async () => {
    const { client, rpcs } = recordingClient()
    const result = await runAssistantAction(client, {
      kind: 'experiment.start',
      templateRecordId: 'tpl',
      projectId: 'proj',
      title: 'ELISA plate 4',
    })
    expect(rpcs[0]).toMatchObject({
      name: 'instantiate_template',
      args: {
        p_template_record_id: 'tpl',
        p_target_project_id: 'proj',
        p_target_kind: 'experiment',
        p_title: 'ELISA plate 4',
      },
    })
    expect(result).toEqual({ openHref: '/records/new-exp' })
  })

  it('assigns with the version the card was built on', async () => {
    const { client, rpcs } = recordingClient()
    await runAssistantAction(client, {
      kind: 'record.assign',
      recordId: 'rec',
      expectedMetadataVersion: 3,
      userId: 'priya',
    })
    expect(rpcs[0]).toEqual({
      name: 'assign_record',
      args: {
        p_record_id: 'rec',
        p_expected_metadata_version: 3,
        p_assignee_user_id: 'priya',
      },
    })
  })

  it('comments with the people mentioned', async () => {
    const { client, rpcs } = recordingClient()
    await runAssistantAction(client, {
      kind: 'record.comment',
      recordId: 'rec',
      body: '@Sam Check the curve',
      mentions: ['sam'],
    })
    expect(rpcs[0]).toMatchObject({
      name: 'create_record_comment',
      args: { p_record_id: 'rec', p_mentions: ['sam'] },
    })
  })

  it('starts a timer on a step', async () => {
    const { client, rpcs } = recordingClient()
    await runAssistantAction(client, {
      kind: 'timer.start',
      blockId: 'blk',
      seconds: 1800,
    })
    expect(rpcs[0]).toEqual({
      name: 'start_step_timer',
      args: { p_block_id: 'blk', p_seconds: 1800 },
    })
  })

  it('finishes a step and records a result on it', async () => {
    const { client, rpcs } = recordingClient()
    await runAssistantAction(client, {
      kind: 'step.done',
      blockId: 'blk',
      done: true,
      note: 'plate 4',
    })
    await runAssistantAction(client, {
      kind: 'step.result',
      blockId: 'blk',
      label: 'OD450',
      value: '0.82',
      unit: null,
    })
    expect(rpcs[0]).toEqual({
      name: 'set_step_done',
      args: { p_block_id: 'blk', p_done: true, p_note: 'plate 4' },
    })
    expect(rpcs[1]).toEqual({
      name: 'add_step_result',
      args: { p_block_id: 'blk', p_label: 'OD450', p_value: '0.82' },
    })
  })

  it('creates a shipment and marks it on its way', async () => {
    const { client, rpcs } = recordingClient()
    await runAssistantAction(client, {
      kind: 'shipment.create',
      markSent: true,
      input: {
        direction: 'outbound',
        counterparty: 'Leeds Partner Lab',
        carrier: 'DHL',
        trackingReference: '',
        expectedOn: '2026-11-09',
        notes: '',
        projectId: null,
        lines: [
          {
            key: '0',
            record_id: null,
            identifier: null,
            title: 'Plasma aliquots',
            quantity: '20',
            unit: 'tubes',
            note: '',
          },
        ],
      },
    })
    expect(rpcs.map((call) => call.name)).toEqual([
      'create_shipment',
      'mark_shipment_in_transit',
    ])
    expect(rpcs[1].args.p_shipment_id).toBe('ship-1')
  })

  it('receives a shipment with what arrived', async () => {
    const { client, rpcs } = recordingClient()
    await runAssistantAction(client, {
      kind: 'shipment.receive',
      shipmentId: 'ship-1',
      results: [{ item_id: 'i1', received: false, note: null }],
      conditionNote: 'Dry ice gone',
    })
    expect(rpcs[0]).toMatchObject({
      name: 'receive_shipment',
      args: { p_shipment_id: 'ship-1', p_condition_note: 'Dry ice gone' },
    })
  })

  it('repeats a booking through the schedule rpc', async () => {
    const { client, rpcs } = recordingClient()
    ;(client as unknown as { rpc: unknown }).rpc = (
      name: string,
      args: Record<string, unknown>,
    ) => {
      rpcs.push({ name, args })
      return Promise.resolve({
        schedule: {
          id: 's',
          kind: 'booking',
          title: 'x',
          status: 'active',
          frequency: 'weekly',
          interval_count: 1,
          weekdays: [1],
          offsets_days: null,
          starts_on: '2026-11-09',
          ends_on: null,
          max_occurrences: 8,
          timezone: 'Europe/London',
          resource_id: 'r',
          start_time: '09:00:00',
          end_time: '10:00:00',
          notebook_template_id: null,
          lead_days: 0,
          project_id: null,
          created_by_user_id: 'me',
          created_at: '2026-11-05T00:00:00Z',
        },
        result: { created: 8, skipped: 0, failed: 0, problems: [] },
      })
    }
    const result = await runAssistantAction(client, {
      kind: 'booking.repeat',
      input: {
        kind: 'booking',
        title: 'Plate reader',
        startsOn: '2026-11-09',
        timezone: 'Europe/London',
        frequency: 'weekly',
        weekdays: [1],
        maxOccurrences: 8,
        resourceId: 'r',
        startTime: '09:00',
        endTime: '10:00',
      },
    })
    expect(rpcs[0]).toMatchObject({
      name: 'create_recurring_schedule',
      args: { p_kind: 'booking', p_weekdays: [1], p_max_occurrences: 8 },
    })
    expect(result).toEqual({ openHref: '/schedule' })
  })
})
