import { describe, expect, it } from 'vitest'

import { LABWORK_PROPOSE_TOOL_NAMES } from './assistant-labwork'
import { runLabworkAction } from './assistant-labwork-run'
import {
  buildLabworkProposal,
  isLabworkProposalTool,
  labworkProposalDefs,
} from './assistant-labwork.server'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const WS = '33333333-3333-4333-8333-333333333333'
const base = { title: 'T', summary: 'S' }

type Rows = Partial<
  Record<string, Array<Record<string, unknown>> | ((q: string) => unknown[])>
>

function context(
  rows: Rows,
  rpcs: Record<string, unknown> = {},
): LabToolContext {
  const client = {
    list: (resource: string, query = '') => {
      const source = rows[resource]
      return Promise.resolve(
        typeof source === 'function' ? source(query) : (source ?? []),
      )
    },
    rpc: (name: string) => Promise.resolve(rpcs[name] ?? []),
  } as unknown as DataClient
  return { client, workspaceId: WS, userId: 'me', timeZone: 'Europe/London' }
}

const build = (name: string, args: unknown, ctx: LabToolContext) =>
  buildLabworkProposal(
    name as (typeof LABWORK_PROPOSE_TOOL_NAMES)[number],
    { ...base, ...(args as object) },
    ctx,
  )

const s1 = {
  id: 's1',
  identifier: 'S-0001',
  title: 'Plasma A',
  status: 'available',
  metadata_version: 2,
  properties: { quantity: 100, quantityUnit: 'µl' },
}
const s2 = { ...s1, id: 's2', identifier: 'S-0002', title: 'Plasma B' }
const exp = { id: 'e1', identifier: 'EXP-1', title: 'Pool run' }

describe('tool wiring', () => {
  it('registers every tool with the assistant gateway and gives each a definition', () => {
    for (const name of LABWORK_PROPOSE_TOOL_NAMES) {
      expect(isLabworkProposalTool(name)).toBe(true)
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
    }
    expect(labworkProposalDefs().map((def) => def.name)).toHaveLength(
      LABWORK_PROPOSE_TOOL_NAMES.length,
    )
  })
})

describe('stocktakes', () => {
  const tree = {
    storage_boxes: [
      { id: 'b1', rack_id: null, name: 'Box 4', code: 'B4', archived_at: null },
    ],
  }

  it('starts a count of a box, and refuses one that is already open', async () => {
    expect(
      await build(
        'sheetbase.stocktake.start',
        { location: 'Box 4' },
        context(tree),
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'stocktake.start', level: 'box', scopeId: 'b1' },
      },
    })
    expect(
      await build(
        'sheetbase.stocktake.start',
        { location: 'Box 4' },
        context({ ...tree, stocktakes: [{ number: 3 }] }),
      ),
    ).toMatchObject({ ok: false })
  })

  it('says how many unscanned items become missing before finishing', async () => {
    const ctx = context({
      stocktakes: [
        { id: 'c1', number: 7, scope_name: 'Box 4', scope_path: 'F1 / Box 4' },
      ],
      stocktake_items: [
        { state: 'confirmed' },
        { state: 'expected' },
        { state: 'expected' },
      ],
    })
    const built = await build(
      'sheetbase.stocktake.complete',
      { stocktake: 'ST-7' },
      ctx,
    )
    expect(built).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'stocktake.complete', stocktakeId: 'c1' } },
    })
    expect(JSON.stringify(built)).toContain('recorded as missing')
  })
})

describe('legal holds and retention', () => {
  it('needs a project or a kind for a hold', async () => {
    expect(
      await build(
        'sheetbase.legal_hold.create',
        { name: 'Audit' },
        context({}),
      ),
    ).toMatchObject({ ok: false })
    expect(
      await build(
        'sheetbase.legal_hold.create',
        { name: 'Audit', project: 'Vaccine' },
        context({ projects: [{ id: 'p1', key: 'VAC', title: 'Vaccine A' }] }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'hold.create', projectId: 'p1' } },
    })
  })

  it('releases only an active hold', async () => {
    const ctx = context({ legal_holds: [{ id: 'h1', name: 'Audit' }] })
    expect(
      await build('sheetbase.legal_hold.release', { hold: 'audit' }, ctx),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'hold.release', holdId: 'h1' } },
    })
    expect(
      await build('sheetbase.legal_hold.release', { hold: 'x' }, context({})),
    ).toMatchObject({ ok: false })
  })

  it('sets a rule, and says when nothing would change', async () => {
    const models = {
      record_models: [{ key: 'experiment', name: 'Experiment' }],
    }
    expect(
      await build(
        'sheetbase.retention.set',
        { kind: 'experiment', keepMonths: 24 },
        context({ ...models, retention_rules: [] }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'retention.set',
          recordKind: 'experiment',
          keepMonths: 24,
        },
      },
    })
    expect(
      await build(
        'sheetbase.retention.set',
        { kind: 'experiment', keepMonths: 24 },
        context({ ...models, retention_rules: [{ keep_months: 24 }] }),
      ),
    ).toMatchObject({ ok: false })
  })

  it('lists what applying retention would archive, and refuses when nothing is due', async () => {
    const due = [{ identifier: 'EXP-1', title: 'Old run', kind: 'experiment' }]
    expect(
      await build(
        'sheetbase.retention.apply',
        {},
        context({}, { retention_due: due }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'retention.apply', recordKind: null } },
    })
    expect(
      await build('sheetbase.retention.apply', {}, context({})),
    ).toMatchObject({ ok: false })
  })
})

