import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  PIPELINE_START_RULES_TOOL,
  PIPELINE_STARTS_PROPOSE_TOOL_NAMES,
} from './cards'
import { runPipelineStartsAction } from './cards-run'
import {
  buildStartRulesProposal,
  isStartRulesProposalTool,
  startRulesProposalDefs,
} from './cards.server'

const WS = '44444444-4444-4444-8444-444444444444'
const PL = '55555555-5555-4555-8555-555555555555'
const base = { title: 'T', summary: 'S', pipeline: 'Step yield' }

type Rows = Partial<Record<string, core.util.JSONType[]>>

function context(rows: Rows): LabToolContext {
  const fetchFixture: typeof fetch = async (input) => {
    const target = input instanceof Request ? input.url : input
    const name = new URL(target, 'http://localhost').pathname.split('/').at(-1)

    return Response.json(rows[name ?? ''] ?? [])
  }

  return {
    client: createDataClient(fetchFixture),
    workspaceId: WS,
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const pipeline = {
  id: PL,
  key: 'step_yield',
  name: 'Step yield',
  lifecycle: 'active',
}

describe('the start-rules card', () => {
  it('is the one tool the operation declares, offered and known', () => {
    expect([...PIPELINE_STARTS_PROPOSE_TOOL_NAMES]).toEqual([
      PIPELINE_START_RULES_TOOL,
    ])
    expect(isStartRulesProposalTool(PIPELINE_START_RULES_TOOL)).toBe(true)
    expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(PIPELINE_START_RULES_TOOL)

    expect(
      startRulesProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([PIPELINE_START_RULES_TOOL])
  })

  it('rejects malformed input', async () => {
    const result = await buildStartRulesProposal(
      PIPELINE_START_RULES_TOOL,
      { hours: 3 },
      context({}),
    )

    expect(result.ok).toBe(false)
  })

  it('shows only what changes, in the person’s time zone, and keeps the rest', async () => {
    const result = await buildStartRulesProposal(
      PIPELINE_START_RULES_TOOL,
      {
        ...base,
        hours: { days: 'weekdays', from: '07:00', to: '19:00' },
        minNewRows: 8,
      },
      context({
        pipeline_definitions: [
          { ...pipeline, start_rules: { waitMinutes: 2 } },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    const { proposal } = result

    expect(proposal.target).toBe('Step yield · Starts and runs')
    expect(proposal.deepLink).toBe(`/pipelines/${PL}/starts`)

    expect(proposal.changes).toEqual([
      {
        label: 'Hours',
        before: 'any time',
        after: 'weekdays 07:00–19:00 (Europe/London)',
      },
      { label: 'New rows', before: 'no minimum', after: 'at least 8' },
    ])

    expect(proposal.action).toMatchObject({
      kind: 'pipeline.start_rules',
      definitionId: PL,
      rules: {
        waitMinutes: 2,
        minNewRows: 8,
        window: { timeZone: 'Europe/London', days: 'weekdays' },
      },
    })
  })

  it('refuses hours that close before they open and rules that are already set', async () => {
    const backwards = await buildStartRulesProposal(
      PIPELINE_START_RULES_TOOL,
      { ...base, hours: { days: 'daily', from: '19:00', to: '07:00' } },
      context({ pipeline_definitions: [{ ...pipeline, start_rules: {} }] }),
    )

    expect(backwards.ok).toBe(false)

    const same = await buildStartRulesProposal(
      PIPELINE_START_RULES_TOOL,
      { ...base, waitMinutes: 0 },
      context({ pipeline_definitions: [{ ...pipeline, start_rules: {} }] }),
    )

    expect(same).toEqual({ ok: false, message: 'Those are already the rules.' })
  })

  it('saves the rules through the ordinary call when the button is pressed', async () => {
    const rpc = vi.fn().mockResolvedValue([])
    const client = { rpc }

    const done = await runPipelineStartsAction(client, {
      kind: 'pipeline.start_rules',
      workspaceId: WS,
      definitionId: PL,
      rules: { waitMinutes: 2 },
    })

    expect(rpc).toHaveBeenCalledWith('set_pipeline_start_rules', {
      p_workspace_id: WS,
      p_definition_id: PL,
      p_rules: { waitMinutes: 2 },
    })
    expect(done).toEqual({ openHref: `/pipelines/${PL}/starts` })
  })
})
