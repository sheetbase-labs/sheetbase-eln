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
import { PLANNING_PROPOSE_TOOL_NAMES } from './assistant-planning'
import { runExperimentAction } from './assistant-experiments-run'
import {
  buildExperimentProposal,
  experimentProposalDefs,
  isExperimentProposalTool,
} from './assistant-experiments.server'
import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import { dataClientTestDouble } from './data-client-test-support'

/**
 * A client carrying the one member a test exercises. The functions under test
 * read only the member the stub supplies, never the rest of the client.
 */
function stubClient(calls: Parameters<typeof dataClientTestDouble>[0]) {
  return dataClientTestDouble(calls)
}

const EXP = {
  id: '11111111-1111-4111-8111-111111111111',
  identifier: 'EXP-0012',
  title: 'Titre at day 7',
  kind: 'experiment',
  status: 'draft',
  created_by_user_id: 'u',
}

function context(tables: Partial<Record<string, (query: string) => object[]>>) {
  const client = stubClient({
    list: (resource: string, query?: string) =>
      Promise.resolve(tables[resource]?.(query ?? '') ?? []),
    rpc: vi.fn(() => Promise.resolve({})),
  })

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

  it('turns a start that names a template and project into a template card', async () => {
    const built = await buildExperimentProposal(
      EXPERIMENT_START_TOOL,
      {
        ...base,
        template: 'ELISA standard',
        project: 'Vaccine',
        experimentTitle: 'ELISA run 1',
      },
      context({
        records: () => [
          {
            id: 'tpl-1',
            identifier: 'PRT-0007',
            title: 'ELISA standard',
            kind: 'protocol_template',
            status: 'active',
            project_id: null,
            metadata_version: 1,
            archived_at: null,
            assignee_user_id: null,
          },
        ],
        projects: () => [{ id: 'proj-1', key: 'VAC', title: 'Vaccine' }],
      }),
    )

    expect(built.ok, JSON.stringify(built)).toBe(true)
    expect(built.ok && built.proposal.tool).toBe(
      'sheetbase.experiment.start_from_template',
    )
    expect(built.ok && built.proposal.action).toMatchObject({
      kind: 'experiment.start',
      templateRecordId: 'tpl-1',
      projectId: 'proj-1',
      title: 'ELISA run 1',
    })
  })

  it('gives no two cards the same tool name', () => {
    const names = ASSISTANT_PROPOSE_TOOL_NAMES

    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([])

    for (const name of EXPERIMENT_PROPOSE_TOOL_NAMES) {
      expect(PLANNING_PROPOSE_TOOL_NAMES as readonly string[]).not.toContain(
        name,
      )
    }
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
    const rpc = vi.fn((_name: string) => Promise.resolve({}))
    const client = stubClient({ rpc })

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
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'set_experiment_decision',
      'set_label_template_archived',
    ])
  })
})
