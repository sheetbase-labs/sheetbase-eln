import { describe, expect, it } from 'vitest'

import { instantFromLocal } from './assistant-booking'
import { buildPlanningProposal, readInbox } from './assistant-planning.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const WS = '33333333-3333-4333-8333-333333333333'
const TZ = 'Europe/London'
const PLATE = '22222222-2222-4222-8222-222222222222'

const template = {
  id: 'tpl-1',
  identifier: 'PRT-0007',
  title: 'ELISA standard',
  kind: 'protocol_template',
  status: 'active',
  project_id: null,
  metadata_version: 1,
  archived_at: null,
  assignee_user_id: null,
}
const experiment = {
  id: 'exp-12',
  identifier: 'EXP-12',
  title: 'Standards curve',
  kind: 'experiment',
  status: 'in_progress',
  project_id: 'proj-1',
  metadata_version: 4,
  archived_at: null,
  assignee_user_id: null,
}

function fakeClient(
  data: {
    records?: Array<Record<string, unknown>>
    bookings?: Array<Record<string, unknown>>
    blocks?: Array<Record<string, unknown>>
    shipments?: Array<Record<string, unknown>>
    shipmentItems?: Array<Record<string, unknown>>
  } = {},
) {
  const client = {
    list: (resource: string, query = '') => {
      switch (resource) {
        case 'records': {
          const kind = /kind=in\.\(([^)]+)\)/.exec(query)?.[1]
          return Promise.resolve(
            (data.records ?? [template, experiment]).filter(
              (row) => !kind || row.kind === kind,
            ),
          )
        }
        case 'projects':
          return Promise.resolve([
            { id: 'proj-1', key: 'VAC', title: 'Vaccine' },
          ])
        case 'instruments':
          return Promise.resolve([
            {
              id: PLATE,
              display_id: 'INS-0002',
              name: 'Plate reader',
              location: 'Lab 1',
              instrument_type: 'other',
              retired_at: null,
              out_of_service_at: null,
            },
          ])
        case 'calendar_bookings':
          return Promise.resolve(data.bookings ?? [])
        case 'blocks':
          return Promise.resolve(data.blocks ?? [])
        case 'shipments':
          return Promise.resolve(data.shipments ?? [])
        case 'shipment_items':
          return Promise.resolve(data.shipmentItems ?? [])
        default:
          return Promise.resolve([])
      }
    },
    rpc: (name: string) => {
      if (name === 'workspace_members_list') {
        return Promise.resolve([
          { user_id: 'user-me', name: 'Gareth P' },
          { user_id: 'user-priya', name: 'Priya Shah' },
          { user_id: 'user-sam', name: 'Sam Lee' },
        ])
      }
      if (name === 'inbox_work_items_page') {
        return Promise.resolve({
          items: [
            {
              kind: 'review_requested',
              record_id: 'exp-12',
              identifier: 'EXP-12',
              title: 'Standards curve',
              project_id: 'proj-1',
              reason: 'Priya asked you to review',
              due_at: null,
              state: 'needs_action',
              created_at: '2026-11-05T09:00:00Z',
              revision_id: 'rev-1',
            },
          ],
          total: 1,
          offset: 0,
          tabs: {},
          types: {},
        })
      }
      return Promise.resolve([])
    },
  } as unknown as DataClient
  return client
}

function context(client: DataClient): LabToolContext {
  return {
    client,
    workspaceId: WS,
    userId: 'user-me',
    timeZone: TZ,
    now: new Date(instantFromLocal('2026-11-05T20:00', TZ)),
  }
}

describe('what is waiting on me', () => {
  it('lists the inbox with a link to each item', async () => {
    const result = await readInbox({}, context(fakeClient()))
    const parsed = JSON.parse(result.text) as {
      waitingOnPerson: number
      items: Array<{ open: string; title: string }>
    }
    expect(parsed.waitingOnPerson).toBe(1)
    expect(parsed.items[0]).toMatchObject({
      title: 'Standards curve',
      open: '/review/rev-1',
    })
  })
})

describe('experiment from a template', () => {
  it('names the template and project on the card', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.experiment.start',
      {
        title: 'New ELISA',
        summary: 'Start an ELISA from the standard template',
        template: 'ELISA standard',
        project: 'vaccine',
      },
      context(fakeClient()),
    )
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.proposal.action).toMatchObject({
        kind: 'experiment.start',
        templateRecordId: 'tpl-1',
        projectId: 'proj-1',
      })
      expect(built.proposal.changes.map((c) => c.after)).toContain('Vaccine')
    }
  })

  it('refuses a template that is not active', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.experiment.start',
      {
        title: 'New ELISA',
        summary: 's',
        template: 'ELISA',
        project: 'vaccine',
      },
      context(fakeClient({ records: [{ ...template, status: 'draft' }] })),
    )
    expect(built.ok).toBe(false)
  })
})

describe('handing work on and asking', () => {
  it('assigns by name with the version it read', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.record.assign',
      {
        title: 'Give to Priya',
        summary: 's',
        record: 'EXP-12',
        assignee: 'priya',
      },
      context(fakeClient()),
    )
    expect(built.ok && built.proposal.action).toMatchObject({
      kind: 'record.assign',
      recordId: 'exp-12',
      expectedMetadataVersion: 4,
      userId: 'user-priya',
    })
  })

  it('asks with an @ mention and the person’s id', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.record.ask',
      {
        title: 'Ask Sam',
        summary: 's',
        record: 'EXP-12',
        people: ['Sam'],
        message: 'Can you check the standards curve?',
      },
      context(fakeClient()),
    )
    expect(built.ok && built.proposal.action).toMatchObject({
      kind: 'record.comment',
      body: '@Sam Lee Can you check the standards curve?',
      mentions: ['user-sam'],
    })
  })

  it('does not let the person mention themselves', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.record.ask',
      {
        title: 't',
        summary: 's',
        record: 'EXP-12',
        people: ['Gareth'],
        message: 'hi',
      },
      context(fakeClient()),
    )
    expect(built.ok).toBe(false)
  })
})

