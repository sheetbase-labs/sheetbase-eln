import { describe, expect, it } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  MATERIAL_SAFETY_TOOL,
  POSITION_STATUS_TOOL,
  RELEASE_RULES_TOOL,
  SAMPLE_LABEL_TOOL,
  SAMPLE_MATCH_TOOL,
  SAMPLE_STORAGE_PROPOSE_TOOL_NAMES,
  SAMPLE_WITHDRAW_TOOL,
  SHIPMENT_DISPATCH_TOOL,
  SHIPMENT_UPDATE_TOOL,
  STOCKTAKE_CANCEL_TOOL,
  STOCKTAKE_RESOLVE_TOOL,
  STOCKTAKE_SCAN_TOOL,
  WORKFLOW_SAVE_TOOL,
  WORKFLOW_STATUS_TOOL,
  isSampleStorageAction,
} from './cards'
import type { SampleStorageAction } from './cards'
import { runSampleStorageAction } from './cards-run'
import {
  buildSampleStorageProposal,
  sampleStorageProposalDefs,
} from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table by name; anything not listed is empty. */
function context(tables: Record<string, core.util.JSONType[]>): LabToolContext {
  const fetchFixture: typeof fetch = async (input) =>
    Response.json(tables[urlOf(input).pathname.split('/').at(-1) ?? ''] ?? [])

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const sample = {
  id: 'r1',
  identifier: 'S-0142',
  title: 'Lysate A',
  status: 'available',
  metadata_version: 3,
  properties: {},
}

const stocktake = {
  id: 'st1',
  number: 7,
  status: 'open',
  scope_name: 'Freezer 2',
}

const shipment = {
  id: 'sh1',
  number: 3,
  status: 'draft',
  counterparty: 'Cambridge Core',
  carrier: null,
  tracking_reference: null,
  expected_on: null,
  notes: null,
}

async function action(
  tool: Parameters<typeof buildSampleStorageProposal>[0],
  args: Readonly<Record<string, core.util.JSONType>>,
  tables: Record<string, core.util.JSONType[]>,
): Promise<SampleStorageAction> {
  const result = await buildSampleStorageProposal(
    tool,
    { ...base, ...args },
    context(tables),
  )

  if (!result.ok) throw new Error(result.message)

  const made = result.proposal.action

  if (!made || !isSampleStorageAction(made)) throw new Error('no card action')

  return made
}

describe('the sample and storage cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      sampleStorageProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...SAMPLE_STORAGE_PROPOSE_TOOL_NAMES])

    for (const name of SAMPLE_STORAGE_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('takes an amount of a sample for an experiment found by its ID', async () => {
    expect(
      await action(
        SAMPLE_WITHDRAW_TOOL,
        {
          sample: 'S-0142',
          quantity: 5,
          unit: 'µL',
          experiment: 'EXP-0042',
          newContainer: 'Lysate A aliquot',
        },
        {
          records: [
            sample,
            { id: 'e1', identifier: 'EXP-0042', title: 'Assay run' },
          ],
        },
      ),
    ).toMatchObject({
      kind: 'sample.withdraw',
      recordId: 'r1',
      metadataVersion: 3,
      quantity: 5,
      unit: 'µL',
      experimentId: 'e1',
      newContainer: 'Lysate A aliquot',
    })
  })

  it('records a label print and files typed places', async () => {
    expect(
      await action(
        SAMPLE_LABEL_TOOL,
        { sample: 'S-0142' },
        { records: [sample] },
      ),
    ).toMatchObject({ kind: 'sample.label_printed', identifier: 'S-0142' })

    expect(await action(SAMPLE_MATCH_TOOL, {}, {})).toEqual({
      kind: 'sample.match_locations',
      workspaceId: 'ws',
    })
  })

  it('blocks an empty box position, but not one holding a sample', async () => {
    const tables = {
      storage_boxes: [{ id: 'b1', name: 'Box A', code: 'BA' }],
      storage_positions: [{ id: 'p4', label: 'B4', status: 'available' }],
    }

    expect(
      await action(
        POSITION_STATUS_TOOL,
        { box: 'Box A', position: 'B4', status: 'quarantined' },
        tables,
      ),
    ).toEqual({
      kind: 'storage.position_status',
      positionId: 'p4',
      status: 'quarantined',
      notes: null,
    })

    const occupied = await buildSampleStorageProposal(
      POSITION_STATUS_TOOL,
      { ...base, box: 'Box A', position: 'B4', status: 'missing' },
      context({
        ...tables,
        storage_positions: [{ id: 'p4', label: 'B4', status: 'occupied' }],
      }),
    )

    expect(occupied.ok).toBe(false)
  })

  it('scans, settles and cancels a stocktake found by its number', async () => {
    expect(
      await action(
        STOCKTAKE_SCAN_TOOL,
        { stocktake: 'ST-0007', item: 'S-0142' },
        { stocktakes: [stocktake], records: [sample] },
      ),
    ).toEqual({
      kind: 'stocktake.scan',
      stocktakeId: 'st1',
      recordId: 'r1',
      boxId: null,
    })

    expect(
      await action(
        STOCKTAKE_RESOLVE_TOOL,
        { stocktake: 'ST-0007', item: 'S-0142', action: 'refile' },
        {
          stocktakes: [stocktake],
          stocktake_items: [
            {
              id: 'i1',
              identifier: 'S-0142',
              title: 'Lysate A',
              state: 'misplaced',
              resolution: null,
            },
          ],
        },
      ),
    ).toMatchObject({
      kind: 'stocktake.resolve',
      itemId: 'i1',
      action: 'refile',
    })

    expect(
      await action(
        STOCKTAKE_CANCEL_TOOL,
        { stocktake: 'ST-0007' },
        { stocktakes: [stocktake] },
      ),
    ).toEqual({ kind: 'stocktake.cancel', stocktakeId: 'st1' })
  })

  it('refuses to settle an item that is already settled', async () => {
    const result = await buildSampleStorageProposal(
      STOCKTAKE_RESOLVE_TOOL,
      { ...base, stocktake: 'ST-0007', item: 'S-0142', action: 'accept' },
      context({
        stocktakes: [stocktake],
        stocktake_items: [
          {
            id: 'i1',
            identifier: 'S-0142',
            title: null,
            state: 'misplaced',
            resolution: 'accept',
          },
        ],
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('sends and amends a shipment by its SHP number', async () => {
    expect(
      await action(
        SHIPMENT_DISPATCH_TOOL,
        { shipment: 'SHP-0003', carrier: 'DHL', expectedOn: '2026-12-01' },
        { shipments: [shipment] },
      ),
    ).toMatchObject({
      kind: 'shipment.dispatch',
      shipmentId: 'sh1',
      carrier: 'DHL',
      expectedOn: '2026-12-01',
    })

    expect(
      await action(
        SHIPMENT_UPDATE_TOOL,
        { shipment: 'SHP-0003', trackingReference: '1Z999' },
        { shipments: [shipment] },
      ),
    ).toMatchObject({ kind: 'shipment.update', trackingReference: '1Z999' })

    const empty = await buildSampleStorageProposal(
      SHIPMENT_UPDATE_TOOL,
      { ...base, shipment: 'SHP-0003' },
      context({ shipments: [shipment] }),
    )

    expect(empty.ok).toBe(false)

    const sent = await buildSampleStorageProposal(
      SHIPMENT_DISPATCH_TOOL,
      { ...base, shipment: 'SHP-0003' },
      context({ shipments: [{ ...shipment, status: 'received' }] }),
    )

    expect(sent.ok).toBe(false)
  })

  it('sets a material’s hazards, finding it by ID', async () => {
    expect(
      await action(
        MATERIAL_SAFETY_TOOL,
        {
          material: 'MAT-0012',
          pictograms: ['GHS02', 'GHS07'],
          signalWord: 'danger',
          hazardStatements: ['H225'],
        },
        {
          records: [
            {
              id: 'm1',
              identifier: 'MAT-0012',
              title: 'Ethanol',
              kind: 'material',
              metadata_version: 1,
            },
          ],
        },
      ),
    ).toEqual({
      kind: 'material.safety',
      recordId: 'm1',
      pictograms: ['GHS02', 'GHS07'],
      signalWord: 'danger',
      hazardStatements: ['H225'],
      allLots: true,
    })
  })

  it('saves a linear workflow, keeping the ids of steps that already exist', async () => {
    const saved = await action(
      WORKFLOW_SAVE_TOOL,
      {
        name: 'Intake',
        steps: [
          { name: 'Received' },
          { name: 'Aliquoted', turnaroundDays: 2 },
          { name: 'Stored' },
        ],
      },
      {
        sample_workflows: [{ id: 'w1', name: 'Intake' }],
        sample_workflow_stages: [{ id: 'g1', name: 'Received' }],
      },
    )

    if (saved.kind !== 'sample_workflow.save') throw new Error('wrong card')
    expect(saved.workflowId).toBe('w1')
    expect(saved.definition.stages.map((stage) => stage.key)).toEqual([
      'g1',
      'new-1',
      'new-2',
    ])
    expect(saved.definition.stages[0]).toMatchObject({
      id: 'g1',
      next: ['new-1'],
    })
    expect(saved.definition.stages[2]).toMatchObject({ final: true, next: [] })
  })

  it('archives a workflow and sets release rules', async () => {
    expect(
      await action(
        WORKFLOW_STATUS_TOOL,
        { workflow: 'Intake', status: 'archived' },
        { sample_workflows: [{ id: 'w1', name: 'Intake', status: 'active' }] },
      ),
    ).toEqual({
      kind: 'sample_workflow.set_status',
      workflowId: 'w1',
      status: 'archived',
    })

    expect(
      await action(
        RELEASE_RULES_TOOL,
        {
          sampleType: 'Plasma',
          rules: [
            { kind: 'min_measurements', count: 2 },
            { kind: 'measurement_range', measurement: 'pH', min: 6, max: 8 },
          ],
        },
        {},
      ),
    ).toEqual({
      kind: 'release_rules.set',
      workspaceId: 'ws',
      sampleType: 'Plasma',
      rules: [
        { kind: 'min_measurements', count: 2 },
        { kind: 'measurement_range', measurement: 'pH', min: 6, max: 8 },
      ],
    })
  })

  it('runs each card through the ordinary RPC', async () => {
    const calls: string[] = []

    const fetchFixture: typeof fetch = async (input, init) => {
      calls.push(`${urlOf(input).pathname} ${String(init?.body ?? '')}`)

      return Response.json({})
    }

    const client = createDataClient(fetchFixture)

    await runSampleStorageAction(client, {
      kind: 'stocktake.cancel',
      stocktakeId: 'st1',
    })

    await runSampleStorageAction(client, {
      kind: 'sample.withdraw',
      recordId: 'r1',
      metadataVersion: 3,
      quantity: 5,
      unit: null,
      experimentId: 'e1',
      notes: null,
      newContainer: null,
    })

    await runSampleStorageAction(client, {
      kind: 'release_rules.set',
      workspaceId: 'ws',
      sampleType: 'Plasma',
      rules: [],
    })

    expect(calls[0]).toContain('cancel_stocktake')
    expect(calls[1]).toContain('withdraw_sample')
    expect(calls[1]).toContain('"p_purpose_experiment_id":"e1"')
    expect(calls[2]).toContain('set_sample_release_rules')
  })
})
