import { describe, expect, it } from 'vitest'

import {
  CAMPAIGN_APPROVE_TOOL,
  CAMPAIGN_RESULTS_TOOL,
  CAMPAIGN_START_TOOL,
  MODEL_FEATURE_TOOL,
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
import type { DataClient } from './data-client'

const RECORD = { id: 'rec-1', identifier: 'CMP-0001', title: 'Buffer screen' }
const CAMPAIGN = {
  record_id: 'rec-1',
  status: 'draft',
  layout: { plateFormat: '96_well', worklistFormat: 'csv' },
  objectives: [{ key: 'yield', label: 'Yield', direction: 'maximise' }],
}
const ROUND = {
  id: 'round-1',
  number: 2,
  status: 'approved',
  trials: [{ trial: 1 }, { trial: 2 }],
}

function context(
  rows: Partial<Record<string, unknown[]>> = {},
): LabToolContext {
  const defaults: Record<string, unknown[] | undefined> = {
    model_capabilities: [{ model_key: 'campaign', capability: 'campaigns' }],
    record_models: [{ key: 'campaign', name: 'Campaign' }],
    records: [RECORD],
    campaigns: [CAMPAIGN],
    campaign_rounds: [ROUND],
  }
  const client = {
    list: (resource: string) =>
      Promise.resolve(rows[resource] ?? defaults[resource] ?? []),
  } as unknown as DataClient
  return { client, workspaceId: 'w', userId: 'u', timeZone: 'UTC' }
}
const base = {
  title: 'Do it',
  summary: 'A short summary',
  campaign: 'CMP-0001',
}

describe('planner assistant cards', () => {
  it('registers every tool with the agent catalogue and the model', () => {
    for (const name of PLANNER_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isPlannerProposalTool(name)).toBe(true)
    }
    expect(plannerProposalDefs().map((d) => d.name)).toEqual(
      PLANNER_PROPOSE_TOOL_NAMES.map((n) => n.replaceAll('.', '__')),
    )
  })

  it('proposes switching a feature on for a model, by name', async () => {
    const input = {
      title: 'Campaigns for assays',
      summary: 'Let assay records be campaigns',
      model: 'assay',
      feature: 'Campaigns',
      enabled: true,
    }
    const ctx = context({
      record_models: [{ key: 'assay', name: 'Assay' }],
      model_capabilities: [],
    })
    const built = await buildPlannerProposal(MODEL_FEATURE_TOOL, input, ctx)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.proposal.action).toEqual({
      kind: 'model.feature',
      modelKey: 'assay',
      feature: 'campaigns',
      enabled: true,
    })
    expect(isPlannerAction(built.proposal.action ?? { kind: '' })).toBe(true)
    // Switching off what is already off, and a feature that does not exist, have no card.
    const already = await buildPlannerProposal(
      MODEL_FEATURE_TOOL,
      { ...input, enabled: false },
      ctx,
    )
    expect(already.ok).toBe(false)
    const unknown = await buildPlannerProposal(
      MODEL_FEATURE_TOOL,
      { ...input, feature: 'Teleportation' },
      ctx,
    )
    expect(unknown.ok).toBe(false)
  })

  it('proposes starting a campaign that is not running', async () => {
    const built = await buildPlannerProposal(
      CAMPAIGN_START_TOOL,
      base,
      context(),
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.proposal.action).toEqual({
      kind: 'campaign.start',
      recordId: 'rec-1',
    })
    expect(isPlannerAction(built.proposal.action ?? { kind: '' })).toBe(true)
    const running = await buildPlannerProposal(
      CAMPAIGN_START_TOOL,
      base,
      context({ campaigns: [{ ...CAMPAIGN, status: 'active' }] }),
    )
    expect(running.ok).toBe(false)
  })

  it('has no card for a record with no design, or a round that is not waiting', async () => {
    const none = await buildPlannerProposal(
      CAMPAIGN_START_TOOL,
      base,
      context({ campaigns: [] }),
    )
    expect(none.ok).toBe(false)
    const wrong = await buildPlannerProposal(
      CAMPAIGN_APPROVE_TOOL,
      base,
      context(),
    )
    expect(wrong.ok).toBe(false)
  })

  it('turns objective names and condition numbers into results, and refuses unknown ones', async () => {
    const built = await buildPlannerProposal(
      CAMPAIGN_RESULTS_TOOL,
      {
        ...base,
        results: [
          { condition: 1, values: [{ objective: 'yield', value: 71 }] },
        ],
      },
      context(),
    )
    expect(built.ok).toBe(true)
    if (built.ok)
      expect(built.proposal.action).toEqual({
        kind: 'campaign.results',
        roundId: 'round-1',
        recordId: 'rec-1',
        results: [{ trial: 1, results: { yield: 71 } }],
      })
    const bad = await buildPlannerProposal(
      CAMPAIGN_RESULTS_TOOL,
      {
        ...base,
        results: [{ condition: 9, values: [{ objective: 'yield', value: 1 }] }],
      },
      context(),
    )
    expect(bad.ok).toBe(false)
    const badObjective = await buildPlannerProposal(
      CAMPAIGN_RESULTS_TOOL,
      {
        ...base,
        results: [
          { condition: 1, values: [{ objective: 'purity', value: 1 }] },
        ],
      },
      context(),
    )
    expect(badObjective.ok).toBe(false)
  })
})