describe('repeating a booking', () => {
  const args = {
    title: 'Plate reader Mondays',
    summary: 's',
    instrument: 'plate reader',
    firstDay: '2026-11-09',
    startTime: '09:00',
    endTime: '10:00',
    frequency: 'weekly',
    weekdays: [1],
    count: 8,
  }

  it('lists the dates and flags the ones already taken', async () => {
    const taken = {
      id: 'b1',
      title: 'Someone’s run',
      status: 'tentative',
      starts_at: instantFromLocal('2026-11-16T09:00', TZ).toISOString(),
      ends_at: instantFromLocal('2026-11-16T10:00', TZ).toISOString(),
    }
    const built = await buildPlanningProposal(
      'sheetbase.booking.repeat',
      args,
      context(fakeClient({ bookings: [taken] })),
    )
    expect(built.ok).toBe(true)
    if (built.ok) {
      const labels = built.proposal.changes.map((c) => c.label)
      expect(labels).toContain('Dates (8)')
      expect(labels).toContain('Already booked')
      expect(built.proposal.action).toMatchObject({
        kind: 'booking.repeat',
        input: {
          kind: 'booking',
          resourceId: PLATE,
          weekdays: [1],
          maxOccurrences: 8,
          startTime: '09:00',
          endTime: '10:00',
        },
      })
    }
  })

  it('refuses a first day that has passed', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.booking.repeat',
      { ...args, firstDay: '2026-11-02' },
      context(fakeClient()),
    )
    expect(built.ok).toBe(false)
  })
})

describe('step timer', () => {
  it('finds the step by its words and uses its own length', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.timer.start',
      {
        title: 'Time the incubation',
        summary: 's',
        record: 'EXP-12',
        step: 'incubate',
      },
      context(
        fakeClient({
          blocks: [
            {
              id: 'b1',
              payload: { text: 'Coat the plate', durationSeconds: 300 },
            },
            {
              id: 'b2',
              payload: { text: 'Incubate at 37 C', durationSeconds: 1800 },
            },
          ],
        }),
      ),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'timer.start',
      blockId: 'b2',
      seconds: null,
    })
  })

  it('asks which step when several are timed', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.timer.start',
      { title: 't', summary: 's', record: 'EXP-12' },
      context(
        fakeClient({
          blocks: [
            { id: 'b1', payload: { text: 'Coat', durationSeconds: 300 } },
            { id: 'b2', payload: { text: 'Incubate', durationSeconds: 1800 } },
          ],
        }),
      ),
    )
    expect(built.ok).toBe(false)
  })

  it('uses the minutes given', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.timer.start',
      {
        title: 't',
        summary: 's',
        record: 'EXP-12',
        step: 'incubate',
        minutes: 30,
      },
      context(
        fakeClient({ blocks: [{ id: 'b2', payload: { text: 'Incubate' } }] }),
      ),
    )
    expect(built.ok && built.proposal.action).toMatchObject({ seconds: 1800 })
  })
})

describe('shipments', () => {
  it('builds an outbound shipment from named items', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.shipment.send',
      {
        title: 'Send to Leeds',
        summary: 's',
        counterparty: 'Leeds Partner Lab',
        carrier: 'DHL',
        items: [{ title: 'Plasma aliquots', quantity: 20, unit: 'tubes' }],
      },
      context(fakeClient()),
    )
    expect(built.ok && built.proposal.action).toMatchObject({
      kind: 'shipment.create',
      markSent: true,
      input: {
        direction: 'outbound',
        counterparty: 'Leeds Partner Lab',
        lines: [{ title: 'Plasma aliquots', quantity: '20', unit: 'tubes' }],
      },
    })
  })

  it('receives by number and marks the missing item', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.shipment.receive',
      {
        title: 'Receive',
        summary: 's',
        shipment: 'SHP-0012',
        missing: ['spare'],
      },
      context(
        fakeClient({
          shipments: [
            {
              id: 'ship-12',
              number: 12,
              direction: 'inbound',
              status: 'in_transit',
              counterparty: 'Leeds',
            },
          ],
          shipmentItems: [
            { id: 'i1', title: 'Plasma', identifier: null },
            { id: 'i2', title: 'Spare tubes', identifier: null },
          ],
        }),
      ),
    )
    expect(built.ok && built.proposal.action).toMatchObject({
      kind: 'shipment.receive',
      shipmentId: 'ship-12',
      results: [
        { item_id: 'i1', received: true },
        { item_id: 'i2', received: false },
      ],
    })
  })

  it('will not receive a shipment that is not on its way', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.shipment.receive',
      { title: 'Receive', summary: 's', shipment: '12' },
      context(
        fakeClient({
          shipments: [
            {
              id: 'ship-12',
              number: 12,
              direction: 'inbound',
              status: 'received',
              counterparty: 'Leeds',
            },
          ],
        }),
      ),
    )
    expect(built.ok).toBe(false)
  })
})
