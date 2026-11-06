import { describe, expect, it } from 'vitest'

import { runUpkeepAction } from './assistant-upkeep-run'
import { buildUpkeepProposal } from './assistant-upkeep.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const WS = '33333333-3333-4333-8333-333333333333'
const base = { title: 'T', summary: 'S' }

type Rows = Partial<
  Record<string, Array<Record<string, unknown>> | ((q: string) => unknown[])>
>

function context(rows: Rows): { ctx: LabToolContext; calls: string[] } {
  const calls: string[] = []
  const client = {
    list: (resource: string, query = '') => {
      calls.push(`${resource}${query}`)
      const source = rows[resource]
      return Promise.resolve(
        typeof source === 'function' ? source(query) : (source ?? []),
      )
    },
  } as unknown as DataClient
  return {
    ctx: { client, workspaceId: WS, userId: 'me', timeZone: 'Europe/London' },
    calls,
  }
}

const s142 = {
  id: 's1',
  identifier: 'S-0142',
  title: 'Plasma 142',
  status: 'available',
  metadata_version: 4,
  properties: { quantity: 200, quantityUnit: 'µl' },
}

describe('project and follow cards', () => {
  it('proposes a new project and refuses a name already taken', async () => {
    const fresh = context({ projects: [] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.project.create',
        { ...base, projectName: 'Vaccine B' },
        fresh.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'project.create', title: 'Vaccine B' } },
    })
    const taken = context({ projects: [{ id: 'p1', title: 'vaccine b' }] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.project.create',
        { ...base, projectName: 'Vaccine B' },
        taken.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('follows a record, and says when it is already followed', async () => {
    const rec = { id: 'r1', identifier: 'EXP-12', title: 'ELISA plate 4' }
    const open = context({ records: [rec], work_item_follows: [] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.follow',
        { ...base, target: 'record', name: 'EXP-12' },
        open.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'follow.set',
          target: 'record',
          id: 'r1',
          following: true,
        },
      },
    })
    const followed = context({
      records: [rec],
      work_item_follows: [{ record_id: 'r1' }],
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.follow',
        { ...base, target: 'record', name: 'EXP-12' },
        followed.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('only offers to mark read when something is unread', async () => {
    const none = context({ my_notifications: [] })
    expect(
      await buildUpkeepProposal('sheetbase.inbox.mark_read', base, none.ctx),
    ).toMatchObject({ ok: false })
    const some = context({ my_notifications: [{ id: 'n1' }, { id: 'n2' }] })
    expect(
      await buildUpkeepProposal('sheetbase.inbox.mark_read', base, some.ctx),
    ).toMatchObject({
      ok: true,
      proposal: { changes: [{ before: '2', after: '0' }] },
    })
  })
})

describe('orders and shipments', () => {
  const order = {
    id: 'o1',
    number: 7,
    material_title: 'Tris base',
    status: 'requested',
    quantity: '2',
    unit: 'bottles',
    supplier: null,
  }

  it('marks an order placed, and cancels one', async () => {
    const { ctx } = context({ reagent_orders: [order] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.reagent.update',
        {
          ...base,
          order: 'RO-7',
          change: 'ordered',
          supplier: 'Sigma',
          expectedOn: '2026-11-12',
        },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        target: 'RO-0007',
        action: {
          kind: 'reagent.ordered',
          orderId: 'o1',
          supplier: 'Sigma',
          expectedOn: '2026-11-12',
        },
      },
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.reagent.update',
        { ...base, order: 'Tris', change: 'cancelled', reason: 'Found some' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'reagent.cancel', reason: 'Found some' } },
    })
  })

  it('cancels only a shipment that has not arrived', async () => {
    const received = context({
      shipments: [
        {
          id: 'h1',
          number: 3,
          direction: 'outbound',
          status: 'received',
          counterparty: 'Leeds',
        },
      ],
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.shipment.cancel',
        { ...base, shipment: 'SHP-3' },
        received.ctx,
      ),
    ).toMatchObject({ ok: false })
    const moving = context({
      shipments: [
        {
          id: 'h1',
          number: 3,
          direction: 'outbound',
          status: 'in_transit',
          counterparty: 'Leeds',
        },
      ],
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.shipment.cancel',
        { ...base, shipment: 'SHP-3', reason: 'Wrong address' },
        moving.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        target: 'SHP-0003',
        action: {
          kind: 'shipment.cancel',
          shipmentId: 'h1',
          reason: 'Wrong address',
        },
      },
    })
  })
})

describe('sample cards', () => {
  const exp = { id: 'e1', identifier: 'EXP-12', title: 'ELISA plate 4' }

  it('reserves some of a sample for an experiment, within what is left', async () => {
    const { ctx } = context({
      records: (q) => (q.includes('kind=eq.sample') ? [s142] : [exp]),
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.reserve',
        { ...base, sample: 'S-0142', experiment: 'EXP-12', quantity: 50 },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'sample.reserve',
          recordId: 's1',
          experimentId: 'e1',
          quantity: 50,
          unit: 'µl',
        },
      },
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.reserve',
        { ...base, sample: 'S-0142', experiment: 'EXP-12', quantity: 500 },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('quarantines an available sample and refuses one already quarantined', async () => {
    const ok = context({ records: [s142] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.quarantine',
        { ...base, sample: 'S-0142', reason: 'Tube cracked' },
        ok.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'sample.quarantine',
          expectedMetadataVersion: 4,
          reason: 'Tube cracked',
        },
      },
    })
    const done = context({ records: [{ ...s142, status: 'quarantined' }] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.quarantine',
        { ...base, sample: 'S-0142', reason: 'x' },
        done.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('refuses to dispose of a sample already disposed of, and needs a reason', async () => {
    const gone = context({ records: [{ ...s142, status: 'disposed' }] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.dispose',
        { ...base, sample: 'S-0142', reason: 'Expired' },
        gone.ctx,
      ),
    ).toMatchObject({ ok: false })
    const ok = context({ records: [s142] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.dispose',
        { ...base, sample: 'S-0142' },
        ok.ctx,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.dispose',
        { ...base, sample: 'S-0142', reason: 'Expired' },
        ok.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'sample.dispose' } },
    })
  })
})

describe('instrument visit card', () => {
  it('logs a visit on the named instrument', async () => {
    const { ctx } = context({
      instruments: [
        {
          id: 'i1',
          name: 'Plate reader',
          display_id: 'INS-0003',
          out_of_service_at: null,
        },
      ],
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.instrument.log_service',
        {
          ...base,
          instrument: 'Plate reader',
          kind: 'service',
          visitedOn: '2026-11-04',
          summaryOfWork: 'Annual service',
          performedBy: 'BMG engineer',
        },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'instrument.log',
          instrumentId: 'i1',
          serviceKind: 'service',
          performedBy: 'BMG engineer',
        },
      },
    })
  })
})

describe('running upkeep actions', () => {
  it('calls the ordinary RPCs, as the person', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push([name, args])
        return Promise.resolve({ id: 'x' })
      },
    } as unknown as DataClient
    const project = await runUpkeepAction(client, {
      kind: 'project.create',
      title: 'Vaccine B',
      startedOn: null,
    })
    await runUpkeepAction(client, { kind: 'notifications.read' })
    await runUpkeepAction(client, {
      kind: 'follow.set',
      target: 'project',
      id: 'p1',
      following: true,
    })
    await runUpkeepAction(client, {
      kind: 'shipment.cancel',
      shipmentId: 'h1',
      reason: 'Wrong address',
    })
    await runUpkeepAction(client, {
      kind: 'sample.quarantine',
      recordId: 's1',
      expectedMetadataVersion: 4,
      reason: 'Tube cracked',
      notes: null,
    })
    expect(project).toEqual({ openHref: '/projects/x' })
    expect(calls.map(([name]) => name)).toEqual([
      'create_project',
      'mark_notifications_read',
      'follow_project',
      'cancel_shipment',
      'quarantine_sample',
    ])
    expect(calls[4][1]).toMatchObject({
      p_record_id: 's1',
      p_expected_metadata_version: 4,
      p_reason: 'Tube cracked',
    })
  })
})

