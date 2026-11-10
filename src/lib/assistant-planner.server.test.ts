import { describe, expect, it } from 'vitest'

import {
  PLAN_TOOL,
  PLANNER_PROPOSE_TOOL_NAMES,
  isPlannerAction,
} from './assistant-planner'
import {
  buildPlannerProposal,
  isPlannerProposalTool,
  plannerProposalDefs,
} from './assistant-planner.server'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import { createDataClient } from './data-client'

const PROJECT = { id: 'proj-1', title: 'Cell assays', key: 'CA' }

function context(
  rows: Partial<Record<string, unknown[]>> = {},
): LabToolContext {
  // A real data client over the read boundary the tools use, so the rows named
  // below are what those reads answer.
  const client = createDataClient(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://app.test',
    )

    const resource = url.pathname.replace('/api/db/', '')

    return Response.json(
      rows[resource] ?? (resource === 'projects' ? [PROJECT] : []),
    )
  })

  return { client, workspaceId: 'w', userId: 'u', timeZone: 'UTC' }
}

const base = {
  title: 'Plan the dose response',
  summary: 'A blank experiment with two parts',
  goal: 'Dose response of compound X',
  project: 'Cell assays',
  experimentTitle: 'Compound X dose response',
  parts: [{ title: 'Seed' }, { title: 'Read', gate: 'block' as const }],
}

describe('planner assistant card', () => {
  it('registers the tool with the agent catalogue and the model', () => {
    for (const name of PLANNER_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isPlannerProposalTool(name)).toBe(true)
    }

    expect(plannerProposalDefs().map((d) => d.name)).toEqual(
      PLANNER_PROPOSE_TOOL_NAMES.map((n) => n.replaceAll('.', '__')),
    )
  })

  it('proposes creating the experiment in the named project', async () => {
    const built = await buildPlannerProposal(PLAN_TOOL, base, context())
    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.action).toMatchObject({
      kind: 'plan.apply',
      projectId: 'proj-1',
      plan: { experiment: { title: 'Compound X dose response' } },
    })
    expect(isPlannerAction(built.proposal.action ?? { kind: '' })).toBe(true)
  })

  it('has no card for a project that does not exist', async () => {
    const built = await buildPlannerProposal(
      PLAN_TOOL,
      base,
      context({ projects: [] }),
    )

    expect(built.ok).toBe(false)
  })
})
