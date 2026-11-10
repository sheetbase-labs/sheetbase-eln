import { describe, expect, it } from 'vitest'

import { runBenchAction } from './assistant-bench-run'
import { buildBenchProposal } from './assistant-bench.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import { createDataClient } from './data-client'

const WS = '33333333-3333-4333-8333-333333333333'
const P1 = '11111111-1111-4111-8111-111111111111'

function context(routes: Partial<Record<string, (url: URL) => Response>>) {
  const calls: string[] = []

  const client = createDataClient((input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    const resource = url.pathname.replace('/api/db/', '')
    calls.push(`${resource}${url.search}`)

    return Promise.resolve(routes[resource]?.(url) ?? Response.json([]))
  })

  return {
    ctx: {
      client,
      workspaceId: WS,
      userId: 'me',
      timeZone: 'Europe/London',
    } satisfies LabToolContext,
    calls,
  }
}

function rpcTransport() {
  const calls: Array<[string, unknown]> = []

  const client = createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://localhost'),
      init,
    )

    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    const body: unknown = await request.json()
    calls.push([
      new URL(request.url).pathname.replace('/api/db/rpc/', ''),
      body,
    ])

    return Response.json({ id: 'x', stored: 1 })
  })

  return { client, calls }
}

const tris = {
  id: 'm1',
  identifier: 'MAT-0007',
  title: 'Tris base',
  metadata_version: 1,
  properties: { quantityUnit: 'bottles' },
}

const s142 = {
  id: 's1',
  identifier: 'S-0142',
  title: 'Plasma 142',
  metadata_version: 4,
  properties: { quantity: 200, quantityUnit: 'µl', storageLocation: 'Bench' },
}

const exp12 = { id: 'e1', identifier: 'EXP-12', title: 'ELISA plate 4' }
const base = { title: 'T', summary: 'S' }

describe('reagent bench cards', () => {
  it('proposes a reorder with the material’s own unit', async () => {
    const { ctx } = context({
      records: () => Response.json([tris]),
      reagent_orders: () => Response.json([]),
    })

    const out = await buildBenchProposal(
      'sheetbase.reagent.order',
      { ...base, material: 'Tris', quantity: 2 },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'reagent.order',
          materialRecordId: 'm1',
          quantity: 2,
          unit: 'bottles',
        },
      },
    })
  })

  it('says so when a reorder is already open', async () => {
    const { ctx } = context({
      records: () => Response.json([tris]),
      reagent_orders: () => Response.json([{ number: 7, status: 'ordered' }]),
    })

    const out = await buildBenchProposal(
      'sheetbase.reagent.order',
      { ...base, material: 'Tris', quantity: 2 },
      ctx,
    )

    expect(out).toMatchObject({ ok: false })
    expect(JSON.stringify(out)).toContain('RO-0007')
  })

  it('marks an order received by its number', async () => {
    const { ctx, calls } = context({
      reagent_orders: () =>
        Response.json([
          {
            id: 'o1',
            number: 7,
            material_title: 'Tris base',
            quantity: '2',
            unit: 'bottles',
            status: 'ordered',
          },
        ]),
    })

    const out = await buildBenchProposal(
      'sheetbase.reagent.receive',
      { ...base, order: 'RO-0007', lot: 'L9', expiry: '2027-01-31' },
      ctx,
    )

    expect(calls[0]).toContain('number=eq.7')
    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'reagent.receive', orderId: 'o1', lot: 'L9' },
      },
    })
  })
})

