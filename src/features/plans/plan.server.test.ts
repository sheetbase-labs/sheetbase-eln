import { describe, expect, it, vi } from 'vitest'

import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { testClient } from '#/lib/mcp/test-transport'
import type { DataClient } from '#/lib/data-client'

import { PLAN_TOOL } from './plan'
import {
  buildPlanProposal,
  isPlanProposalTool,
  planProposalDefs,
  planStepTools,
} from './plan.server'

const WS = '44444444-4444-4444-8444-444444444444'

function context(levels: Record<string, string> = {}): LabToolContext {
  const rpc = vi
    .fn<DataClient['rpc']>()
    .mockImplementation(
      async (_name, args) => levels[String(args.p_action_key)] ?? 'ask',
    )

  const client = testClient({ rpc })

  return { client, workspaceId: WS, userId: 'me', timeZone: 'Europe/London' }
}

const base = { title: 'PicoGreen assay', summary: 'Set it up.' }

const steps = [
  {
    title: 'Create the experiment',
    tool: 'sheetbase.planner.plan_experiment',
    arguments: { experimentTitle: 'PicoGreen assay' },
  },
  {
    title: 'Log ten samples',
    tool: 'sheetbase.sample.log',
    arguments: { experiment: 'PicoGreen assay' },
  },
  {
    title: 'Analyse the plate',
    tool: 'sheetbase.plate.analyse',
    arguments: {},
  },
]

describe('plan card', () => {
  it('is offered to the model as one tool', () => {
    expect(isPlanProposalTool(PLAN_TOOL)).toBe(true)
    expect(planProposalDefs().map((def) => def.name)).toEqual([
      PLAN_TOOL.replaceAll('.', '__'),
    ])
  })

  it('carries every step and the workspace rules for this person', async () => {
    const built = await buildPlanProposal({ ...base, steps }, context())

    if (!built.ok) throw new Error(built.message)
    const action = built.proposal.action

    expect(action?.kind).toBe('plan.run')

    if (action?.kind !== 'plan.run') throw new Error('not a plan')
    expect(action.steps.map((step) => step.key)).toEqual([
      'step-1',
      'step-2',
      'step-3',
    ])

    expect(action.pauseDestructive).toBe(true)
    expect(action.runAllAllowed).toBe(false)
    expect(built.proposal.changes).toHaveLength(3)
  })

  it('accepts a step tool written the provider way', async () => {
    const built = await buildPlanProposal(
      {
        ...base,
        steps: [
          {
            title: 'Start it',
            tool: 'sheetbase__project__create',
            arguments: {},
          },
        ],
      },
      context(),
    )

    if (!built.ok) throw new Error(built.message)
    expect(built.proposal.changes).toHaveLength(1)
  })

  it('follows the admin’s settings', async () => {
    const built = await buildPlanProposal(
      { ...base, steps },
      context({ plan_pause_destructive: 'auto', plan_run_all: 'auto' }),
    )

    if (!built.ok || built.proposal.action?.kind !== 'plan.run')
      throw new Error('not a plan')
    expect(built.proposal.action.pauseDestructive).toBe(false)
    expect(built.proposal.action.runAllAllowed).toBe(true)
  })

  it('marks destructive steps', async () => {
    const built = await buildPlanProposal(
      {
        ...base,
        steps: [
          steps[0],
          { title: 'Dispose', tool: 'sheetbase.sample.dispose', arguments: {} },
        ],
      },
      context(),
    )

    if (!built.ok || built.proposal.action?.kind !== 'plan.run')
      throw new Error('not a plan')
    expect(built.proposal.action.steps.map((step) => step.destructive)).toEqual(
      [false, true],
    )

    expect(built.proposal.changes[1].after).toBe('Waits for your OK')
  })

  it('refuses destructive steps when the workspace says never', async () => {
    const built = await buildPlanProposal(
      {
        ...base,
        steps: [
          steps[0],
          { title: 'Dispose', tool: 'sheetbase.sample.dispose', arguments: {} },
        ],
      },
      context({ plan_pause_destructive: 'never' }),
    )

    expect(built.ok).toBe(false)
  })

  it('keeps a person’s own decisions out', async () => {
    const built = await buildPlanProposal(
      {
        ...base,
        steps: [
          steps[0],
          {
            title: 'Decide',
            tool: 'sheetbase.agent_request.decide',
            arguments: {},
          },
        ],
      },
      context(),
    )

    expect(built.ok).toBe(false)
  })

  it('refuses a tool that is not a card tool, or another plan', async () => {
    for (const tool of ['sheetbase.nope.nothing', PLAN_TOOL]) {
      const built = await buildPlanProposal(
        { ...base, steps: [steps[0], { title: 'x', tool, arguments: {} }] },
        context(),
      )

      expect(built.ok).toBe(false)
    }
  })

  it('refuses malformed input', async () => {
    expect((await buildPlanProposal(null, context())).ok).toBe(false)
    expect(
      (await buildPlanProposal({ ...base, steps: [] }, context())).ok,
    ).toBe(false)
  })

  it('lists the card tools a step may use', () => {
    const tools = planStepTools()

    expect(tools.has('sheetbase.sample.log')).toBe(true)
    expect(tools.has('sheetbase.planner.plan_experiment')).toBe(true)
    expect(tools.has(PLAN_TOOL)).toBe(false)
  })
})
