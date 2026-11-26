import { describe, expect, it } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  PLATE_ASSAYS_PROPOSE_TOOL_NAMES,
  PLATE_DESIGN_CREATE_TOOL,
  PLATE_DESIGN_FILL_TOOL,
  PLATE_LAYOUT_SAVE_TOOL,
  PLATE_QC_TRACK_TOOL,
  PLATE_RUN_ARCHIVE_TOOL,
  PLATE_RUN_CREATE_TOOL,
  PLATE_RUN_UPDATE_TOOL,
  WORKLIST_CANCEL_TOOL,
  WORKLIST_COMPLETE_TOOL,
  isPlateAssaysAction,
} from './cards'
import type { PlateAssaysAction } from './cards'
import { runPlateAssaysAction } from './cards-run'
import {
  buildPlateAssaysProposal,
  plateAssaysProposalDefs,
} from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

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

async function action(
  tool: Parameters<typeof buildPlateAssaysProposal>[0],
  args: Readonly<Record<string, core.util.JSONType>>,
  tables: Record<string, core.util.JSONType[]>,
): Promise<PlateAssaysAction> {
  const result = await buildPlateAssaysProposal(
    tool,
    { ...base, ...args },
    context(tables),
  )

  if (!result.ok) throw new Error(result.message)

  const made = result.proposal.action

  if (!made || !isPlateAssaysAction(made)) throw new Error('no card action')

  return made
}

const run = {
  id: 'pr1',
  number: 12,
  name: 'ELISA 3',
  status: 'draft',
  config: {},
  metadata_version: 4,
}

const design = {
  id: 'd1',
  workspace_id: 'ws',
  project_id: null,
  name: 'Titration',
  format: '96_well',
  rows: 8,
  cols: 12,
  validation: null,
  status: 'draft',
  metadata_version: 2,
}

const worklist = { id: 'w1', number: 4, name: 'Hits', status: 'planned' }

