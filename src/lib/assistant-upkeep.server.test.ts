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
