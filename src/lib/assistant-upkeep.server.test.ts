import { describe, expect, it } from 'vitest'

import { runUpkeepAction } from './assistant-upkeep-run'
import { buildUpkeepProposal } from './assistant-upkeep.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const WS = '33333333-3333-4333-8333-333333333333'
const base = { title: 'T', summary: 'S' }

/** One wire row a stub list answers with; fixtures supply every column read. */
type StubRow = { [column: string]: StubValue }

type StubValue = string | number | boolean | null | StubValue[] | StubRow

/** Rows by resource, or a function answering for the query it is given. */
type Rows = Partial<Record<string, StubRow[] | ((query: string) => StubRow[])>>

/** Whatever a stub RPC answers with; the cards never assume its shape. */
type StubRpcResult = StubValue | undefined

/** The arguments a stub records from one RPC call. */
type RecordedRpcArgs = Parameters<DataClient['rpc']>[1]

/** The client methods these cards call; the rest of DataClient is never reached. */
interface StubClientMethods {
  list: (resource: string, query?: string) => Promise<StubRow[]>
  rpc?: (name: string, args: RecordedRpcArgs) => Promise<StubRpcResult>
}

function stubClient(methods: StubClientMethods): DataClient {
  // SAFETY: each test supplies the client methods the card it exercises calls,
  // with fixture rows carrying the columns that card reads; no card reaches
  // another DataClient member, and a missing one fails the test loudly.
  return methods as DataClient
}

interface UpkeepTestContext {
  ctx: LabToolContext
  calls: string[]
}

function context(
  rows: Rows,
  rpc: (name: string, args: RecordedRpcArgs) => Promise<StubRpcResult> = () =>
    Promise.resolve(undefined),
): UpkeepTestContext {
  const calls: string[] = []

  const client = stubClient({
    list: (resource, query = '') => {
      calls.push(`${resource}${query}`)
      const source = rows[resource]

      return Promise.resolve(
        source instanceof Function ? source(query) : (source ?? []),
      )
    },
    rpc,
  })

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
    const calls: Array<[string, RecordedRpcArgs]> = []

    const client = stubClient({
      list: () => Promise.resolve([]),
      rpc: (name, args) => {
        calls.push([name, args])

        return Promise.resolve({ id: 'x' })
      },
    })

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
  function withPeople(rows: Rows, results: Record<string, StubValue[]> = {}) {
    return context(rows, (name) =>
      Promise.resolve(
        name === 'workspace_members_list'
          ? [
              { user_id: 'me', name: 'Gareth P.' },
              { user_id: 'u2', name: 'Priya S.' },
              { user_id: 'u3', name: 'Tom H.' },
            ]
          : (results[name] ?? []),
      ),
    )
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
    const calls: Array<[string, RecordedRpcArgs]> = []

    const client = stubClient({
      list: () => Promise.resolve([]),
      rpc: (name, args) => {
        calls.push([name, args])

        return Promise.resolve({})
      },
    })

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

describe('validation run card', () => {
  const withAllowed = (allowed: boolean) => {
    return context({}, () => Promise.resolve(allowed))
  }

  it('proposes a run only where validation is allowed', async () => {
    expect(
      await buildUpkeepProposal(
        'sheetbase.validation.run',
        { ...base },
        withAllowed(true).ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'validation.run' } },
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.validation.run',
        { ...base },
        withAllowed(false).ctx,
      ),
    ).toMatchObject({ ok: false })
  })
})

