import { describe, expect, it } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  DATASET_ARCHIVE_TOOL,
  MATERIAL_ADD_LOT_TOOL,
  MATERIAL_STOCK_TOOL,
  SHEET_DUPLICATE_TOOL,
  STORAGE_UPDATE_TOOL,
  RECORDS_PROPOSE_TOOL_NAMES,
  RECORD_ARCHIVE_TOOL,
  RECORD_CREATE_TOOL,
} from './cards'
import { runRecordsAction } from './cards-run'
import { buildRecordsProposal, recordsProposalDefs } from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table by name; anything not listed is empty. */
function context(tables: Record<string, core.util.JSONType[]>): LabToolContext {
  const fetchFixture: typeof fetch = async (input) => {
    const path = urlOf(input).pathname

    return Response.json(tables[path.split('/').at(-1) ?? ''] ?? [])
  }

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const project = { id: 'p1', title: 'Assay development', key: 'ASSAY' }

describe('the record cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      recordsProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...RECORDS_PROPOSE_TOOL_NAMES])

    for (const name of RECORDS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('adds a material that is not in the lab yet, with its standard fields', async () => {
    const result = await buildRecordsProposal(
      RECORD_CREATE_TOOL,
      {
        ...base,
        kind: 'reagent',
        name: 'Lambda DNA standard',
        fields: {
          Supplier: 'Thermo Fisher',
          'Catalog no': 'P7589',
          Quantity: 500,
          Unit: 'µL',
        },
      },
      context({ projects: [project] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'records.create',
      projectId: 'p1',
      recordKind: 'material',
      title: 'Lambda DNA standard',
      properties: {
        supplier: 'Thermo Fisher',
        catalog_no: 'P7589',
        quantity: 500,
        unit: 'µL',
      },
      customFields: {},
    })
    expect(result.proposal.deepLink).toBe('/materials')
  })

  it('asks which project when there is more than one and none was named', async () => {
    const result = await buildRecordsProposal(
      RECORD_CREATE_TOOL,
      { ...base, kind: 'material', name: 'PicoGreen stock' },
      context({
        projects: [project, { ...project, id: 'p2', title: 'Other' }],
      }),
    )

    expect(result.ok).toBe(false)

    if (!result.ok) expect(result.message).toContain('Which project')
  })

  it('sends samples and experiments to their own cards', async () => {
    const result = await buildRecordsProposal(
      RECORD_CREATE_TOOL,
      { ...base, kind: 'sample', name: 'S1', project: 'Assay' },
      context({ projects: [project] }),
    )

    expect(result.ok).toBe(false)
  })

  it('archives a found record with the version it saw', async () => {
    const result = await buildRecordsProposal(
      RECORD_ARCHIVE_TOOL,
      { ...base, record: 'MAT-1' },
      context({
        records: [
          {
            id: 'r1',
            identifier: 'MAT-1',
            title: 'Buffer',
            kind: 'material',
            metadata_version: 4,
            archived_at: null,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'records.archive',
      recordId: 'r1',
      metadataVersion: 4,
    })
  })

  it('registers a lot of an existing material', async () => {
    const result = await buildRecordsProposal(
      MATERIAL_ADD_LOT_TOOL,
      {
        ...base,
        material: 'Buffer',
        lot: 'L2',
        expiry: '2027-05-01',
        quantity: 10,
      },
      context({
        records: [
          {
            id: 'r1',
            identifier: 'MAT-1',
            title: 'Buffer',
            kind: 'material',
            metadata_version: 1,
            archived_at: null,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'material.add_lot',
      recordId: 'r1',
      lot: 'L2',
    })
  })

  it('records a stock movement against the version it saw', async () => {
    const result = await buildRecordsProposal(
      MATERIAL_STOCK_TOOL,
      { ...base, material: 'Buffer', operation: 'consume', quantity: 5 },
      context({
        records: [
          {
            id: 'r1',
            identifier: 'MAT-1',
            title: 'Buffer',
            kind: 'material',
            metadata_version: 3,
            archived_at: null,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'material.stock',
      operation: 'consume',
      quantity: 5,
      metadataVersion: 3,
    })
  })

  it('asks how much when stock comes in or is used', async () => {
    const result = await buildRecordsProposal(
      MATERIAL_STOCK_TOOL,
      { ...base, material: 'Buffer', operation: 'receive' },
      context({}),
    )

    expect(result.ok).toBe(false)
  })

  it('renames a storage location at its level', async () => {
    const result = await buildRecordsProposal(
      STORAGE_UPDATE_TOOL,
      { ...base, location: 'Freezer 2', level: 'unit', name: 'Freezer 2B' },
      context({
        storage_units: [
          { id: 'u1', name: 'Freezer 2', code: 'F2', archived_at: null },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'storage.update_location',
      level: 'unit',
      id: 'u1',
      name: 'Freezer 2B',
    })
  })

  it('archives a dataset at the revision it saw', async () => {
    const result = await buildRecordsProposal(
      DATASET_ARCHIVE_TOOL,
      { ...base, dataset: 'Plate reads' },
      context({
        datasets: [
          { id: 'd1', name: 'Plate reads', display_id: 'DS-1', revision: 7 },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'dataset.archive',
      id: 'd1',
      revision: 7,
    })
  })

  it('copies a sheet under the new name', async () => {
    const result = await buildRecordsProposal(
      SHEET_DUPLICATE_TOOL,
      { ...base, sheet: 'Standards', name: 'Standards v2' },
      context({
        sheet_instances: [
          { id: 's1', name: 'Standards', display_id: null, revision: 2 },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'sheet.duplicate',
      id: 's1',
      revision: 2,
      name: 'Standards v2',
    })
  })

  it('runs the card through the ordinary RPC', async () => {
    const calls: string[] = []

    const fetchFixture: typeof fetch = async (input, init) => {
      calls.push(
        `${urlOf(input).pathname} ${init?.body instanceof Object ? '' : (init?.body ?? '')}`,
      )

      return Response.json({})
    }

    await runRecordsAction(createDataClient(fetchFixture), {
      kind: 'records.create',
      projectId: 'p1',
      recordKind: 'material',
      title: 'X',
      properties: { quantity: 1 },
      customFields: {},
    })

    expect(calls[0]).toContain('create_model_record')
    expect(calls[0]).toContain('"p_kind":"material"')
  })
})
