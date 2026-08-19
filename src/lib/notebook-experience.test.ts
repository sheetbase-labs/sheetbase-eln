import { describe, expect, it, vi } from 'vitest'

import { EMPTY_RICH_TEXT_PAYLOAD, PAYLOAD_SCHEMA_VERSION } from '#/lib/blocks'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import type {
  NotebookBlock,
  NotebookRecord,
  RecordWire,
  RevisionWire,
} from '#/lib/notebook-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'

import {
  blocksFromRevision,
  duplicateExperiment,
  downloadRevisionEvidence,
  fetchRevisionsForRecord,
  groupChartTables,
  notebookLifecycleLabel,
  notebookSignState,
  reviewerCandidates,
  reviewerOptionLabel,
  updateExperimentMetadata,
} from './notebook-experience'

vi.mock('#/lib/sheet-instance-data', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSheetInstance: vi.fn(),
  duplicateSheetInstance: vi.fn(),
}))

vi.mock('#/lib/notebook-mutations', async (importOriginal) => ({
  ...(await importOriginal()),
  insertSheetInstanceBlock: vi.fn(),
}))

function recordWire(overrides: Partial<RecordWire> = {}): RecordWire {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: 'ws',
    project_id: 'p1',
    folder_id: null,
    kind: 'experiment',
    identifier: 'EXP-2026-0001',
    title: 'Run copy',
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
    ...overrides,
  }
}

function sourceRecord(
  overrides: Partial<NotebookRecord> = {},
): NotebookRecord {
  return {
    id: 'r1',
    projectId: 'p1',
    kind: 'experiment',
    identifier: 'EXP-2026-0001',
    title: 'Stability run',
    status: 'in-progress',
    tags: ['qPCR'],
    structureVersion: 2,
    metadataVersion: 3,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u1',
    updatedByUserId: null,
    properties: { instrument: 'qPCR-1' },
    lockedAt: null,
    lockedByRevisionId: null,
    ...overrides,
  }
}

function block(
  overrides: Partial<NotebookBlock> & { id: string; type: string },
): NotebookBlock {
  return {
    recordId: 'r1',
    payload: {},
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
    ...overrides,
  }
}

function mockClient(overrides: Partial<DataClient> = {}): DataClient {
  return {
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    rpc: vi.fn(),
    insert: vi.fn(async () => ({})) as unknown as DataClient['insert'],
    patch: vi.fn(async () => []),
    remove: vi.fn(async () => []),
    ...overrides,
  }
}

describe('notebookLifecycleLabel', () => {
  it('returns Archived, Submitted, then Working', () => {
    expect(
      notebookLifecycleLabel({
        lockedAt: '2026-08-01T00:00:00.000Z',
        archivedAt: '2026-08-02T00:00:00.000Z',
      }),
    ).toBe('Archived')
    expect(
      notebookLifecycleLabel({
        lockedAt: '2026-08-01T00:00:00.000Z',
        archivedAt: null,
      }),
    ).toBe('Submitted')
    expect(notebookLifecycleLabel({ lockedAt: null, archivedAt: null })).toBe(
      'Working',
    )
  })
})

describe('reviewerCandidates', () => {
  it('drops viewers and suspended members', () => {
    expect(
      reviewerCandidates([
        { userId: 'u1', role: 'scientist', suspendedAt: null },
        { userId: 'u2', role: 'viewer', suspendedAt: null },
        { userId: 'u3', role: 'reviewer', suspendedAt: '2026-08-01T00:00:00Z' },
        { userId: 'u4', role: 'steward', suspendedAt: null },
      ]).map((member) => member.userId),
    ).toEqual(['u1', 'u4'])
  })
})

describe('reviewerOptionLabel', () => {
  it('labels the current user as You', () => {
    expect(
      reviewerOptionLabel({ userId: 'u1', role: 'scientist' }, 'u1'),
    ).toBe('You (scientist)')
    expect(
      reviewerOptionLabel({ userId: 'abcdef12zzzz', role: 'reviewer' }, 'u1'),
    ).toBe('abcdef12 · reviewer')
  })
})

describe('fetchRevisionsForRecord', () => {
  it('lists revisions for the record, newest first', async () => {
    const list = vi.fn().mockResolvedValue([])
    await fetchRevisionsForRecord(mockClient({ list }), 'rec/1')
    expect(list).toHaveBeenCalledWith(
      'revisions',
      '?record_id=eq.rec%2F1&order=created_at.desc,id.desc',
    )
  })
})

