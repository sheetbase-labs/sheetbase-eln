import { describe, expect, it } from 'vitest'

import { agentActionAlwaysNever } from './agent-action-policy'

describe('what agents may never do', () => {
  it('lets an agent delete a group, and nothing else that deletes', () => {
    expect(agentActionAlwaysNever('delete_workspace_group')).toBe(false)
    expect(agentActionAlwaysNever('delete_record')).toBe(true)
    expect(agentActionAlwaysNever('sign_record')).toBe(true)
  })
})
