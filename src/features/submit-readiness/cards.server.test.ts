import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  SUBMIT_READINESS_PROPOSE_TOOL_NAMES,
  SUBMIT_READINESS_TOOL,
} from './cards'
import { runSubmitReadinessAction } from './cards-run'
import {
  buildSubmitReadinessProposal,
  isSubmitReadinessProposalTool,
  submitReadinessProposalDefs,
} from './cards.server'

const WS = '44444444-4444-4444-8444-444444444444'
const base = { title: 'T', summary: 'S' }

function context(rows: core.util.JSONType[]): LabToolContext {
  const fetchFixture: typeof fetch = async () => Response.json(rows)

  return {
    client: createDataClient(fetchFixture),
    workspaceId: WS,
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

describe('the submit readiness card', () => {
  it('is the one tool the operation declares, offered and known', () => {
    expect([...SUBMIT_READINESS_PROPOSE_TOOL_NAMES]).toEqual([
      SUBMIT_READINESS_TOOL,
    ])
    expect(isSubmitReadinessProposalTool(SUBMIT_READINESS_TOOL)).toBe(true)
    expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(SUBMIT_READINESS_TOOL)

    expect(
      submitReadinessProposalDefs().map((def) =>
        def.name.replaceAll('__', '.'),
      ),
    ).toEqual([SUBMIT_READINESS_TOOL])
  })

  it('says what changes from the rule in force, and writes nothing', async () => {
    const result = await buildSubmitReadinessProposal(
      SUBMIT_READINESS_TOOL,
      { ...base, mode: 'block' },
      context([{ submit_readiness_mode: 'warn' }]),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.deepLink).toBe('/settings/workspace/signatures')

    expect(result.proposal.changes).toEqual([
      {
        label: 'Open steps and no decision',
        before: 'Listed, but the submission goes through',
        after: 'Listed, and the submission is refused until cleared',
      },
    ])

    expect(result.proposal.action).toEqual({
      kind: 'submit_readiness.set',
      workspaceId: WS,
      mode: 'block',
    })
  })

  it('refuses a rule that is already set and a mode that is not one', async () => {
    const same = await buildSubmitReadinessProposal(
      SUBMIT_READINESS_TOOL,
      { ...base, mode: 'warn' },
      context([]),
    )

    expect(same).toEqual({ ok: false, message: 'That is already the rule.' })

    const bad = await buildSubmitReadinessProposal(
      SUBMIT_READINESS_TOOL,
      { ...base, mode: 'maybe' },
      context([]),
    )

    expect(bad.ok).toBe(false)
  })

  it('saves the rule through the ordinary call when the button is pressed', async () => {
    const rpc = vi.fn().mockResolvedValue([])

    const done = await runSubmitReadinessAction(
      { rpc },
      { kind: 'submit_readiness.set', workspaceId: WS, mode: 'off' },
    )

    expect(rpc).toHaveBeenCalledWith('set_submit_readiness_mode', {
      p_workspace_id: WS,
      p_mode: 'off',
    })
    expect(done).toEqual({ openHref: '/settings/workspace/signatures' })
  })
})
