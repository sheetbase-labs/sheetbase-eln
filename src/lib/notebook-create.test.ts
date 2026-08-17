import { describe, expect, it, vi } from 'vitest'

import { createBlankExperiment } from './notebook-create'

describe('createBlankExperiment', () => {
  it('calls create_record_with_blocks for an experiment without a Template', async () => {
    const rpc = vi.fn().mockResolvedValue({
      record: {
        id: '11111111-1111-4111-8111-111111111111',
        workspace_id: 'ws',
        project_id: 'p1',
        folder_id: null,
        kind: 'experiment',
        identifier: 'EXP-2026-0001',
        title: 'Blank run',
        status: 'draft',
        tags: [],
        structure_version: 1,
        metadata_version: 1,
        created_at: '2026-08-17T00:00:00.000Z',
        updated_at: '2026-08-17T00:00:00.000Z',
        archived_at: null,
        deleted_at: null,
        created_by_user_id: 'u1',
        updated_by_user_id: null,
        properties: {},
        locked_at: null,
        locked_by_revision_id: null,
      },
      blocks: [],
    })
    const record = await createBlankExperiment({ rpc } as never, {
      projectId: 'p1',
      title: 'Blank run',
    })
    expect(rpc).toHaveBeenCalledWith(
      'create_record_with_blocks',
      expect.objectContaining({
        p_project_id: 'p1',
        p_kind: 'experiment',
        p_title: 'Blank run',
        p_status: 'draft',
      }),
    )
    expect(record.kind).toBe('experiment')
    expect(record.title).toBe('Blank run')
  })
})