describe('registry, workflows and rules', () => {
  it('adds a registry entry and refuses a duplicate', async () => {
    const rows = {
      record_models: [{ key: 'cell_line', name: 'Cell line' }],
      projects: [{ id: 'p1', key: 'VAC', title: 'Vaccine A' }],
    }
    const input = { registry: 'cell line', name: 'HEK-293', project: 'VAC' }
    expect(
      await build('sheetbase.registry.add', input, context(rows)),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'registry.add',
          recordKind: 'cell_line',
          projectId: 'p1',
          title: 'HEK-293',
        },
      },
    })
    expect(
      await build(
        'sheetbase.registry.add',
        input,
        context(rows, {
          registry_find_duplicates: [
            { identifier: 'CL-1', title: 'HEK-293', match: 'name' },
          ],
        }),
      ),
    ).toMatchObject({ ok: false })
  })

  it('enrols a sample, and refuses when it is already in the workflow', async () => {
    const rows = {
      records: [s1],
      sample_workflows: [{ id: 'w1', name: 'QC release' }],
    }
    expect(
      await build(
        'sheetbase.workflow.enrol',
        { sample: 'S-0001', workflow: 'QC' },
        context({ ...rows, sample_workflow_runs: [] }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'workflow.enrol', sampleId: 's1', workflowId: 'w1' },
      },
    })
    expect(
      await build(
        'sheetbase.workflow.enrol',
        { sample: 'S-0001', workflow: 'QC' },
        context({
          ...rows,
          sample_workflow_runs: [
            {
              id: 'r1',
              workflow_id: 'w1',
              stage_id: 'st1',
              entered_at: '2026-11-01',
              due_at: null,
              completed_at: null,
              workflow: { name: 'QC release' },
              stage: { name: 'Review' },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false })
  })

  it('refuses limits that are the wrong way round', async () => {
    const rows = { record_models: [{ key: 'assay', name: 'Assay' }] }
    const ctx = context(rows)
    expect(
      await build(
        'sheetbase.spec_limits.set',
        { model: 'assay', field: 'purity', lowerLimit: 9, upperLimit: 1 },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })

  it('changes only the booking rules named', async () => {
    const instrument = {
      id: 'i1',
      name: 'Plate reader',
      display_id: 'INS-1',
      location: null,
    }
    const ctx = context({
      instruments: [instrument],
      instrument_booking_rules: [
        { max_booking_minutes: 60, max_advance_days: null },
      ],
      instrument_required_training: [],
    })
    const built = await build(
      'sheetbase.booking_rules.set',
      { instrument: 'INS-1', maxBookingMinutes: 120 },
      ctx,
    )
    expect(built).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'booking_rules.set',
          instrumentId: 'i1',
          maxBookingMinutes: 120,
          maxAdvanceDays: null,
        },
      },
    })
    expect(
      await build(
        'sheetbase.booking_rules.set',
        { instrument: 'INS-1', maxBookingMinutes: 60 },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })
})

describe('timers, repeats and pooling', () => {
  it('stops a running timer', async () => {
    expect(
      await build(
        'sheetbase.timer.end',
        {},
        context({
          my_step_timers: [
            { id: 't1', record_id: 'r1', label: 'Incubate', ends_at: 'x' },
          ],
        }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'timer.end', timerId: 't1' } },
    })
  })

  it('pauses, resumes and ends repeating work', async () => {
    const ctx = context({
      recurring_schedules: [
        { id: 'c1', title: 'Weekly QC', status: 'active', kind: 'booking' },
      ],
    })
    expect(
      await build('sheetbase.recurring.pause', { schedule: 'weekly' }, ctx),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'recurring.pause', paused: true } },
    })
    expect(
      await build('sheetbase.recurring.end', { schedule: 'weekly' }, ctx),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'recurring.end', cancelUpcoming: true } },
    })
  })

  it('pools samples in the same unit, and refuses an overdraw', async () => {
    const ctx = context({
      records: (query: string) =>
        query.includes('kind=eq.experiment')
          ? [exp]
          : query.includes('S-0002')
            ? [s2]
            : [s1],
    })
    expect(
      await build(
        'sheetbase.sample.pool',
        {
          sources: [
            { sample: 'S-0001', quantity: 20 },
            { sample: 'S-0002', quantity: 30 },
          ],
          experiment: 'EXP-1',
        },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'sample.pool',
          experimentId: 'e1',
          unit: 'µl',
          sources: [
            { recordId: 's1', quantity: 20, expectedMetadataVersion: 2 },
            { recordId: 's2', quantity: 30, expectedMetadataVersion: 2 },
          ],
        },
      },
    })
    expect(
      await build(
        'sheetbase.sample.pool',
        {
          sources: [
            { sample: 'S-0001', quantity: 500 },
            { sample: 'S-0002', quantity: 1 },
          ],
          experiment: 'EXP-1',
        },
        ctx,
      ),
    ).toMatchObject({ ok: false })
  })
})

