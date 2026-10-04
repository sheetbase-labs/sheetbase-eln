import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  updateProjectDetails,
  fetchProjectActivity,
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
})
