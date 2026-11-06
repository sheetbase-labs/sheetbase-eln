import { describe, expect, it } from 'vitest'

import { instantFromLocal } from './assistant-booking'
import {
  buildPlanningProposal,
  readInbox,
  readSeries,
  readParts,
  readSteps,
} from './assistant-planning.server'
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
    steps?: Array<Record<string, unknown>>
    membership?: Record<string, Record<string, unknown>>
    seriesMembers?: Array<Record<string, unknown>>
    parts?: Array<Record<string, unknown>>
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
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (name === 'record_steps') return Promise.resolve(data.steps ?? [])
      if (name === 'record_series') {
        const row = data.membership?.[String(args?.p_record_id)]
        return Promise.resolve(row ? [row] : [])
      }
      if (name === 'series_members')
        return Promise.resolve(data.seriesMembers ?? [])
      if (name === 'series_rollup') {
        return Promise.resolve({ total: 2, approved: 1, samples: 3 })
      }
      if (name === 'record_parts') return Promise.resolve(data.parts ?? [])
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

const step = (
  n: number,
  text: string,
  extra: Record<string, unknown> = {},
) => ({
  block_id: `step-${n}`,
  step_number: n,
  step_text: text,
  status: 'not_started',
  is_current: false,
  completed_at: null,
  completed_by_user_id: null,
  note: null,
  result_count: 0,
  ...extra,
})

const steps = [
  step(1, 'Coat the plate', {
    status: 'done',
    completed_by_user_id: 'user-priya',
    completed_at: '2026-11-06T09:00:00Z',
  }),
  step(2, 'Block with BSA', { status: 'in_progress', is_current: true }),
  step(3, 'Read the plate at 450 nm'),
]

function part(
  number: number,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return {
    part_id: `part-${number}`,
    part_number: number,
    title,
    day_offset: number - 1,
    due_on: `2026-11-0${number}`,
    assignee_user_id: null,
    status: 'later',
    is_current: false,
    opened_at: null,
    completed_at: null,
    completed_by_user_id: null,
    step_count: 0,
    steps_done: 0,
    block_count: 0,
    result_count: 0,
    ...extra,
  }
}

const parts = [
  part(1, 'Seed cells', {
    status: 'done',
    completed_by_user_id: 'user-priya',
    step_count: 2,
    steps_done: 2,
  }),
  part(2, 'Dose with compound', { status: 'now', is_current: true }),
  part(3, 'Read the plate'),
]

describe('parts', () => {
  it('reads the parts with their day, status and who finished them', async () => {
    const read = await readParts(
      { record: 'EXP-12' },
      context(fakeClient({ parts })),
    )
    const body = JSON.parse(read.text)
    expect(read.isError).toBe(false)
    expect(body.partsDone).toBe(1)
    expect(body.parts[0].doneBy).toBe('Priya Shah')
    expect(body.parts[1]).toMatchObject({ day: 1, current: true })
  })

  it('adds a part on a day', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.part.add',
      {
        title: 'Add a wash',
        summary: 's',
        record: 'EXP-12',
        part: 'Wash',
        day: 4,
      },
      context(fakeClient({ parts })),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'part.add',
      recordId: 'exp-12',
      title: 'Wash',
      dayOffset: 4,
    })
  })

  it('changes the current part when none is named, and finds one by number', async () => {
    const current = await buildPlanningProposal(
      'sheetbase.part.update',
      { title: 'Move', summary: 's', record: 'EXP-12', day: 5 },
      context(fakeClient({ parts })),
    )
    expect(current.ok && current.proposal.action).toMatchObject({
      kind: 'part.update',
      partId: 'part-2',
      dayOffset: 5,
    })
    const byNumber = await buildPlanningProposal(
      'sheetbase.part.update',
      {
        title: 'Hand over',
        summary: 's',
        record: 'EXP-12',
        part: 'part 3',
        assignee: 'Sam',
      },
      context(fakeClient({ parts })),
    )
    expect(byNumber.ok && byNumber.proposal.action).toMatchObject({
      partId: 'part-3',
      assigneeUserId: 'user-sam',
      clearAssignee: false,
    })
  })

  it('marks a part with no steps done, and refuses one with steps', async () => {
    const ok = await buildPlanningProposal(
      'sheetbase.part.complete',
      { title: 'Done', summary: 's', record: 'EXP-12' },
      context(fakeClient({ parts })),
    )
    expect(ok.ok && ok.proposal.action).toEqual({
      kind: 'part.done',
      partId: 'part-2',
      done: true,
    })
    const refused = await buildPlanningProposal(
      'sheetbase.part.complete',
      { title: 'Done', summary: 's', record: 'EXP-12', part: 'seed' },
      context(fakeClient({ parts })),
    )
    expect(refused.ok).toBe(false)
  })
})

