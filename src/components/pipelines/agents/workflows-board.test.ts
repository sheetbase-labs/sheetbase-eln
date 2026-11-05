import { describe, expect, it } from 'vitest'

import { workflowOrder } from './workflows-board'
import type { AgentDefinition, AgentRun } from '#/lib/agent-registry'

const def = (id: string, enabled = true) => ({ id, enabled }) as AgentDefinition
const run = (definition_id: string, started_at: string) =>
  ({ definition_id, started_at }) as AgentRun

describe('workflowOrder', () => {
  it('lists the most recently run first and paused workflows last', () => {
    const ordered = workflowOrder(
      [def('a'), def('b', false), def('c'), def('d')],
      [
        run('c', '2026-09-25T10:12:00Z'),
        run('a', '2026-09-24T10:00:00Z'),
        run('b', '2026-09-26T10:00:00Z'),
      ],
    )
    expect(ordered.map((d) => d.id)).toEqual(['c', 'a', 'd', 'b'])
  })
})
