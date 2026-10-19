import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as notebookData from '#/lib/notebook-data'

import { bookInstrument } from './schedule-data'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<typeof notebookData>()),
  notebookDataClient: { rpc, list: vi.fn(async () => []) },
}))

const wire = {
  id: 'b-1',
  resource_id: 'ins-1',
  title: 'EXP-1 Titration',
  starts_at: '2026-10-20T09:00:00.000Z',
  ends_at: '2026-10-20T10:00:00.000Z',
  timezone: 'UTC',
  created_by_user_id: 'u-1',
}

describe('bookInstrument', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue(wire)
  })

  const base = {
    workspaceId: 'ws-1',
    resourceId: 'ins-1',
    title: 'EXP-1 Titration',
    startsAt: wire.starts_at,
    endsAt: wire.ends_at,
    timezone: 'UTC',
  }

  it('records the experiment and its project on a booking made for one', async () => {
    await bookInstrument({
      ...base,
      linkedExperimentRecordId: 'exp-1',
      projectId: 'prj-1',
    })
    expect(rpc).toHaveBeenCalledWith(
      'create_booking',
      expect.objectContaining({
        p_linked_experiment_record_id: 'exp-1',
        p_project_id: 'prj-1',
      }),
    )
  })

  it('leaves both empty for a booking made on its own', async () => {
    await bookInstrument(base)
    expect(rpc).toHaveBeenCalledWith(
      'create_booking',
      expect.objectContaining({
        p_linked_experiment_record_id: null,
        p_project_id: null,
      }),
    )
  })
})