describe('data contract cards', () => {
  const contract = {
    id: 'c1',
    name: 'Assay plate reads',
    last_status: 'fail',
    dataset_schema_id: 's1',
    record_model_key: null,
  }

  it('proposes a check of the contract that matches the name', async () => {
    const { ctx } = context({ data_contracts: [contract] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.contract.check',
        { ...base, contract: 'assay plate' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        target: 'Assay plate reads',
        deepLink: '/models/s1/contract',
        action: { kind: 'contract.check', contractId: 'c1' },
      },
    })
  })

  it('says so when no contract or several match', async () => {
    expect(
      await buildUpkeepProposal(
        'sheetbase.contract.check',
        { ...base, contract: 'nothing' },
        context({}).ctx,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await buildUpkeepProposal(
        'sheetbase.contract.check',
        { ...base, contract: 'plate' },
        context({
          data_contracts: [
            contract,
            { ...contract, id: 'c2', name: 'Plate map' },
          ],
        }).ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('proposes a rule and refuses one the form would refuse', async () => {
    const { ctx } = context({ data_contracts: [contract] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.contract.add_rule',
        {
          ...base,
          contract: 'Assay plate reads',
          kind: 'range',
          field: 'od600',
          min: 0,
          max: 4,
          mode: 'block',
        },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'contract.rule_add',
          contractId: 'c1',
          rule: {
            kind: 'range',
            field: 'od600',
            min: 0,
            max: 4,
            mode: 'block',
          },
        },
      },
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.contract.add_rule',
        {
          ...base,
          contract: 'Assay plate reads',
          kind: 'range',
          field: 'od600',
        },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })
})

describe('trusted timestamp cards', () => {
  const withSettings = (rows: Rows, settings: StubValue) =>
    context(rows, () => Promise.resolve(settings))

  it('proposes choosing a service and turning it off, and asks a custom one for its address', async () => {
    const { ctx } = withSettings(
      {},
      { enabled: false, authority: null, url: null },
    )

    expect(
      await buildUpkeepProposal(
        'sheetbase.timestamps.set',
        { ...base, service: 'dfn' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'timestamps.set', service: 'dfn', address: null },
        changes: [{ before: 'Off', after: 'DFN-Verein' }],
      },
    })
    expect(
      await buildUpkeepProposal(
        'sheetbase.timestamps.set',
        { ...base, service: 'custom' },
        ctx,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await buildUpkeepProposal(
        'sheetbase.timestamps.set',
        { ...base, service: 'custom', address: 'https://tsa.lab.test/tsr' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { service: 'custom', address: 'https://tsa.lab.test/tsr' },
      },
    })
  })

  it('proposes trying again only for a signature that has not been stamped', async () => {
    const sig = '44444444-4444-4444-8444-444444444444'

    const gaveUp = context({
      signature_timestamps: [
        { signature_id: sig, status: 'failed', attempts: 6 },
      ],
    })

    expect(
      await buildUpkeepProposal(
        'sheetbase.timestamps.retry',
        { ...base, signatureId: sig },
        gaveUp.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'timestamps.retry', signatureId: sig } },
    })

    const stamped = context({
      signature_timestamps: [
        { signature_id: sig, status: 'stamped', attempts: 1 },
      ],
    })

    expect(
      await buildUpkeepProposal(
        'sheetbase.timestamps.retry',
        { ...base, signatureId: sig },
        stamped.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('runs the cards through the ordinary RPCs', async () => {
    const calls: Array<[string, RecordedRpcArgs]> = []

    const client = stubClient({
      list: () => Promise.resolve([]),
      rpc: (name, args) => {
        calls.push([name, args])

        return Promise.resolve({})
      },
    })

    await runUpkeepAction(client, {
      kind: 'timestamps.set',
      workspaceId: WS,
      service: 'off',
      address: null,
    })
    await runUpkeepAction(client, {
      kind: 'timestamps.retry',
      signatureId: 'sig',
    })
    expect(calls).toEqual([
      [
        'set_timestamp_settings',
        {
          p_workspace_id: WS,
          p_enabled: false,
          p_authority: null,
          p_url: null,
        },
      ],
      ['request_signature_timestamp', { p_signature_id: 'sig' }],
    ])
  })
})

describe('reproduce run card', () => {
  const definition = { id: 'd1', name: 'Scale titres', display_id: 'PL-0001' }

  const run = {
    id: 'r1',
    status: 'succeeded',
    definition_version_id: 'v1',
    created_at: '2026-11-06T10:00:00Z',
  }

  it('finds the latest finished run of a pipeline by name', async () => {
    const { ctx, calls } = context({
      pipeline_definitions: [definition],
      pipeline_definition_versions: [{ id: 'v1' }],
      pipeline_runs: [run],
    })

    const outcome = await buildUpkeepProposal(
      'sheetbase.pipeline.reproduce',
      { ...base, pipeline: 'scale titres' },
      ctx,
    )

    expect(outcome).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'pipeline.reproduce', runId: 'r1', definitionId: 'd1' },
      },
    })
    expect(calls.some((c) => c.includes('status=eq.succeeded'))).toBe(true)
  })

  it('asks which pipeline when none is named, and refuses an unfinished run', async () => {
    expect(
      await buildUpkeepProposal(
        'sheetbase.pipeline.reproduce',
        { ...base },
        context({}).ctx,
      ),
    ).toMatchObject({ ok: false })

    const unfinished = context({
      pipeline_runs: [{ ...run, status: 'failed' }],
      pipeline_definition_versions: [{ definition_id: 'd1' }],
      pipeline_definitions: [definition],
    })

    expect(
      await buildUpkeepProposal(
        'sheetbase.pipeline.reproduce',
        { ...base, runId: '11111111-1111-4111-8111-111111111111' },
        unfinished.ctx,
      ),
    ).toMatchObject({ ok: false })
  })
})

describe('sample stock and storage cards', () => {
  it('adds stock to a sample, with where it is kept', async () => {
    const { ctx } = context({ records: [s142] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.receive',
        { ...base, sample: 'S-0142', quantity: 50, location: 'Freezer 2' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'sample.receive',
          recordId: 's1',
          expectedMetadataVersion: 4,
          quantity: 50,
          location: 'Freezer 2',
        },
      },
    })
    const gone = context({ records: [{ ...s142, status: 'disposed' }] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.receive',
        { ...base, sample: 'S-0142', quantity: 5 },
        gone.ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('archives a sample, and finds an archived one to restore', async () => {
    const active = context({ records: [s142] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.archive',
        { ...base, sample: 'S-0142', archived: true },
        active.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'sample.archive', archived: true } },
    })
    const old = context({ records: [s142] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.archive',
        { ...base, sample: 'S-0142', archived: false },
        old.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'sample.archive', archived: false } },
    })
    expect(old.calls.at(-1)).toContain('archived_at=not.is.null')
  })

  it('cancels the one reservation a sample has, and asks which when there are two', async () => {
    const one = context({
      records: [s142],
      sample_reservations: [
        {
          id: 'v1',
          quantity: 20,
          unit: 'µl',
          experiment: { identifier: 'EXP-12', title: 'ELISA plate 4' },
        },
      ],
    })

    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.reservation_cancel',
        { ...base, sample: 'S-0142' },
        one.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'sample.reservation_cancel', reservationId: 'v1' },
      },
    })

    const two = context({
      records: [s142],
      sample_reservations: [
        {
          id: 'v1',
          quantity: 20,
          unit: 'µl',
          experiment: { identifier: 'EXP-12', title: 'a' },
        },
        {
          id: 'v2',
          quantity: 10,
          unit: 'µl',
          experiment: { identifier: 'EXP-13', title: 'b' },
        },
      ],
    })

    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.reservation_cancel',
        { ...base, sample: 'S-0142' },
        two.ctx,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await buildUpkeepProposal(
        'sheetbase.sample.reservation_cancel',
        { ...base, sample: 'S-0142', experiment: 'EXP-13' },
        two.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { reservationId: 'v2' } },
    })
  })

  it('puts a sample in a free position, refuses a taken one, and takes it out', async () => {
    const box = { id: 'b1', name: 'Box 7', code: 'B7' }

    const free = context({
      records: [s142],
      storage_boxes: [box],
      storage_positions: [{ id: 'p4', label: 'B4', status: 'available' }],
    })

    expect(
      await buildUpkeepProposal(
        'sheetbase.storage.place',
        { ...base, sample: 'S-0142', box: 'Box 7', position: 'B4' },
        free.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'storage.place', positionId: 'p4' } },
    })

    const taken = context({
      records: [s142],
      storage_boxes: [box],
      storage_positions: [{ id: 'p4', label: 'B4', status: 'occupied' }],
    })

    expect(
      await buildUpkeepProposal(
        'sheetbase.storage.place',
        { ...base, sample: 'S-0142', box: 'Box 7', position: 'B4' },
        taken.ctx,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await buildUpkeepProposal(
        'sheetbase.storage.place',
        { ...base, sample: 'S-0142' },
        free.ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'storage.place', positionId: null } },
    })
  })

  it('adds a freezer inside a room, and asks for what is missing', async () => {
    const { ctx } = context({ storage_rooms: [{ id: 'r1', name: 'Room 1' }] })
    expect(
      await buildUpkeepProposal(
        'sheetbase.storage.add_location',
        {
          ...base,
          level: 'unit',
          name: 'Freezer 3',
          code: 'F3',
          inside: 'Room 1',
          unitType: 'freezer',
        },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'storage.add_location',
          level: 'unit',
          parentId: 'r1',
          workspaceId: WS,
        },
      },
    })

    for (const args of [
      { level: 'unit', name: 'Freezer 3', code: 'F3' },
      { level: 'unit', name: 'Freezer 3', inside: 'Room 1' },
    ]) {
      expect(
        await buildUpkeepProposal(
          'sheetbase.storage.add_location',
          { ...base, ...args },
          ctx,
        ),
      ).toMatchObject({ ok: false })
    }
  })

  it('runs the cards by calling the sample and storage functions', async () => {
    const calls: Array<[string, unknown]> = []

    const client = stubClient({
      list: () => Promise.resolve([]),
      rpc: (name, args) => {
        calls.push([name, args])

        return Promise.resolve({ id: 'x', metadata_version: 5 })
      },
    })

    await runUpkeepAction(client, {
      kind: 'storage.place',
      recordId: 's1',
      expectedMetadataVersion: 4,
      positionId: null,
      notes: null,
    })
    await runUpkeepAction(client, {
      kind: 'storage.add_location',
      workspaceId: WS,
      level: 'room',
      parentId: 'site1',
      name: 'Room 2',
      code: 'R2',
      unitType: null,
      rows: null,
      cols: null,
    })
    expect(calls.map(([name]) => name)).toEqual([
      'remove_sample_from_position',
      'create_storage_location',
    ])
  })
})