describe('the plate cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      plateAssaysProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...PLATE_ASSAYS_PROPOSE_TOOL_NAMES])

    for (const name of PLATE_ASSAYS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('sets up a run with the samples laid out and linked by their IDs', async () => {
    const made = await action(
      PLATE_RUN_CREATE_TOOL,
      {
        name: 'ELISA 4',
        samples: ['S-0001', 'S-0002'],
        replicates: 2,
        blanks: 2,
        experiment: 'EXP-0042',
        project: 'PRJ-0008',
      },
      {
        projects: [
          { id: 'p1', key: 'ASSAY', title: 'Assay', display_id: 'PRJ-0008' },
        ],
        records: [
          { id: 'e1', identifier: 'EXP-0042', title: 'Assay run' },
          { id: 's1', identifier: 'S-0001', title: 'A' },
          { id: 's2', identifier: 'S-0002', title: 'B' },
        ],
      },
    )

    if (made.kind !== 'plate_run.create') throw new Error('wrong card')
    expect(made).toMatchObject({
      name: 'ELISA 4',
      format: '96_well',
      projectId: 'p1',
      experimentId: 'e1',
    })
    // Two blanks, then two samples in two wells each.
    expect(made.wells).toHaveLength(6)
    expect(made.wells.filter((well) => well.sampleId === 's1')).toHaveLength(2)
  })

  it('refuses more samples than the plate holds', async () => {
    const result = await buildPlateAssaysProposal(
      PLATE_RUN_CREATE_TOOL,
      {
        ...base,
        name: 'Tiny',
        format: '6_well',
        samples: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      },
      context({}),
    )

    expect(result.ok).toBe(false)
  })

  it('renames a run and changes how it is analysed, finding it by PLR number', async () => {
    expect(
      await action(
        PLATE_RUN_UPDATE_TOOL,
        {
          run: 'PLR-0012',
          name: 'ELISA 3b',
          normalisation: 'z_score',
          hitThreshold: 3,
        },
        { plate_runs: [run] },
      ),
    ).toMatchObject({
      kind: 'plate_run.update',
      runId: 'pr1',
      metadataVersion: 4,
      name: 'ELISA 3b',
      config: {
        normalisation: 'z_score',
        hit: { kind: 'threshold', threshold: 3 },
      },
    })

    const nothing = await buildPlateAssaysProposal(
      PLATE_RUN_UPDATE_TOOL,
      { ...base, run: 'PLR-0012' },
      context({ plate_runs: [run] }),
    )

    expect(nothing.ok).toBe(false)
  })

  it('archives a run', async () => {
    expect(
      await action(
        PLATE_RUN_ARCHIVE_TOOL,
        { run: 'PLR-0012' },
        { plate_runs: [run] },
      ),
    ).toEqual({ kind: 'plate_run.archive', runId: 'pr1' })
  })

  it('creates a design and fills it with samples, controls first', async () => {
    expect(
      await action(
        PLATE_DESIGN_CREATE_TOOL,
        { name: 'New map', format: '384_well' },
        {},
      ),
    ).toEqual({
      kind: 'plate_design.create',
      workspaceId: 'ws',
      name: 'New map',
      format: '384_well',
      projectId: null,
    })

    const filled = await action(
      PLATE_DESIGN_FILL_TOOL,
      {
        design: 'Titration',
        samples: ['S-0001'],
        replicates: 3,
        controls: [{ role: 'negative_control', well: 'a1' }],
      },
      {
        plate_designs: [design],
        records: [{ id: 's1', identifier: 'S-0001', title: 'A' }],
      },
    )

    if (filled.kind !== 'plate_design.fill') throw new Error('wrong card')
    expect(filled.metadataVersion).toBe(2)
    expect(filled.wells.map((well) => well.role)).toEqual([
      'negative_control',
      'sample',
      'sample',
      'sample',
    ])
    expect(filled.wells[1].wellCode).toBe('A2')
  })

  it('does not fill a design with samples that do not exist', async () => {
    const result = await buildPlateAssaysProposal(
      PLATE_DESIGN_FILL_TOOL,
      { ...base, design: 'Titration', samples: ['S-9999'] },
      context({ plate_designs: [design] }),
    )

    expect(result.ok).toBe(false)
  })

  it('saves a design’s layout as a template, and keeps its quality charts', async () => {
    const saved = await action(
      PLATE_LAYOUT_SAVE_TOOL,
      { design: 'Titration', name: 'Titration layout' },
      {
        plate_designs: [design],
        plate_wells: [
          {
            id: 'x',
            design_id: 'd1',
            well_code: 'A1',
            row_index: 0,
            col_index: 0,
            role: 'blank',
          },
        ],
      },
    )

    if (saved.kind !== 'plate_layout.save') throw new Error('wrong card')
    expect(saved).toMatchObject({ name: 'Titration layout', rows: 8, cols: 12 })
    expect(saved.layout.wells).toHaveLength(1)

    expect(
      await action(
        PLATE_QC_TRACK_TOOL,
        { design: 'Titration' },
        { plate_designs: [design] },
      ),
    ).toEqual({
      kind: 'plate_design.track_qc',
      designId: 'd1',
      instrumentId: null,
    })
  })

  it('cancels and finishes a worklist by its WL number', async () => {
    expect(
      await action(
        WORKLIST_CANCEL_TOOL,
        { worklist: 'WL-0004' },
        { plate_worklists: [worklist] },
      ),
    ).toEqual({ kind: 'worklist.cancel', worklistId: 'w1' })

    expect(
      await action(
        WORKLIST_COMPLETE_TOOL,
        {
          worklist: 'WL-0004',
          experiment: 'EXP-0042',
          recordWithdrawals: true,
        },
        {
          plate_worklists: [worklist],
          records: [{ id: 'e1', identifier: 'EXP-0042', title: 'Assay run' }],
        },
      ),
    ).toEqual({
      kind: 'worklist.complete',
      worklistId: 'w1',
      experimentId: 'e1',
      recordWithdrawals: true,
    })

    const noExperiment = await buildPlateAssaysProposal(
      WORKLIST_COMPLETE_TOOL,
      { ...base, worklist: 'WL-0004', recordWithdrawals: true },
      context({ plate_worklists: [worklist] }),
    )

    expect(noExperiment.ok).toBe(false)
  })

  it('finishes a worklist with every planned transfer done', async () => {
    const calls: string[] = []

    const fetchFixture: typeof fetch = async (input, init) => {
      const path = urlOf(input).pathname

      calls.push(`${path} ${String(init?.body ?? '')}`)

      return path.endsWith('plate_worklists')
        ? Response.json([
            {
              id: 'w1',
              transfers: [
                { sourceWell: 'A1', destWell: 'B1', volumeUl: 5, label: 'x' },
              ],
            },
          ])
        : Response.json({})
    }

    await runPlateAssaysAction(createDataClient(fetchFixture), {
      kind: 'worklist.complete',
      worklistId: 'w1',
      experimentId: null,
      recordWithdrawals: false,
    })

    const sent = calls.find((call) => call.includes('complete_plate_worklist'))

    expect(sent).toContain('"movedUl":5')
    expect(sent).toContain('"status":"done"')
  })
})