describe('sample bench cards', () => {
  it('logs samples into the next free positions of a box', async () => {
    const { ctx } = context({
      projects: () => Response.json([{ id: P1, title: 'Vaccine' }]),
      storage_sites: () =>
        Response.json([{ id: 'site1', name: 'Lab', archived_at: null }]),
      storage_rooms: () =>
        Response.json([
          {
            id: 'room1',
            site_id: 'site1',
            name: 'Cold room',
            archived_at: null,
          },
        ]),
      storage_units: () =>
        Response.json([
          {
            id: 'unit1',
            room_id: 'room1',
            name: '-80',
            unit_type: 'freezer',
            archived_at: null,
          },
        ]),
      storage_shelves: () =>
        Response.json([
          {
            id: 'shelf1',
            unit_id: 'unit1',
            name: 'Shelf 1',
            position: 1,
            archived_at: null,
          },
        ]),
      storage_racks: () =>
        Response.json([
          {
            id: 'rack1',
            shelf_id: 'shelf1',
            name: 'Rack 1',
            position: 1,
            archived_at: null,
          },
        ]),
      storage_boxes: () =>
        Response.json([
          {
            id: 'b1',
            rack_id: 'rack1',
            name: 'F2',
            code: null,
            rows: 2,
            cols: 2,
            archived_at: null,
          },
        ]),
      storage_positions: (url) => {
        if (!url.searchParams.has('box_id')) {
          expect(url.searchParams.get('occupied_record_id')).toBe('not.is.null')

          return Response.json([{ box_id: 'b1' }])
        }

        expect(url.searchParams.get('box_id')).toBe('eq.b1')

        return Response.json([
          {
            id: 'p1',
            box_id: 'b1',
            row_index: 0,
            col_index: 0,
            label: 'A1',
            status: 'occupied',
            occupied_record_id: 's1',
          },
          {
            id: 'p2',
            box_id: 'b1',
            row_index: 0,
            col_index: 1,
            label: 'A2',
            status: 'available',
            occupied_record_id: null,
          },
          {
            id: 'p3',
            box_id: 'b1',
            row_index: 1,
            col_index: 0,
            label: 'B1',
            status: 'available',
            occupied_record_id: null,
          },
        ])
      },
      records: (url) => {
        expect(url.searchParams.get('id')).toBe('in.(s1)')

        return Response.json([s142])
      },
    })

    const out = await buildBenchProposal(
      'sheetbase.sample.log',
      {
        ...base,
        samples: [{ name: 'Plasma 1' }, { name: 'Plasma 2' }],
        box: 'F2',
      },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'samples.log',
          projectId: P1,
          positionIds: ['p2', 'p3'],
        },
      },
    })
  })

  it('refuses to use more than is left', async () => {
    const { ctx } = context({ records: () => Response.json([s142]) })

    const out = await buildBenchProposal(
      'sheetbase.sample.use',
      { ...base, sample: 'S-0142', quantity: 500 },
      ctx,
    )

    expect(out).toMatchObject({ ok: false })
    expect(JSON.stringify(out)).toContain('200 µl')
  })

  it('shows the amount left after use', async () => {
    const { ctx } = context({ records: () => Response.json([s142]) })

    const out = await buildBenchProposal(
      'sheetbase.sample.use',
      { ...base, sample: 'S-0142', quantity: 50 },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        changes: [{ label: 'Amount left', before: '200 µl', after: '150 µl' }],
        action: { kind: 'sample.use', expectedMetadataVersion: 4 },
      },
    })
  })

  it('splits into tubes for an experiment', async () => {
    const { ctx } = context({
      records: (url) =>
        Response.json(
          url.searchParams.get('kind') === 'eq.experiment' ? [exp12] : [s142],
        ),
    })

    const out = await buildBenchProposal(
      'sheetbase.sample.split',
      {
        ...base,
        sample: 'S-0142',
        count: 4,
        quantityEach: 25,
        experiment: 'EXP-12',
      },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'sample.split',
          count: 4,
          purposeExperimentId: 'e1',
          unit: 'µl',
        },
      },
    })
  })

  it('moves a sample to a place typed in words', async () => {
    const { ctx } = context({ records: () => Response.json([s142]) })

    const out = await buildBenchProposal(
      'sheetbase.sample.move',
      { ...base, samples: ['S-0142'], place: '-80 freezer, shelf 2' },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        changes: [{ before: 'Bench', after: '-80 freezer, shelf 2' }],
        action: {
          moves: [{ recordId: 's1', toLocation: '-80 freezer, shelf 2' }],
        },
      },
    })
  })

  it('moves a sample on only to a stage it can reach', async () => {
    const { ctx } = context({
      records: () => Response.json([s142]),
      sample_workflow_runs: () =>
        Response.json([
          {
            id: 'r1',
            workflow_id: 'w1',
            stage_id: 'st1',
            entered_at: '2026-11-01T00:00:00Z',
            due_at: null,
            completed_at: null,
            workflow: { name: 'Plasma intake' },
            stage: { name: 'QC' },
          },
        ]),
      sample_workflow_transitions: () =>
        Response.json([
          {
            from_stage_id: 'st1',
            to: { id: 'st2', name: 'Storage', required_fields: [] },
          },
        ]),
    })

    const ok = await buildBenchProposal(
      'sheetbase.sample.advance',
      { ...base, sample: 'S-0142' },
      ctx,
    )

    expect(ok).toMatchObject({
      ok: true,
      proposal: {
        changes: [{ label: 'Plasma intake', before: 'QC', after: 'Storage' }],
        action: { kind: 'sample.advance', runId: 'r1', toStageId: 'st2' },
      },
    })

    const bad = await buildBenchProposal(
      'sheetbase.sample.advance',
      { ...base, sample: 'S-0142', toStage: 'Archive' },
      ctx,
    )

    expect(bad).toMatchObject({ ok: false })
  })
})

