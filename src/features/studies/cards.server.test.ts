import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  STUDIES_PROPOSE_TOOL_NAMES,
  STUDY_ADD_EXPERIMENT_TOOL,
  STUDY_DELIVERABLE_REORDER_TOOL,
  STUDY_DELIVERABLE_UPDATE_TOOL,
  STUDY_DEPENDENCY_ADD_TOOL,
  STUDY_DEPENDENCY_REMOVE_TOOL,
  STUDY_EDIT_TOOL,
  STUDY_TASK_BOOK_TOOL,
  STUDY_TASK_MOVE_DUE_TOOL,
} from './cards'
import { runStudiesAction } from './cards-run'
import { buildStudiesProposal, studiesProposalDefs } from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table by name, and keeps what was asked. */
function context(tables: Record<string, core.util.JSONType[]>) {
  const asked: string[] = []

  const fetchFixture: typeof fetch = async (input) => {
    const url = urlOf(input)

    asked.push(`${url.pathname.split('/').at(-1)}${url.search}`)

    return Response.json(tables[url.pathname.split('/').at(-1) ?? ''] ?? [])
  }

  const value: LabToolContext = {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }

  return { value, asked }
}

const study = {
  id: 'st1',
  identifier: 'STU-0004',
  title: 'Antibody stability',
  kind: 'study',
  metadata_version: 3,
}

const task = (id: string, title: string) => ({
  id,
  title,
  due_at: '2026-12-01T12:00:00Z',
  client_visible: false,
  metadata_version: 2,
  project_id: 'p1',
})

describe('the study and planner cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      studiesProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...STUDIES_PROPOSE_TOOL_NAMES])

    for (const name of STUDIES_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('finds a study by its ID, not only its name', async () => {
    const { value, asked } = context({ records: [study] })

    const result = await buildStudiesProposal(
      STUDY_EDIT_TOOL,
      { ...base, study: 'STU-0004', status: 'completed' },
      value,
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'study.edit',
      id: 'st1',
      metadataVersion: 3,
      status: 'completed',
    })
    expect(asked.join(' ')).toContain('identifier.ilike')
  })

  it('adds an experiment to a study by ID', async () => {
    const { value } = context({
      records: [
        {
          ...study,
          id: 'e1',
          identifier: 'EXP-0012',
          kind: 'experiment',
          title: 'Run',
        },
      ],
    })

    const result = await buildStudiesProposal(
      STUDY_ADD_EXPERIMENT_TOOL,
      { ...base, study: 'STU-0004', experiment: 'EXP-0012' },
      value,
    )

    expect(result.ok).toBe(true)
  })

  it('moves a due date and keeps the reason', async () => {
    const { value } = context({ study_tasks: [task('t1', 'Order antibodies')] })

    const result = await buildStudiesProposal(
      STUDY_TASK_MOVE_DUE_TOOL,
      {
        ...base,
        task: 'Order antibodies',
        dueOn: '2026-12-10',
        reason: 'Supplier delay',
      },
      value,
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'study.task_move_due',
      taskId: 't1',
      metadataVersion: 2,
      dueAt: '2026-12-10T12:00:00Z',
      reason: 'Supplier delay',
      notifyClient: false,
    })
  })

  it('refuses to make a task wait for itself', async () => {
    const { value } = context({ study_tasks: [task('t1', 'Order antibodies')] })

    const result = await buildStudiesProposal(
      STUDY_DEPENDENCY_ADD_TOOL,
      { ...base, before: 'Order antibodies', after: 'Order antibodies' },
      value,
    )

    expect(result.ok).toBe(false)
  })

  it('says so when there is no dependency to remove', async () => {
    const { value } = context({ study_tasks: [task('t1', 'Order')] })

    const result = await buildStudiesProposal(
      STUDY_DEPENDENCY_REMOVE_TOOL,
      { ...base, before: 'Order', after: 'Order' },
      value,
    )

    expect(result.ok).toBe(false)
  })

  it('books an instrument for a task in the person’s time zone', async () => {
    const { value } = context({
      study_tasks: [task('t1', 'Run assay')],
      calendar_resources: [
        { id: 'r1', name: 'Plate reader', code: 'INS-0003' },
      ],
    })

    const result = await buildStudiesProposal(
      STUDY_TASK_BOOK_TOOL,
      {
        ...base,
        task: 'Run assay',
        resource: 'INS-0003',
        startsAt: '2026-07-01T09:00',
        endsAt: '2026-07-01T11:00',
      },
      value,
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'study.task_book',
      resourceId: 'r1',
      startsAt: '2026-07-01T08:00:00.000Z',
      endsAt: '2026-07-01T10:00:00.000Z',
    })
  })

  it('changes a deliverable of a task', async () => {
    const { value } = context({
      study_tasks: [task('t1', 'Run assay')],
      study_deliverables: [
        { id: 'd1', name: 'Raw data', status: 'planned', due_at: null },
      ],
    })

    const result = await buildStudiesProposal(
      STUDY_DELIVERABLE_UPDATE_TOOL,
      {
        ...base,
        task: 'Run assay',
        deliverable: 'Raw data',
        status: 'delivered',
      },
      value,
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'study.deliverable_update',
      id: 'd1',
      status: 'delivered',
    })
  })

  it('needs every deliverable named to reorder them', async () => {
    const { value } = context({
      study_tasks: [task('t1', 'Run assay')],
      study_deliverables: [
        { id: 'd1', name: 'Raw data', status: 'planned', due_at: null },
        { id: 'd2', name: 'Summary', status: 'planned', due_at: null },
        { id: 'd3', name: 'Report', status: 'planned', due_at: null },
      ],
    })

    const partial = await buildStudiesProposal(
      STUDY_DELIVERABLE_REORDER_TOOL,
      { ...base, task: 'Run assay', order: ['Summary', 'Raw data'] },
      value,
    )

    expect(partial.ok).toBe(false)

    const full = await buildStudiesProposal(
      STUDY_DELIVERABLE_REORDER_TOOL,
      { ...base, task: 'Run assay', order: ['Summary', 'Report', 'Raw data'] },
      value,
    )

    if (!full.ok) throw new Error(full.message)
    expect(full.proposal.action).toEqual({
      kind: 'study.deliverable_reorder',
      taskId: 't1',
      ids: ['d2', 'd3', 'd1'],
    })
  })
})

describe('pressing a study card', () => {
  it('calls the ordinary RPC', async () => {
    const rpc = vi.fn(async () => ({}))

    await runStudiesAction(
      { rpc },
      {
        kind: 'study.dependency_add',
        workspaceId: 'ws',
        predecessorId: 'a',
        successorId: 'b',
        dependencyType: 'finish_to_start',
        lagDays: 2,
      },
    )

    expect(rpc).toHaveBeenCalledWith('create_dependency', {
      p_workspace_id: 'ws',
      p_predecessor_id: 'a',
      p_successor_id: 'b',
      p_dependency_type: 'finish_to_start',
      p_lag_days: 2,
      p_is_external: false,
    })
  })

  it('moves a due date with its reason', async () => {
    const rpc = vi.fn(async () => ({}))

    await runStudiesAction(
      { rpc },
      {
        kind: 'study.task_move_due',
        taskId: 't1',
        metadataVersion: 2,
        dueAt: null,
        reason: 'Dropped',
        notifyClient: true,
      },
    )

    expect(rpc).toHaveBeenCalledWith('move_study_task_due', {
      p_task_id: 't1',
      p_expected_metadata_version: 2,
      p_due_at: null,
      p_reason: 'Dropped',
      p_notify_client: true,
    })
  })
})
