import { describe, expect, it, vi } from 'vitest'

import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { DataClient } from '#/lib/data-client'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'

import { AGENT_POLICY_PROPOSE_TOOL_NAMES } from './cards'
import { runAgentPolicyAction } from './cards-run'
import {
  agentPolicyProposalDefs,
  buildAgentPolicyProposal,
  isAgentPolicyProposalTool,
} from './cards.server'

const WS = '44444444-4444-4444-8444-444444444444'
const base = { title: 'T', summary: 'S' }

type Rows = Partial<Record<string, Array<Record<string, unknown>>>>

function context(rows: Rows): LabToolContext {
  const client = {
    list: (resource: string) => Promise.resolve(rows[resource] ?? []),
    rpc: () => Promise.resolve([]),
  } as unknown as DataClient
  return { client, workspaceId: WS, userId: 'me', timeZone: 'Europe/London' }
}

describe('agent permission cards', () => {
  it('offers a definition for every tool the operations declare', () => {
    const defs = agentPolicyProposalDefs().map((def) =>
      def.name.replaceAll('__', '.'),
    )
    expect([...defs].sort()).toEqual(
      [...AGENT_POLICY_PROPOSE_TOOL_NAMES].sort(),
    )
    for (const name of AGENT_POLICY_PROPOSE_TOOL_NAMES) {
      expect(isAgentPolicyProposalTool(name)).toBe(true)
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
    }
  })

  it('sets an action to Never, showing what it was', async () => {
    const built = await buildAgentPolicyProposal(
      'sheetbase.agent_permission.set',
      { ...base, action: 'start_stocktake', level: 'never' },
      context({
        agent_action_policies: [
          {
            action_key: 'start_stocktake',
            subject_kind: 'everyone',
            role: null,
            credential_id: null,
            level: 'auto',
          },
        ],
      }),
    )
    expect(built).toMatchObject({
      ok: true,
      proposal: {
        changes: [{ before: 'Auto: runs straight away', after: 'Never' }],
        action: {
          kind: 'agent_permission.set',
          workspaceId: WS,
          actionKey: 'start_stocktake',
          level: 'never',
          role: null,
        },
      },
    })
  })

  it('never offers Auto for a change to agent permissions', async () => {
    const built = await buildAgentPolicyProposal(
      'sheetbase.agent_permission.set',
      { ...base, action: 'set_agent_action_policy', level: 'auto' },
      context({}),
    )
    expect(built.ok).toBe(false)
  })

  it('refuses to open an action that is always a person’s', async () => {
    const built = await buildAgentPolicyProposal(
      'sheetbase.agent_permission.set',
      { ...base, action: 'sign_record', level: 'auto' },
      context({}),
    )
    expect(built).toMatchObject({ ok: false })
  })

  it('switches an agent off, and says when it already is', async () => {
    const agents = [
      { id: 'a1', display_id: 'AG-0001', name: 'Range checker', enabled: true },
    ]
    expect(
      await buildAgentPolicyProposal(
        'sheetbase.agent.switch',
        { ...base, agent: 'AG-0001', enabled: false },
        context({ agent_definitions: agents }),
      ),
    ).toMatchObject({
      ok: true,
      proposal: {
        changes: [{ before: 'On', after: 'Off' }],
        action: { kind: 'agent.switch', definitionId: 'a1', enabled: false },
      },
    })
    expect(
      await buildAgentPolicyProposal(
        'sheetbase.agent.switch',
        { ...base, agent: 'Range checker', enabled: true },
        context({ agent_definitions: agents }),
      ),
    ).toMatchObject({ ok: false })
  })

  it('decides a waiting request with what it asks for on the card', async () => {
    const built = await buildAgentPolicyProposal(
      'sheetbase.agent_request.decide',
      { ...base, request: 'stocktake', approve: true },
      context({
        agent_action_requests: [
          {
            id: 'r1',
            action_key: 'start_stocktake',
            arguments: { p_location: 'Freezer 2' },
            summary: 'Start a stocktake of Freezer 2',
            status: 'pending',
          },
        ],
      }),
    )
    expect(built).toMatchObject({
      ok: true,
      proposal: {
        action: {
          kind: 'agent_request.decide',
          requestId: 'r1',
          actionKey: 'start_stocktake',
          approve: true,
        },
      },
    })
  })

  it('switches only the AI features named, keeping the rest', async () => {
    const built = await buildAgentPolicyProposal(
      'sheetbase.ai_features.set',
      { ...base, features: { mcp_lab: false } },
      context({
        workspace_settings: [
          {
            ai_feature_flags: {
              assistant: true,
              mcp_read: true,
              mcp_draft: true,
              mcp_workflow: false,
              mcp_admin_read: false,
              mcp_admin_propose: false,
              mcp_lab: true,
            },
          },
        ],
      }),
    )
    expect(built).toMatchObject({
      ok: true,
      proposal: {
        changes: [{ before: 'On', after: 'Off' }],
        action: {
          kind: 'ai_features.set',
          features: { assistant: true, mcp_read: true, mcp_lab: false },
        },
      },
    })
  })
})

describe('running a card', () => {
  it('calls the ordinary RPC as the person', async () => {
    const rpc = vi.fn().mockResolvedValue({})
    const client = { rpc } as unknown as DataClient
    await runAgentPolicyAction(client, {
      kind: 'agent_permission.set',
      workspaceId: WS,
      actionKey: 'start_stocktake',
      level: 'never',
      role: 'scientist',
    })
    expect(rpc).toHaveBeenCalledWith('set_agent_action_policy', {
      p_workspace_id: WS,
      p_action_key: 'start_stocktake',
      p_level: 'never',
      p_subject_kind: 'role',
      p_role: 'scientist',
      p_credential_id: null,
    })
  })

  it('approves a request and runs it, then records how it ended', async () => {
    const rpc = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const client = { rpc } as unknown as DataClient
    await runAgentPolicyAction(client, {
      kind: 'agent_request.decide',
      requestId: 'r1',
      actionKey: 'start_stocktake',
      arguments: { p_location: 'Freezer 2' },
      approve: true,
      reason: null,
    })
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'decide_agent_action',
      'start_stocktake',
      'finish_agent_action',
    ])
  })
})
