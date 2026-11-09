import { describe, expect, it, vi } from 'vitest'

import {
  ALIAS_ADD_TOOL,
  EXPERIMENT_DELETE_DRAFT_TOOL,
  EXPERIMENT_PROPOSE_TOOL_NAMES,
  EXPERIMENT_START_TOOL,
  LABEL_TEMPLATE_ARCHIVE_TOOL,
  isExperimentAction,
} from './assistant-experiments'
import type { ExperimentAction } from './assistant-experiments'
import { runExperimentAction } from './assistant-experiments-run'
import {
  buildExperimentProposal,
  experimentProposalDefs,
  isExperimentProposalTool,
} from './assistant-experiments.server'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const EXP = {
  id: '11111111-1111-4111-8111-111111111111',
  identifier: 'EXP-0012',
  title: 'Titre at day 7',
  kind: 'experiment',
  status: 'draft',
  created_by_user_id: 'u',
}

function context(
  tables: Partial<Record<string, (query: string) => unknown[]>>,
) {
  const client = {
    list: (resource: string, query: string) =>
      Promise.resolve(tables[resource]?.(query) ?? []),
    rpc: vi.fn(() => Promise.resolve({})),
  } as unknown as DataClient
  return {
    client,
    workspaceId: 'ws',
    userId: 'u',
    timeZone: 'UTC',
  } satisfies LabToolContext
}

const base = { title: 'Change it', summary: 'As asked' }

describe('experiment, alias and label template assistant cards', () => {
  it('lists every tool with the agent catalogue and the model', () => {
    for (const name of EXPERIMENT_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isExperimentProposalTool(name)).toBe(true)
    }
    expect(experimentProposalDefs()).toHaveLength(
      EXPERIMENT_PROPOSE_TOOL_NAMES.length,
    )
  })

  it('starts only a draft experiment', async () => {
    const draft = await buildExperimentProposal(
      EXPERIMENT_START_TOOL,
      { ...base, experiment: 'EXP-0012' },
      context({ records: () => [EXP] }),
    )
    expect(draft.ok && draft.proposal.action).toEqual({
      kind: 'experiments.start',
      recordId: EXP.id,
      reason: null,
    })
    expect(isExperimentAction({ kind: 'experiments.start' })).toBe(true)
    const running = await buildExperimentProposal(
      EXPERIMENT_START_TOOL,
      { ...base, experiment: 'EXP-0012' },
      context({ records: () => [{ ...EXP, status: 'in_progress' }] }),
    )
    expect(running).toEqual({
      ok: false,
      message: 'EXP-0012 is already In progress.',
    })
  })

  it('deletes only a draft', async () => {
    const built = await buildExperimentProposal(
      EXPERIMENT_DELETE_DRAFT_TOOL,
      { ...base, experiment: 'EXP-0012' },
      context({ records: () => [{ ...EXP, status: 'completed' }] }),
    )
    expect(built.ok).toBe(false)
  })

  it('does not add a name a record already has', async () => {
    const tables = {
      records: () => [EXP],
      record_aliases: () => [{ alias: 'SUP-77' }],
    }
    const again = await buildExperimentProposal(
      ALIAS_ADD_TOOL,
      { ...base, record: 'EXP-0012', alias: 'sup-77' },
      context(tables),
    )
    expect(again.ok).toBe(false)
    const fresh = await buildExperimentProposal(
      ALIAS_ADD_TOOL,
      { ...base, record: 'EXP-0012', alias: 'OLD-3' },
      context(tables),
    )
    expect(fresh.ok && fresh.proposal.action).toEqual({
      kind: 'experiments.alias_add',
      recordId: EXP.id,
      alias: 'OLD-3',
    })
  })

  it('archives a label template that is offered', async () => {
    const built = await buildExperimentProposal(
      LABEL_TEMPLATE_ARCHIVE_TOOL,
      { ...base, template: 'Cryovial', archived: true },
      context({
        label_templates: () => [
          { id: 't1', name: 'Cryovial', archived_at: null },
        ],
      }),
    )
    expect(built.ok && built.proposal.changes[0]).toEqual({
      label: 'Offered when printing',
      before: 'Yes',
      after: 'No',
    })
  })

  it('runs each card through its own call', async () => {
    const rpc = vi.fn(() => Promise.resolve({}))
    const client = { rpc } as unknown as DataClient
    const run = (action: ExperimentAction) =>
      runExperimentAction(client, action)
    await run({
      kind: 'experiments.outcome',
      recordId: EXP.id,
      outcome: 'supported',
      notes: null,
    })
    await run({
      kind: 'experiments.label_archive',
      templateId: 't1',
      archived: true,
    })
    expect(rpc.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      'set_experiment_decision',
      'set_label_template_archived',
    ])
  })
})