describe('searches, pins and the logo', () => {
  it('saves a search unless the name is taken', async () => {
    expect(
      await build(
        'sheetbase.search.save',
        { name: 'Old runs', words: 'ELISA 2025' },
        context({ saved_searches: [] }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        action: { kind: 'search.save', visibility: 'private' },
      },
    })
    expect(
      await build(
        'sheetbase.search.save',
        { name: 'Old runs', words: 'x' },
        context({ saved_searches: [{ name: 'old runs' }] }),
      ),
    ).toMatchObject({ ok: false })
  })

  it('pins and unpins, and says when nothing would change', async () => {
    const rec = { id: 'r1', identifier: 'EXP-12', title: 'ELISA plate 4' }
    expect(
      await build(
        'sheetbase.pin',
        { target: 'record', name: 'EXP-12' },
        context({ records: [rec], user_favourites: [] }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'pin.set', id: 'r1', pinned: true } },
    })
    expect(
      await build(
        'sheetbase.pin',
        { target: 'record', name: 'EXP-12', pin: false },
        context({ records: [rec], user_favourites: [] }),
      ),
    ).toMatchObject({ ok: false })
  })

  it('sets the logo from an uploaded image, and refuses a big one', async () => {
    const file = {
      record_id: 'f1',
      display_name: 'logo.png',
      media_type: 'image/png',
      byte_size: 40_000,
    }
    expect(
      await build(
        'sheetbase.lab.logo',
        { change: 'set', file: 'logo.png' },
        context({ file_objects: [file] }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: { action: { kind: 'logo.set', fileRecordId: 'f1' } },
    })
    expect(
      await build(
        'sheetbase.lab.logo',
        { change: 'set', file: 'logo.png' },
        context({ file_objects: [{ ...file, byte_size: 3_000_000 }] }),
      ),
    ).toMatchObject({ ok: false })
    expect(
      await build('sheetbase.lab.logo', { change: 'remove' }, context({})),
    ).toMatchObject({ ok: true, proposal: { action: { kind: 'logo.remove' } } })
  })
})

describe('running lab-work actions', () => {
  it('calls the ordinary RPCs, as the person', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push([name, args])
        return Promise.resolve({ id: 'x', pool: { id: 'p' }, sources: [] })
      },
    } as unknown as DataClient
    const started = await runLabworkAction(client, {
      kind: 'stocktake.start',
      level: 'box',
      scopeId: 'b1',
      note: null,
    })
    await runLabworkAction(client, {
      kind: 'stocktake.complete',
      stocktakeId: 'c1',
    })
    await runLabworkAction(client, {
      kind: 'hold.create',
      name: 'Audit',
      reason: 'Inspection',
      projectId: 'p1',
      recordKind: null,
    })
    await runLabworkAction(client, {
      kind: 'hold.release',
      holdId: 'h1',
      note: '',
    })
    await runLabworkAction(client, {
      kind: 'retention.set',
      recordKind: 'experiment',
      keepMonths: 24,
      note: '',
    })
    await runLabworkAction(client, {
      kind: 'retention.apply',
      recordKind: null,
    })
    await runLabworkAction(client, {
      kind: 'limits.set',
      recordKind: 'assay',
      fieldName: 'purity',
      lowerLimit: 90,
      upperLimit: null,
      alertLower: null,
      alertUpper: null,
      note: null,
    })
    await runLabworkAction(client, {
      kind: 'timer.end',
      timerId: 't1',
      recordId: null,
    })
    await runLabworkAction(client, {
      kind: 'recurring.pause',
      scheduleId: 'c1',
      paused: true,
    })
    await runLabworkAction(client, {
      kind: 'recurring.end',
      scheduleId: 'c1',
      cancelUpcoming: true,
    })
    await runLabworkAction(client, {
      kind: 'workflow.leave',
      sampleId: 's1',
      runId: 'r1',
    })
    await runLabworkAction(client, {
      kind: 'pin.set',
      target: 'record',
      id: 'r1',
      pinned: true,
    })
    const pooled = await runLabworkAction(client, {
      kind: 'sample.pool',
      sources: [{ recordId: 's1', quantity: 1, expectedMetadataVersion: 2 }],
      experimentId: 'e1',
      unit: null,
      notes: null,
      poolName: null,
      storageLocation: null,
    })
    expect(started).toEqual({ openHref: '/stocktake/x' })
    expect(pooled).toEqual({ openHref: '/records/p' })
    expect(calls.map(([name]) => name)).toEqual([
      'start_stocktake',
      'complete_stocktake',
      'create_legal_hold',
      'release_legal_hold',
      'set_retention_rule',
      'apply_retention',
      'set_field_spec_limits',
      'end_step_timer',
      'set_recurring_schedule_paused',
      'end_recurring_schedule',
      'leave_sample_workflow',
      'set_record_favourite',
      'pool_samples',
    ])
  })
})