describe('forms from chat', () => {
  const fields = [
    {
      id: 'f1',
      kind: 'near_miss',
      field_name: 'severity',
      label: 'Severity',
      display_order: 1,
      logical_type: 'category',
      nullable: false,
      default_value: null,
      unit: null,
      validation: {},
      lifecycle: 'active',
    },
    {
      id: 'f2',
      kind: 'near_miss',
      field_name: 'what_happened',
      label: 'What happened',
      display_order: 2,
      logical_type: 'text',
      nullable: false,
      default_value: null,
      unit: null,
      validation: {},
      lifecycle: 'active',
    },
  ]

  const rows = {
    model_incident_logs: () => Response.json([{ model_key: 'near_miss' }]),
    record_models: (url: URL) =>
      Response.json(
        url.searchParams.get('select') === 'key,name'
          ? [{ key: 'near_miss', name: 'Near miss' }]
          : [],
      ),
    projects: () => Response.json([{ id: P1, title: 'Safety' }]),
    record_field_definitions: () => Response.json(fields),
    model_field_options: () =>
      Response.json([
        {
          id: 'o1',
          definition_id: 'f1',
          key: 'minor',
          label: 'Minor',
          display_order: 1,
          lifecycle: 'active',
        },
      ]),
  }

  it('files an incident from what the person said', async () => {
    const { ctx } = context(rows)

    const out = await buildBenchProposal(
      'sheetbase.incident.report',
      {
        ...base,
        incidentTitle: 'Centrifuge lid opened',
        fields: { severity: 'minor', 'What happened': 'Lid opened mid-run' },
      },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'record.create',
          modelKey: 'near_miss',
          customFields: {
            severity: 'minor',
            what_happened: 'Lid opened mid-run',
          },
        },
      },
    })
  })

  it('asks for what the form still needs instead of inventing it', async () => {
    const { ctx } = context(rows)

    const out = await buildBenchProposal(
      'sheetbase.incident.report',
      { ...base, incidentTitle: 'Lid', fields: { severity: 'minor' } },
      ctx,
    )

    expect(out).toMatchObject({ ok: false })
    expect(JSON.stringify(out)).toContain('What happened')
  })

  it('refuses a choice the form does not offer', async () => {
    const { ctx } = context(rows)

    const out = await buildBenchProposal(
      'sheetbase.incident.report',
      { ...base, incidentTitle: 'Lid', fields: { severity: 'catastrophic' } },
      ctx,
    )

    expect(JSON.stringify(out)).toContain('Minor')
  })

  it('sends a request on a named form', async () => {
    const { ctx } = context({
      ...rows,
      request_forms: () => Response.json([{ model_key: 'near_miss' }]),
    })

    const out = await buildBenchProposal(
      'sheetbase.request.send',
      {
        ...base,
        form: 'Near miss',
        requestTitle: 'Run 8 samples',
        fields: { severity: 'minor', 'what happened': 'x' },
        note: 'Urgent',
      },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'request.send', note: 'Urgent', projectId: null },
      },
    })
  })
})

