import { describe, expect, it, vi } from 'vitest'

import {
  createBlankExperiment,
  linkExperimentToSample,
} from './notebook-create'

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

describe('linkExperimentToSample', () => {
  const sample = { identifier: 'SMP-0001', recordId: 'sample-uuid' }

  it('writes one sample link keyed by the sample display identifier', async () => {
    const rpc = vi.fn().mockResolvedValue({})
    await linkExperimentToSample({ rpc } as never, 'exp-uuid', sample)
    expect(rpc).toHaveBeenCalledWith('create_record_link', {
      p_source_record_id: 'exp-uuid',
      p_target_kind: 'sample',
      p_target_identifier: 'SMP-0001',
      p_link_type: 'sample',
      p_target_record_id: 'sample-uuid',
      p_label: null,
    })
  })

  it('treats a link that already exists as done', async () => {
    const rpc = vi.fn().mockRejectedValue({ code: '23505', message: 'dup' })
    await expect(
      linkExperimentToSample({ rpc } as never, 'exp-uuid', sample),
    ).resolves.toBeUndefined()
  })

  it('surfaces any other refusal', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('record is locked'))
    await expect(
      linkExperimentToSample({ rpc } as never, 'exp-uuid', sample),
    ).rejects.toThrow('record is locked')
  })
})
