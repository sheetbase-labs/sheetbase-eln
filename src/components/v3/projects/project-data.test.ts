import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createProject,
  updateProjectDetails,
  fetchProjectActivity,
  useProjectMilestones,
} from './project-data'

const { rpc, list } = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }))
vi.mock('#/lib/data-client', () => ({
  createDataClient: () => ({ rpc, list }),
}))

beforeEach(() => vi.resetAllMocks())

const details = {
  title: '  AAV5 capsid screening  ',
  clientId: 'client-21',
  modality: 'AAV5',
  stage: 'Feasibility',
  leadUserId: 'gareth',
  defaultReviewerUserId: 'mei',
  agreementReference: 'AGR-017',
  startedOn: '2026-08-03',
}
const expected = {
  p_title: 'AAV5 capsid screening',
  p_client_id: 'client-21',
  p_modality: 'AAV5',
  p_stage: 'Feasibility',
  p_lead_user_id: 'gareth',
  p_default_reviewer_user_id: 'mei',
  p_agreement_reference: 'AGR-017',
  p_started_on: '2026-08-03',
}

describe('canonical typed project callers', () => {
  it('preserves each task timezone for milestone and deliverable due instants', async () => {
    const due = '2026-09-28T23:00:00+00:00'
    list
      .mockResolvedValueOnce([
        {
          id: 'london',
          task_type: 'milestone',
          title: 'Clarification train',
          status: 'not_started',
          due_at: due,
          timezone: 'Europe/London',
        },
        {
          id: 'utc',
          task_type: 'task',
          title: 'UTC task',
          status: 'not_started',
          due_at: due,
          timezone: 'UTC',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'utc-deliverable',
          task_id: 'utc',
          name: 'UTC deliverable',
          status: 'planned',
          due_at: due,
        },
        {
          id: 'london-deliverable',
          task_id: 'london',
          name: 'London deliverable',
          status: 'planned',
          due_at: due,
        },
      ])
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result, unmount } = renderHook(
      () => useProjectMilestones('project-1'),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client }, children),
      },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'london',
          dueAt: due,
          timezone: 'Europe/London',
        }),
        expect.objectContaining({
          id: 'london-deliverable',
          dueAt: due,
          timezone: 'Europe/London',
        }),
        expect.objectContaining({
          id: 'utc-deliverable',
          dueAt: due,
          timezone: 'UTC',
        }),
      ]),
    )
    expect(list.mock.calls[0][1]).toContain('due_at,timezone')
    expect(list.mock.calls[1][1]).toContain('select=id,task_id,')
    unmount()
    client.clear()
  })

  it('creates with every typed property and returns the canonical identity', async () => {
    rpc.mockResolvedValue({ id: 'new-project', revision: '1' })
    expect(await createProject(details)).toEqual({
      id: 'new-project',
      revision: '1',
    })
    expect(rpc).toHaveBeenCalledWith('create_project', expected)
  })

  it('preserves a full replacement snapshot and exact optimistic revision', async () => {
    await updateProjectDetails(
      { id: 'project-1', revision: '9007199254740993' },
      details,
    )
    expect(rpc).toHaveBeenCalledWith('update_project_details', {
      p_project_id: 'project-1',
      p_expected_revision: '9007199254740993',
      ...expected,
    })
  })

  it('clears properties only explicitly and surfaces server stale/denial without retry', async () => {
    const error = new Error('SB001: stale project revision')
    rpc.mockRejectedValue(error)
    await expect(
      updateProjectDetails(
        { id: 'project-1', revision: '2' },
        { ...details, clientId: null, startedOn: null },
      ),
    ).rejects.toBe(error)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_client_id: null,
      p_started_on: null,
      p_modality: 'AAV5',
      p_lead_user_id: 'gareth',
    })
  })

  it('reads activity by exact project scope, not an unscoped object/name search', async () => {
    list.mockResolvedValue([])
    expect(await fetchProjectActivity('project-1')).toEqual([])
    expect(list).toHaveBeenCalledWith(
      'change_events',
      expect.stringContaining(
        '?project_id=eq.project-1&order=sequence.desc&limit=3',
      ),
    )
  })

  it('resolves current readable identities separately without rewriting historical evidence', async () => {
    const payload = {
      title: 'Historical title',
      changes: { status: { to: 'done' } },
    }
    const event = {
      id: 'event-1',
      sequence: '17',
      entity_type: 'record',
      entity_uuid: 'record-1',
      operation: 'update',
      record_id: 'record-1',
      actor_user_id: 'actor-1',
      payload,
      created_at: '2026-10-04T10:00:00Z',
    }
    list
      .mockResolvedValueOnce([
        event,
        {
          ...event,
          id: 'event-2',
          entity_uuid: 'record-2',
          actor_user_id: null,
        },
        {
          ...event,
          id: 'event-3',
          entity_uuid: 'record-3',
          actor_user_id: 'removed-actor',
        },
      ])
      .mockResolvedValueOnce([
        { id: 'record-2', identifier: 'SMP-23', title: 'Harvest lot' },
        { id: 'record-1', identifier: 'EXP-17', title: 'Current title' },
      ])
    rpc.mockResolvedValue([
      { user_id: 'actor-1', name: 'Priya', role: 'scientist' },
    ])
    const result = await fetchProjectActivity('project-1')
    expect(list).toHaveBeenLastCalledWith(
      'records',
      '?project_id=eq.project-1&id=in.(record-1,record-2,record-3)&select=id,identifier,title',
    )
    expect(rpc).toHaveBeenCalledWith('workspace_members_list', {})
    expect(result[0]).toMatchObject({
      currentActorName: 'Priya',
      actorName: null,
      currentRecord: {
        id: 'record-1',
        identifier: 'EXP-17',
        title: 'Current title',
      },
    })
    expect(result[0].payload).toBe(payload)
    expect(result[1]).toMatchObject({
      currentActorName: null,
      actorUserId: null,
      currentRecord: {
        id: 'record-2',
        identifier: 'SMP-23',
        title: 'Harvest lot',
      },
    })
    expect(result[2]).toMatchObject({
      currentActorName: null,
      currentRecord: null,
    })
  })

  it('does not broaden readable identity lookup when the server denies it', async () => {
    list
      .mockResolvedValueOnce([
        {
          id: 'event-1',
          sequence: '17',
          entity_type: 'record',
          entity_uuid: 'record-1',
          actor_user_id: null,
          payload: {},
        },
      ])
      .mockRejectedValueOnce(new Error('Denied'))
    await expect(fetchProjectActivity('project-1')).rejects.toThrow('Denied')
    expect(list).toHaveBeenCalledTimes(2)
    expect(rpc).not.toHaveBeenCalled()
  })
})