describe('people and continuity cards', () => {
  function withPeople(rows: Rows, rpc: Record<string, unknown> = {}) {
    const made = context(rows)
    const client = made.ctx.client as unknown as Record<string, unknown>
    client.rpc = (name: string) =>
      Promise.resolve(
        name === 'workspace_members_list'
          ? [
              { user_id: 'me', name: 'Gareth P.' },
              { user_id: 'u2', name: 'Priya S.' },
              { user_id: 'u3', name: 'Tom H.' },
            ]
          : (rpc[name] ?? []),
      )
    return made
  }

  it('sets out of office with a named cover, and refuses past dates', async () => {
    const { ctx } = withPeople({})
    const ok = await buildUpkeepProposal(
      'sheetbase.absence.set',
      { ...base, from: '2999-01-01', until: '2999-01-05', cover: 'Priya' },
      ctx,
    )
    expect(ok).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'absence.set',
          startsOn: '2999-01-01',
          endsOn: '2999-01-05',
          delegateUserId: 'u2',
        },
      },
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.absence.set',
        { ...base, from: '2000-01-01', until: '2000-01-05' },
        ctx,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await buildUpkeepProposal(
        'sheetbase.absence.set',
        { ...base, until: '2999-01-05', cover: 'Gareth' },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('cancels only an absence that exists', async () => {
    const none = withPeople({ member_absences: [] })
    expect(
      await buildUpkeepProposal('sheetbase.absence.cancel', base, none.ctx),
    ).toMatchObject({ ok: false })
    const some = withPeople({
      member_absences: [
        { id: 'a1', starts_on: '2999-01-01', ends_on: '2999-01-05' },
      ],
    })
    expect(
      await buildUpkeepProposal('sheetbase.absence.cancel', base, some.ctx),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'absence.cancel', absenceId: 'a1' } },
    })
  })

  it('hands over what is open, and says when nothing is', async () => {
    const open = withPeople(
      {},
      {
        preview_member_handover: [
          { category: 'task', record_kind: null, n: 3 },
        ],
      },
    )
    expect(
      await buildUpkeepProposal(
        'sheetbase.handover.start',
        { ...base, to: 'Tom' },
        open.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'handover.run',
          fromUserId: 'me',
          toUserId: 'u3',
          selection: ['task'],
        },
      },
    })
    const empty = withPeople({}, { preview_member_handover: [] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.handover.start',
        { ...base, to: 'Tom' },
        empty.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('maps and unmaps a sign-in group', async () => {
    const { ctx } = withPeople({
      idp_group_mappings: [
        { id: 'g1', group_name: 'lab-admins', role: 'admin' },
      ],
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.group_role.set',
        { ...base, group: 'lab-scientists', role: 'scientist' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'group_role.set', role: 'scientist' } },
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.group_role.remove',
        { ...base, group: 'lab-admins' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'group_role.remove', mappingId: 'g1' } },
    })
  })

  it('switches off a directory sync token by its label', async () => {
    const { ctx } = withPeople({
      scim_tokens: [
        { id: 't1', label: 'Okta', last_used_at: '2026-11-01T10:00:00Z' },
      ],
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.scim_token.revoke',
        { ...base, token: 'Okta' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'scim_token.revoke', tokenId: 't1' } },
    })
  })

  it('runs the cards through the ordinary RPCs', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push([name, args])
        return Promise.resolve({})
      },
    } as unknown as DataClient
    await runUpkeepAction(client, {
      kind: 'absence.set',
      workspaceId: WS,
      startsOn: '2999-01-01',
      endsOn: '2999-01-05',
      delegateUserId: 'u2',
      note: null,
    })
    await runUpkeepAction(client, {
      kind: 'handover.run',
      workspaceId: WS,
      fromUserId: 'me',
      toUserId: 'u3',
      selection: ['task'],
    })
    await runUpkeepAction(client, {
      kind: 'group_role.set',
      workspaceId: WS,
      groupName: 'lab-admins',
      role: 'admin',
    })
    expect(calls.map(([name]) => name)).toEqual([
      'set_member_absence',
      'hand_over_member_work',
      'set_idp_group_mapping',
    ])
  })
})