describe('instrument out of service card', () => {
  const instruments = [
    {
      id: 'i1',
      display_id: 'INS-0002',
      name: 'Plate reader',
      location: 'Lab 1',
      instrument_type: 'other',
      retired_at: null,
      out_of_service_at: null,
    },
  ]

  it('needs a reason, then shows the status change', async () => {
    const { ctx } = context({ instruments: () => Response.json(instruments) })

    const none = await buildBenchProposal(
      'sheetbase.instrument.out_of_service',
      { ...base, instrument: 'plate reader' },
      ctx,
    )

    expect(none).toMatchObject({ ok: false })

    const out = await buildBenchProposal(
      'sheetbase.instrument.out_of_service',
      { ...base, instrument: 'plate reader', reason: 'Lamp has gone' },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        changes: [
          { label: 'Status', before: 'In service', after: 'Out of service' },
          { label: 'Reason', after: 'Lamp has gone' },
        ],
        action: {
          kind: 'instrument.service',
          instrumentId: 'i1',
          outOfService: true,
        },
      },
    })
  })
})

describe('storage reading cards', () => {
  const units = [{ id: 'u1', name: 'Freezer F-12', code: 'F-12' }]
  const rooms = [{ id: 'r1', name: 'Cold room', code: 'CR-1' }]

  it('finds the freezer and shows the reading', async () => {
    const { ctx } = context({
      storage_units: () => Response.json(units),
      storage_rooms: () => Response.json(rooms),
    })

    const out = await buildBenchProposal(
      'sheetbase.storage.log_reading',
      {
        ...base,
        place: 'F-12',
        measurement: 'Temperature',
        value: -78,
        unit: '°C',
      },
      ctx,
    )

    expect(out).toMatchObject({
      ok: true,
      proposal: {
        target: 'Freezer F-12 (F-12)',
        changes: [{ label: 'Temperature', after: '-78 °C' }],
        action: {
          kind: 'storage.reading',
          placeKind: 'unit',
          placeId: 'u1',
          value: -78,
        },
      },
    })
  })

  it('says what exists when nothing matches', async () => {
    const { ctx } = context({
      storage_units: () => Response.json(units),
      storage_rooms: () => Response.json(rooms),
    })

    const out = await buildBenchProposal(
      'sheetbase.storage.log_reading',
      { ...base, place: 'Incubator 9', value: 37 },
      ctx,
    )

    expect(out).toMatchObject({ ok: false })
  })

  it('logs it through the readings RPC', async () => {
    const { client, calls } = rpcTransport()

    await runBenchAction(client, {
      kind: 'storage.reading',
      placeKind: 'room',
      placeId: 'r1',
      feed: 'Temperature',
      value: 4.2,
      unit: '°C',
    })
    expect(calls[0][0]).toBe('record_storage_readings')
    expect(calls[0][1]).toMatchObject({ p_unit_id: null, p_room_id: 'r1' })
  })
})