describe('steps', () => {
  it('reads the steps with their status and who finished them', async () => {
    const read = await readSteps(
      { record: 'EXP-12' },
      context(fakeClient({ steps })),
    )
    const body = JSON.parse(read.text)
    expect(read.isError).toBe(false)
    expect(body.stepsDone).toBe(1)
    expect(body.steps.map((row: { status: string }) => row.status)).toEqual([
      'done',
      'in_progress',
      'not_started',
    ])
    expect(body.steps[0].finishedBy).toBe('Priya Shah')
    expect(body.steps[1].current).toBe(true)
  })

  it('finishes the current step when none is named', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.step.complete',
      { title: 'Finish blocking', summary: 's', record: 'EXP-12' },
      context(fakeClient({ steps })),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'step.done',
      blockId: 'step-2',
      done: true,
      note: null,
    })
  })

  it('finds a step by its words, and can reopen it with a note', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.step.complete',
      {
        title: 'Reopen coating',
        summary: 's',
        record: 'EXP-12',
        step: 'coat',
        done: false,
        note: 'Wrong plate',
      },
      context(fakeClient({ steps })),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'step.done',
      blockId: 'step-1',
      done: false,
      note: 'Wrong plate',
    })
  })

  it('records a result against the current step', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.step.result',
      {
        title: 'Log OD',
        summary: 's',
        record: 'EXP-12',
        label: 'OD450',
        value: 0.82,
        unit: 'AU',
      },
      context(fakeClient({ steps })),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'step.result',
      blockId: 'step-2',
      label: 'OD450',
      value: '0.82',
      unit: 'AU',
    })
  })

  it('says so when every step is done, when nothing matches and when it is ambiguous', async () => {
    const allDone = steps.map((row) => ({
      ...row,
      status: 'done',
      is_current: false,
    }))
    const finished = await buildPlanningProposal(
      'sheetbase.step.complete',
      { title: 't', summary: 's', record: 'EXP-12' },
      context(fakeClient({ steps: allDone })),
    )
    expect(!finished.ok && finished.message).toContain('already done')
    const none = await buildPlanningProposal(
      'sheetbase.step.complete',
      { title: 't', summary: 's', record: 'EXP-12', step: 'centrifuge' },
      context(fakeClient({ steps })),
    )
    expect(!none.ok && none.message).toContain('No step')
    const several = await buildPlanningProposal(
      'sheetbase.step.complete',
      { title: 't', summary: 's', record: 'EXP-12', step: 'plate' },
      context(fakeClient({ steps })),
    )
    expect(!several.ok && several.message).toContain('More than one')
    const empty = await buildPlanningProposal(
      'sheetbase.step.complete',
      { title: 't', summary: 's', record: 'EXP-12' },
      context(fakeClient({ steps: [] })),
    )
    expect(!empty.ok && empty.message).toContain('no protocol steps')
  })
})

describe('a series of experiments', () => {
  const head = {
    ...experiment,
    id: 'exp-0142',
    identifier: 'EXP-0142',
    title: 'Cell viability assay',
  }
  const run = {
    ...experiment,
    id: 'exp-0145',
    identifier: 'EXP-0145',
    title: 'Dose',
  }
  const membership = {
    series_record_id: 'exp-0142',
    series_identifier: 'EXP-0142',
    series_title: 'Cell viability assay',
    member_number: 3,
    member_total: 5,
  }
  const seriesMembers = [
    {
      member_record_id: 'exp-0143',
      member_number: 1,
      identifier: 'EXP-0143',
      title: 'Seed cells',
      status: 'approved',
      owner_user_id: 'user-me',
      reviewer_user_id: null,
      planned_on: '2026-11-02',
      day_offset: 0,
      steps_total: 3,
      steps_done: 3,
      sample_count: 12,
    },
  ]

  it('reads where an experiment sits and the members in order', async () => {
    const read = await readSeries(
      { record: 'EXP-0145' },
      context(
        fakeClient({
          records: [head, run],
          membership: { 'exp-0145': membership },
          seriesMembers,
        }),
      ),
    )
    expect(read.isError).toBe(false)
    const body = JSON.parse(read.text)
    expect(body).toMatchObject({
      series: 'EXP-0142 · Cell viability assay',
      position: '3 of 5',
      open: '/experiments/exp-0142/series',
    })
    expect(body.members[0]).toMatchObject({
      number: 1,
      status: 'approved',
      owner: 'Gareth P',
      stepsDone: 3,
    })
  })

  it('says so when an experiment is in no series', async () => {
    const read = await readSeries({ record: 'EXP-12' }, context(fakeClient()))
    expect(read.isError).toBe(false)
    expect(read.text).toContain('not in a series')
  })

  it('proposes adding an experiment, and refuses one already in a series', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.series.add_member',
      {
        title: 'Add Dose to the assay',
        summary: 's',
        series: 'EXP-0142',
        experiment: 'EXP-0145',
        plannedOn: '2026-11-05',
      },
      context(fakeClient({ records: [head, run] })),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'series.add',
      seriesRecordId: 'exp-0142',
      memberRecordId: 'exp-0145',
      plannedOn: '2026-11-05',
    })
    const taken = await buildPlanningProposal(
      'sheetbase.series.add_member',
      { title: 't', summary: 's', series: 'EXP-0142', experiment: 'EXP-0145' },
      context(
        fakeClient({
          records: [head, run],
          membership: { 'exp-0145': membership },
        }),
      ),
    )
    expect(!taken.ok && taken.message).toContain('already in EXP-0142')
  })

  it('proposes taking an experiment out, and says when it is in none', async () => {
    const built = await buildPlanningProposal(
      'sheetbase.series.remove_member',
      { title: 'Take Dose out', summary: 's', experiment: 'EXP-0145' },
      context(
        fakeClient({
          records: [head, run],
          membership: { 'exp-0145': membership },
        }),
      ),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'series.remove',
      memberRecordId: 'exp-0145',
    })
    const none = await buildPlanningProposal(
      'sheetbase.series.remove_member',
      { title: 't', summary: 's', experiment: 'EXP-0145' },
      context(fakeClient({ records: [head, run] })),
    )
    expect(!none.ok && none.message).toContain('not in a series')
  })
})
