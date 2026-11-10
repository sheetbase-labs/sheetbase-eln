import { describe, expect, it } from 'vitest'

import { workflowOrder } from './workflows-board'
import type { AgentDefinition, AgentRun } from '#/lib/agent-registry'

const def = (id: string, enabled = true): AgentDefinition => ({
  id,
  enabled,
  workspace_id: 'workspace-1',
  display_id: id,
  name: id,
  kind: 'rule',
  description: '',
  trigger_label: 'Daily',
  project_ids: [],
  owner_user_id: null,
  model_label: null,
  reads: [],
  proposes: null,
  policy: {
    read: 'allowed',
    notebook_blocks: 'never',
    dataset_flags: 'never',
    create_records: 'never',
    messages: 'never',
  },
  updated_at: '2026-09-25T10:00:00Z',
})

const run = (definition_id: string, started_at: string): AgentRun => ({
  definition_id,
  started_at,
  id: `${definition_id}-run`,
  run_number: 1,
  outcome: 'no_change',
  summary: '',
  detail: '',
  proposal_id: null,
})

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