describe('running a card', () => {
  it('calls the ordinary RPCs as the person', async () => {
    const { client, calls } = rpcTransport()

    await runBenchAction(client, {
      kind: 'instrument.service',
      instrumentId: 'i1',
      outOfService: true,
      reason: 'Lamp has gone',
      expectedBackOn: null,
      workDone: null,
    })
    await runBenchAction(client, {
      kind: 'reagent.order',
      materialRecordId: 'm1',
      quantity: 2,
      unit: 'bottles',
      note: null,
    })
    expect(calls.map(([name]) => name)).toEqual([
      'set_instrument_out_of_service',
      'request_reagent_order',
    ])
    expect(calls[0][1]).toMatchObject({
      p_instrument_id: 'i1',
      p_reason: 'Lamp has gone',
    })
  })

  it('proposes marking an order placed, matching the supplier list and the price', async () => {
    const { ctx } = context({
      reagent_orders: () =>
        Response.json([{ id: 'o1', number: 7, material_title: 'Tris base' }]),
      supplier_models: () => Response.json([{ model_key: 'supplier' }]),
      records: () =>
        Response.json([
          {
            id: 'sup1',
            identifier: 'SUP-1',
            title: 'Sigma-Aldrich',
            kind: 'supplier',
          },
          {
            id: 'sup2',
            identifier: 'SUP-2',
            title: 'Fisher',
            kind: 'supplier',
          },
        ]),
    })

    const result = await buildBenchProposal(
      'sheetbase.reagent.mark_ordered',
      {
        title: 'Mark RO-0007 ordered',
        summary: 'Placed with Sigma',
        order: 'RO-0007',
        supplier: 'sigma',
        price: 120.5,
        currency: 'gbp',
      },
      ctx,
    )

    expect(result.ok).toBe(true)

    if (!result.ok) return
    expect(result.proposal.action).toMatchObject({
      kind: 'reagent.place',
      orderId: 'o1',
      supplier: 'Sigma-Aldrich',
      supplierRecordId: 'sup1',
      price: 120.5,
      currency: 'GBP',
    })

    const missing = await buildBenchProposal(
      'sheetbase.reagent.mark_ordered',
      { title: 't', summary: 's', order: 'RO-0007', price: 5 },
      ctx,
    )

    expect(missing.ok).toBe(false)
  })

  it('proposes an instrument rate and needs a currency with it', async () => {
    const { ctx } = context({
      instruments: () =>
        Response.json([
          {
            id: 'i1',
            display_id: 'INS-0003',
            name: 'Plate reader',
            location: null,
            instrument_type: 'plate_reader',
            retired_at: null,
            out_of_service_at: null,
          },
        ]),
      instrument_rates: () =>
        Response.json([{ rate_per_hour: '18', currency: 'GBP' }]),
    })

    const ok = await buildBenchProposal(
      'sheetbase.instrument.set_rate',
      {
        title: 'Set rate',
        summary: 'Charge for the plate reader',
        instrument: 'Plate reader',
        ratePerHour: 24,
        currency: 'GBP',
      },
      ctx,
    )

    expect(ok.ok).toBe(true)

    if (ok.ok) {
      expect(ok.proposal.changes[0]).toMatchObject({ label: 'Rate' })
      expect(ok.proposal.action).toMatchObject({
        kind: 'instrument.rate',
        instrumentId: 'i1',
        ratePerHour: 24,
      })
    }

    const none = await buildBenchProposal(
      'sheetbase.instrument.set_rate',
      { title: 't', summary: 's', instrument: 'Plate reader', ratePerHour: 24 },
      ctx,
    )

    expect(none.ok).toBe(false)
  })

  it('runs the new cards through the same calls the pages make', async () => {
    const { client, calls } = rpcTransport()

    await runBenchAction(client, {
      kind: 'reagent.place',
      orderId: 'o1',
      supplier: 'Sigma-Aldrich',
      supplierRecordId: 'sup1',
      reference: 'PO-9',
      price: 10,
      currency: 'GBP',
      expectedOn: null,
    })
    await runBenchAction(client, {
      kind: 'instrument.rate',
      instrumentId: 'i1',
      ratePerHour: null,
      currency: 'GBP',
    })
    expect(calls.map(([name]) => name)).toEqual([
      'mark_reagent_ordered',
      'set_instrument_rate',
    ])
    expect(calls[0][1]).toMatchObject({ p_total_price: 10, p_currency: 'GBP' })
    expect(calls[1][1]).toMatchObject({
      p_rate_per_hour: null,
      p_currency: null,
    })
  })
})