describe('blocksFromRevision', () => {
  it('maps block_snapshot through the overview revision mapper', () => {
    const revision: RevisionWire = {
      id: 'rev1',
      record_id: 'r1',
      structure_version: 1,
      metadata_version: 1,
      metadata_snapshot: { title: 'Run' },
      block_snapshot: [
        {
          id: 'b1',
          type: 'rich_text',
          payload: { doc: { type: 'doc', content: [] } },
          payload_schema_version: 1,
          order: 2,
          version: 4,
        },
      ],
      reason: 'submit',
      superseded_by_revision_id: null,
      created_at: '2026-08-17T00:00:00.000Z',
      created_by_user_id: 'u1',
    }
    expect(blocksFromRevision(revision)).toEqual([
      {
        id: 'b1',
        recordId: 'r1',
        type: 'rich_text',
        payload: { doc: { type: 'doc', content: [] } },
        payloadSchemaVersion: 1,
        order: 2,
        version: 4,
      },
    ])
  })
})

describe('updateExperimentMetadata', () => {
  it('PATCHes title and tags and returns patched fields', async () => {
    const patch = vi.fn().mockResolvedValue([
      {
        id: 'r1',
        title: 'Renamed',
        tags: ['a'],
        metadata_version: 4,
        updated_at: '2026-08-18T00:00:00.000Z',
      },
    ])
    const result = await updateExperimentMetadata(mockClient({ patch }), {
      recordId: 'r1',
      title: 'Renamed',
      tags: ['a'],
    })
    expect(patch).toHaveBeenCalledWith(
      'records',
      '?id=eq.r1&select=id,title,tags,metadata_version,updated_at',
      { title: 'Renamed', tags: ['a'] },
    )
    expect(result).toEqual({
      id: 'r1',
      title: 'Renamed',
      tags: ['a'],
      metadataVersion: 4,
      updatedAt: '2026-08-18T00:00:00.000Z',
    })
  })
})

describe('duplicateExperiment', () => {
  it('creates an experiment copy with non-sheet blocks and a default title', async () => {
    const rpc = vi.fn().mockResolvedValue({
      record: recordWire({ title: 'Stability run copy' }),
      blocks: [],
    })
    const { record } = await duplicateExperiment(mockClient({ rpc }), {
      source: sourceRecord(),
      blocks: [
        block({
          id: 'b1',
          type: 'rich_text',
          order: 1,
          payload: { doc: { type: 'doc' } },
        }),
        block({
          id: 'b2',
          type: 'file',
          order: 2,
          payload: { fileRecordId: 'f1' },
        }),
        block({
          id: 'b3',
          type: 'sheet',
          order: 3,
          payload: { tableId: 'not-canonical' },
        }),
      ],
    })
    expect(rpc).toHaveBeenCalledWith(
      'create_record_with_blocks',
      expect.objectContaining({
        p_project_id: 'p1',
        p_kind: 'experiment',
        p_title: 'Stability run copy',
        p_status: 'draft',
        p_tags: ['qPCR'],
        p_blocks: [
          {
            type: 'rich_text',
            payload: { doc: { type: 'doc' } },
            payload_schema_version: 1,
            order: 1,
          },
          {
            type: 'file',
            payload: { fileRecordId: 'f1' },
            payload_schema_version: 1,
            order: 2,
          },
        ],
      }),
    )
    expect(record.title).toBe('Stability run copy')
  })

  it('inserts an empty rich_text block when there are no non-sheet blocks', async () => {
    const rpc = vi.fn().mockResolvedValue({
      record: recordWire(),
      blocks: [],
    })
    await duplicateExperiment(mockClient({ rpc }), {
      source: sourceRecord(),
      blocks: [],
    })
    expect(rpc).toHaveBeenCalledWith(
      'create_record_with_blocks',
      expect.objectContaining({
        p_blocks: [
          {
            type: 'rich_text',
            payload: EMPTY_RICH_TEXT_PAYLOAD,
            payload_schema_version: PAYLOAD_SCHEMA_VERSION,
            order: 1,
          },
        ],
      }),
    )
  })

  it('duplicates canonical Sheet Instances onto the new record', async () => {
    const instanceId = '20000000-0000-4000-8000-000000000001'
    const duplicatedId = '20000000-0000-4000-8000-000000000002'
    const { fetchSheetInstance, duplicateSheetInstance } = await import(
      '#/lib/sheet-instance-data'
    )
    const { insertSheetInstanceBlock } = await import('#/lib/notebook-mutations')
    vi.mocked(fetchSheetInstance).mockResolvedValue({
      id: instanceId,
      name: 'Plate map',
      revision: 3,
    } as SheetInstance)
    vi.mocked(duplicateSheetInstance).mockResolvedValue({
      id: duplicatedId,
      name: 'Plate map copy',
      revision: 1,
    } as SheetInstance)
    vi.mocked(insertSheetInstanceBlock).mockResolvedValue({
      block: block({ id: 'nb', type: 'sheet', recordId: recordWire().id }),
      instanceId: duplicatedId,
      structureVersion: 2,
    })
    const rpc = vi.fn().mockResolvedValue({
      record: recordWire(),
      blocks: [],
    })
    const client = mockClient({ rpc })
    await duplicateExperiment(client, {
      source: sourceRecord(),
      blocks: [
        block({
          id: 's1',
          type: 'sheet',
          payload: { instanceId },
        }),
      ],
    })
    expect(fetchSheetInstance).toHaveBeenCalledWith(instanceId, client)
    expect(duplicateSheetInstance).toHaveBeenCalledWith(
      instanceId,
      3,
      'Plate map copy',
      client,
    )
    expect(insertSheetInstanceBlock).toHaveBeenCalledWith(client, {
      recordId: recordWire().id,
      instanceId: duplicatedId,
      expectedStructureVersion: 1,
    })
  })

  it('rejects a Notebook without a project', async () => {
    await expect(
      duplicateExperiment(mockClient(), {
        source: sourceRecord({ projectId: null }),
        blocks: [],
      }),
    ).rejects.toBeInstanceOf(DataClientError)
  })
})

