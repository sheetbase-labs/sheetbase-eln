// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  agentActionArea,
  agentActionLevelsFor,
  resolveAgentActionLevel,
} from '#/lib/agent-action-policy'

describe('agents and AI on the permissions list', () => {
  it('groups agent actions together, and leaves reagent orders with stock', () => {
    for (const key of [
      'set_agent_action_policy',
      'set_agent_definition_enabled',
      'disable_agent_operation_policy',
      'run_lab_watcher',
      'update_workspace_ai_settings',
    ]) {
      expect(agentActionArea(key)).toBe('Agents and AI')
    }
    expect(agentActionArea('request_reagent_order')).toBe('Orders and stock')
    expect(agentActionArea('cancel_reagent_order')).toBe('Orders and stock')
  })

  it('never offers or answers Auto for a change to agent permissions', () => {
    expect(agentActionLevelsFor('set_agent_action_policy')).not.toContain(
      'auto',
    )
    expect(agentActionLevelsFor('start_stocktake')).toContain('auto')
    const auto = [
      {
        action_key: 'set_agent_action_policy',
        subject_kind: 'everyone' as const,
        role: null,
        credential_id: null,
        level: 'auto' as const,
      },
    ]
    expect(resolveAgentActionLevel(auto, 'set_agent_action_policy')).toBe('ask')
  })
})
