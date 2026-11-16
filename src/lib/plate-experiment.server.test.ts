import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'
import { defaultAssayConfig } from './plate-assay'
import {
  PLATE_EXPERIMENT_PROPOSE_TOOL_NAMES,
  PLATE_REMEMBER_TOOL,
  isPlateExperimentAction,
} from './plate-experiment'
import {
  buildPlateExperimentProposal,
  isPlateExperimentProposalTool,
  plateExperimentProposalDefs,
} from './plate-experiment.server'

const RUN = {
  id: '11111111-1111-4111-8111-111111111111',
  number: 7,
  name: 'PicoGreen plate 2',
  status: 'analysed',
  record_id: null,
  design_id: null,
  config: defaultAssayConfig(),
  wells: [
    ...'ABCDEFGH'.split('').map((row) => ({
      wellCode: `${row}1`,
      role: 'negative_control',
    })),
    ...'ABCDEFGH'.split('').map((row) => ({
      wellCode: `${row}12`,
      role: 'positive_control',
    })),
  ],
}

function context(designs: readonly unknown[]): LabToolContext {
  const client: DataClient = {
    list: async <T>(resource: string): Promise<T[]> =>
      // SAFETY: the lookups read the rows this suite's fixture supplies, decoded by the tool itself.
      (resource === 'plate_runs'
        ? [RUN]
        : resource === 'plate_designs'
          ? [...designs]
          : []) as T[],
    count: async () => 0,
    rpc: async <T>(): Promise<T> => {
      // SAFETY: a proposal only reads; no rpc answer is read by this suite.
      return {} as T
    },
    insert: async <T>(): Promise<T> => {
      // SAFETY: a proposal writes nothing; no insert answer is read by this suite.
      return {} as T
    },
    patch: async <T>(): Promise<T[]> => [],
    remove: async () => [],
  }

  return { client, workspaceId: 'w1', userId: 'u', timeZone: 'UTC' }
}

const args = {
  title: 'Remember PicoGreen',
  summary: 'Keep the controls and settings for the next plate',
  run: 'PLR-0007',
}

describe('the plate in experiment cards', () => {
  it('registers both tools with the agent catalogue and the model', () => {
    for (const name of PLATE_EXPERIMENT_PROPOSE_TOOL_NAMES)
      expect(isPlateExperimentProposalTool(name)).toBe(true)

    // Remembering a setup is a declared operation, so the catalogue lists it.
    expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(PLATE_REMEMBER_TOOL)

    expect(plateExperimentProposalDefs()).toHaveLength(
      PLATE_EXPERIMENT_PROPOSE_TOOL_NAMES.length,
    )
  })

  it('proposes remembering the run on an existing design, with its controls', async () => {
    const outcome = await buildPlateExperimentProposal(
      PLATE_REMEMBER_TOOL,
      { ...args, design: 'PicoGreen' },
      context([{ id: 'd1', name: 'PicoGreen' }]),
    )

    expect(outcome.ok).toBe(true)

    if (!outcome.ok) return

    expect(outcome.proposal.action).toMatchObject({
      kind: 'plate.remember_setup',
      runId: RUN.id,
      designId: 'd1',
      designName: 'PicoGreen',
    })
    expect(
      isPlateExperimentAction(outcome.proposal.action ?? { kind: '' }),
    ).toBe(true)

    const remembers = outcome.proposal.changes.find(
      (c) => c.label === 'Remembers',
    )

    expect(remembers?.after).toContain('negative control in 1')
    expect(remembers?.after).toContain('positive control in 12')
  })

  it('proposes a new assay when no design has that name', async () => {
    const outcome = await buildPlateExperimentProposal(
      PLATE_REMEMBER_TOOL,
      { ...args, design: 'Brand new assay' },
      context([]),
    )

    expect(outcome.ok).toBe(true)

    if (!outcome.ok) return

    expect(outcome.proposal.action).toMatchObject({
      designId: null,
      designName: 'Brand new assay',
      workspaceId: 'w1',
    })
  })

  it('asks for a name when the run follows no design and none is given', async () => {
    const outcome = await buildPlateExperimentProposal(
      PLATE_REMEMBER_TOOL,
      args,
      context([]),
    )

    expect(outcome.ok).toBe(false)

    if (outcome.ok) return

    expect(outcome.message).toContain('follows no assay design')
  })

  it('asks which design when the name is ambiguous', async () => {
    const outcome = await buildPlateExperimentProposal(
      PLATE_REMEMBER_TOOL,
      { ...args, design: 'Pico' },
      context([
        { id: 'a', name: 'PicoGreen v1' },
        { id: 'b', name: 'PicoGreen v2' },
      ]),
    )

    expect(outcome.ok).toBe(false)

    if (outcome.ok) return

    expect(outcome.message).toContain('More than one assay design')
  })
})