describe('downloadRevisionEvidence', () => {
  it('fetches the evidence export for a revision', async () => {
    const rpc = vi.fn().mockResolvedValue({ formatVersion: 1 })
    const bundle = await downloadRevisionEvidence(mockClient({ rpc }), 'rev1')
    expect(rpc).toHaveBeenCalledWith('export_revision_evidence', {
      p_revision_id: 'rev1',
    })
    expect(bundle).toEqual({ formatVersion: 1 })
  })
})

describe('notebookSignState', () => {
  const submission = {
    state: 'approved',
    assigned_reviewer_user_ids: ['u1', 'u2'],
  }

  it('is none when there is no submission', () => {
    expect(
      notebookSignState({
        currentUserId: 'u1',
        submission: null,
        signatures: [],
      }),
    ).toBe('none')
  })

  it('is awaiting-review until the submission is approved', () => {
    expect(
      notebookSignState({
        currentUserId: 'u1',
        submission: { ...submission, state: 'submitted' },
        signatures: [],
      }),
    ).toBe('awaiting-review')
  })

  it('is can-sign for an assigned reviewer on an approved revision', () => {
    expect(
      notebookSignState({
        currentUserId: 'u1',
        submission,
        signatures: [],
      }),
    ).toBe('can-sign')
  })

  it('is already-signed after the current user has signed', () => {
    expect(
      notebookSignState({
        currentUserId: 'u1',
        submission,
        signatures: [{ signer_user_id: 'u1' }],
      }),
    ).toBe('already-signed')
  })

  it('is not-assigned when the current user is not a reviewer', () => {
    expect(
      notebookSignState({
        currentUserId: 'u9',
        submission,
        signatures: [],
      }),
    ).toBe('not-assigned')
  })
})

describe('groupChartTables', () => {
  it('keeps tables on this Notebook ahead of other workspace tables', () => {
    expect(
      groupChartTables(
        [
          { id: 'a', name: 'Workspace', record_id: 'other' },
          { id: 'b', name: 'Local', record_id: 'r1' },
        ],
        'r1',
      ),
    ).toEqual({
      local: [{ id: 'b', name: 'Local', record_id: 'r1' }],
      workspace: [{ id: 'a', name: 'Workspace', record_id: 'other' }],
    })
  })
})
