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
  fetchNotebookReviewContext,
  fetchRevisionsForRecord,
  groupChartTables,
  inspectorEvidenceFromRevision,
  isActiveNotebookReview,
  linksFromRevisionSnapshot,
  notebookLifecycleLabel,
  notebookQueryKeysAfterSignature,
  notebookReviewActivity,
  notebookReviewRevisionId,
  notebookSignState,
  recordFromRevisionSnapshot,
  reviewerCandidates,
  reviewerOptionLabel,
  updateExperimentMetadata,
} from './notebook-experience'
import type { NotebookReviewContext } from './notebook-experience'

vi.mock('#/lib/sheet-instance-data', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSheetInstance: vi.fn(),
  duplicateSheetInstance: vi.fn(),
}))

vi.mock('#/lib/notebook-mutations', async (importOriginal) => ({
  ...(await importOriginal()),
  insertSheetInstanceBlock: vi.fn(),
  insertBlock: vi.fn(),
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

function sourceRecord(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
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

  it('labels an unlocked in-review Notebook as In review, not Working', () => {
    expect(
      notebookLifecycleLabel({
        lockedAt: null,
        archivedAt: null,
        reviewActivity: 'submitted',
      }),
    ).toBe('In review')
    expect(
      notebookLifecycleLabel({
        lockedAt: null,
        archivedAt: null,
        reviewActivity: 'approved',
      }),
    ).toBe('In review')
  })

  it('labels a historical view as Submitted even when the live record is unlocked', () => {
    expect(
      notebookLifecycleLabel({
        lockedAt: null,
        archivedAt: null,
        isHistorical: true,
      }),
    ).toBe('Submitted')
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
    expect(reviewerOptionLabel({ userId: 'u1', role: 'scientist' }, 'u1')).toBe(
      'You (scientist)',
    )
    expect(
      reviewerOptionLabel({ userId: 'abcdef12zzzz', role: 'reviewer' }, 'u1'),
    ).toBe('abcdef12 · reviewer')
  })

  it('names the candidate whenever a name is resolved', () => {
    expect(
      reviewerOptionLabel(
        { userId: 'abcdef12zzzz', role: 'reviewer', name: 'Mei L.' },
        'u1',
      ),
    ).toBe('Mei L. · reviewer')
    expect(
      reviewerOptionLabel(
        { userId: 'abcdef12zzzz', role: 'member', name: '   ' },
        'u1',
      ),
    ).toBe('abcdef12 · member')
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

describe('linksFromRevisionSnapshot', () => {
  const revisionBase: RevisionWire = {
    id: 'rev1',
    record_id: 'r1',
    structure_version: 1,
    metadata_version: 1,
    metadata_snapshot: { title: 'Run' },
    block_snapshot: [],
    reason: 'submit',
    superseded_by_revision_id: null,
    created_at: '2026-08-17T00:00:00.000Z',
    created_by_user_id: 'u1',
  }

  it('maps canonical snapshot links and ignores incomplete rows', () => {
    expect(
      linksFromRevisionSnapshot({
        ...revisionBase,
        canonical_snapshot: {
          formatVersion: 1,
          record: {},
          blocks: [],
          links: [
            {
              id: 'l1',
              sourceRecordId: 'r1',
              targetRecordId: 'r2',
              targetKind: 'protocol_template',
              targetIdentifier: 'PRT-2025-0001',
              linkType: 'protocol',
            },
            {
              id: 'bad',
              sourceRecordId: 'r1',
            },
          ],
          scientificTables: [],
          formulas: [],
          files: [],
        },
      }),
    ).toEqual([
      {
        id: 'l1',
        sourceRecordId: 'r1',
        targetRecordId: 'r2',
        targetKind: 'protocol_template',
        targetIdentifier: 'PRT-2025-0001',
        linkType: 'protocol',
        createdAt: '2026-08-17T00:00:00.000Z',
        createdByUserId: null,
      },
    ])
  })

  it('returns no links when only block_snapshot is present', () => {
    expect(linksFromRevisionSnapshot(revisionBase)).toEqual([])
  })
})

describe('inspectorEvidenceFromRevision', () => {
  it('uses snapshot blocks and canonical links, not a live overlay', () => {
    const evidence = inspectorEvidenceFromRevision({
      id: 'rev1',
      record_id: 'r1',
      structure_version: 1,
      metadata_version: 1,
      metadata_snapshot: { title: 'Submitted' },
      block_snapshot: [
        {
          id: 'file-snap',
          type: 'file',
          payload: { displayName: 'gel-at-submit.png' },
          payload_schema_version: 1,
          order: 1,
          version: 1,
        },
      ],
      canonical_snapshot: {
        formatVersion: 1,
        record: {},
        blocks: [],
        links: [
          {
            id: 'l-snap',
            sourceRecordId: 'r1',
            targetRecordId: null,
            targetKind: 'protocol_template',
            targetIdentifier: 'PRT-FROZEN',
            linkType: 'protocol',
          },
        ],
        scientificTables: [],
        formulas: [],
        files: [],
      },
      reason: 'submit',
      superseded_by_revision_id: null,
      created_at: '2026-08-17T00:00:00.000Z',
      created_by_user_id: 'u1',
    })
    expect(evidence.blocks.map((item) => item.payload.displayName)).toEqual([
      'gel-at-submit.png',
    ])
    expect(evidence.links.map((link) => link.targetIdentifier)).toEqual([
      'PRT-FROZEN',
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

  it('inserts an empty rich_text block when the source has no blocks', async () => {
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
    const { fetchSheetInstance, duplicateSheetInstance } =
      await import('#/lib/sheet-instance-data')
    const { insertSheetInstanceBlock, insertBlock } =
      await import('#/lib/notebook-mutations')
    vi.mocked(insertSheetInstanceBlock).mockClear()
    vi.mocked(insertBlock).mockClear()
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
    expect(rpc).toHaveBeenCalledWith(
      'create_record_with_blocks',
      expect.objectContaining({
        p_blocks: [],
      }),
    )
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
    expect(insertBlock).not.toHaveBeenCalled()
  })

  it('keeps interleaved Sheet order when duplicating text, Sheet, text', async () => {
    const instanceId = '20000000-0000-4000-8000-000000000001'
    const duplicatedId = '20000000-0000-4000-8000-000000000002'
    const { fetchSheetInstance, duplicateSheetInstance } =
      await import('#/lib/sheet-instance-data')
    const { insertSheetInstanceBlock, insertBlock } =
      await import('#/lib/notebook-mutations')
    vi.mocked(insertSheetInstanceBlock).mockClear()
    vi.mocked(insertBlock).mockClear()
    vi.mocked(fetchSheetInstance).mockResolvedValue({
      id: instanceId,
      name: 'Readings',
      revision: 1,
    } as SheetInstance)
    vi.mocked(duplicateSheetInstance).mockResolvedValue({
      id: duplicatedId,
      name: 'Readings copy',
      revision: 1,
    } as SheetInstance)
    vi.mocked(insertSheetInstanceBlock).mockResolvedValue({
      block: block({ id: 'new-s', type: 'sheet', recordId: recordWire().id }),
      instanceId: duplicatedId,
      structureVersion: 2,
    })
    vi.mocked(insertBlock).mockResolvedValue({
      block: block({
        id: 'new-t2',
        type: 'rich_text',
        recordId: recordWire().id,
      }),
      structureVersion: 3,
    })
    const rpc = vi.fn().mockResolvedValue({
      record: recordWire(),
      blocks: [
        {
          id: 'new-t1',
          record_id: recordWire().id,
          type: 'rich_text',
          payload: { doc: { type: 'doc' } },
          payload_schema_version: 1,
          order: 1,
          version: 1,
          created_at: '2026-08-19T00:00:00.000Z',
          updated_at: '2026-08-19T00:00:00.000Z',
        },
      ],
    })
    const client = mockClient({ rpc })
    await duplicateExperiment(client, {
      source: sourceRecord(),
      blocks: [
        block({
          id: 't1',
          type: 'rich_text',
          order: 1,
          payload: { doc: { type: 'doc', content: [] } },
        }),
        block({
          id: 's1',
          type: 'sheet',
          order: 2,
          payload: { instanceId },
        }),
        block({
          id: 't2',
          type: 'rich_text',
          order: 3,
          payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
        }),
      ],
    })
    expect(rpc).toHaveBeenCalledWith(
      'create_record_with_blocks',
      expect.objectContaining({
        p_blocks: [expect.objectContaining({ type: 'rich_text', order: 1 })],
      }),
    )
    expect(insertSheetInstanceBlock).toHaveBeenCalledWith(client, {
      recordId: recordWire().id,
      instanceId: duplicatedId,
      expectedStructureVersion: 1,
      afterBlockId: 'new-t1',
    })
    expect(insertBlock).toHaveBeenCalledWith(client, {
      recordId: recordWire().id,
      type: 'rich_text',
      payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      payloadSchemaVersion: 1,
      expectedStructureVersion: 2,
      afterBlockId: 'new-s',
    })
  })

  it('places a leading Sheet first without a blank rich-text placeholder', async () => {
    const instanceId = '20000000-0000-4000-8000-000000000001'
    const duplicatedId = '20000000-0000-4000-8000-000000000002'
    const { fetchSheetInstance, duplicateSheetInstance } =
      await import('#/lib/sheet-instance-data')
    const { insertSheetInstanceBlock, insertBlock } =
      await import('#/lib/notebook-mutations')
    vi.mocked(insertSheetInstanceBlock).mockClear()
    vi.mocked(insertBlock).mockClear()
    vi.mocked(fetchSheetInstance).mockResolvedValue({
      id: instanceId,
      name: 'Plate map',
      revision: 1,
    } as SheetInstance)
    vi.mocked(duplicateSheetInstance).mockResolvedValue({
      id: duplicatedId,
      name: 'Plate map copy',
      revision: 1,
    } as SheetInstance)
    vi.mocked(insertSheetInstanceBlock).mockResolvedValue({
      block: block({ id: 'new-s', type: 'sheet', recordId: recordWire().id }),
      instanceId: duplicatedId,
      structureVersion: 2,
    })
    vi.mocked(insertBlock).mockResolvedValue({
      block: block({
        id: 'new-t1',
        type: 'rich_text',
        recordId: recordWire().id,
      }),
      structureVersion: 3,
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
          order: 1,
          payload: { instanceId },
        }),
        block({
          id: 't1',
          type: 'rich_text',
          order: 2,
          payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
        }),
      ],
    })
    expect(rpc).toHaveBeenCalledWith(
      'create_record_with_blocks',
      expect.objectContaining({
        p_blocks: [],
      }),
    )
    expect(insertSheetInstanceBlock).toHaveBeenCalledWith(client, {
      recordId: recordWire().id,
      instanceId: duplicatedId,
      expectedStructureVersion: 1,
    })
    expect(insertBlock).toHaveBeenCalledWith(client, {
      recordId: recordWire().id,
      type: 'rich_text',
      payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      payloadSchemaVersion: 1,
      expectedStructureVersion: 2,
      afterBlockId: 'new-s',
    })
    expect(insertBlock).toHaveBeenCalledTimes(1)
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

describe('notebook review activity', () => {
  const approved = {
    submission: { state: 'approved', revision_id: 'rev-sub' },
    revision: { id: 'rev-sub', superseded_by_revision_id: null },
  } as NotebookReviewContext
  const submitted = {
    submission: { state: 'submitted', revision_id: 'rev-sub' },
    revision: { id: 'rev-sub', superseded_by_revision_id: null },
  } as NotebookReviewContext
  const superseded = {
    submission: { state: 'approved', revision_id: 'rev-sub' },
    revision: { id: 'rev-sub', superseded_by_revision_id: 'amend' },
  } as NotebookReviewContext

  it('is active for submitted or approved revisions that are not superseded', () => {
    expect(isActiveNotebookReview(approved)).toBe(true)
    expect(notebookReviewActivity(submitted)).toBe('submitted')
  })

  it('is inactive after amendment supersedes the reviewed revision', () => {
    expect(isActiveNotebookReview(superseded)).toBe(false)
    expect(
      notebookReviewRevisionId({
        lockedByRevisionId: null,
        review: superseded,
      }),
    ).toBeUndefined()
  })

  it('prefers the live lock revision, then the active submission', () => {
    expect(
      notebookReviewRevisionId({
        lockedByRevisionId: 'rev-locked',
        review: approved,
      }),
    ).toBe('rev-locked')
    expect(
      notebookReviewRevisionId({
        lockedByRevisionId: null,
        review: approved,
      }),
    ).toBe('rev-sub')
  })

  it('loads the latest submission and its revision', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'sub1',
          record_id: 'rec/1',
          revision_id: 'rev-sub',
          state: 'submitted',
        },
      ])
      .mockResolvedValueOnce([
        { id: 'rev-sub', superseded_by_revision_id: null },
      ])
    const result = await fetchNotebookReviewContext(
      mockClient({ list }),
      'rec/1',
    )
    expect(list).toHaveBeenNthCalledWith(
      1,
      'review_submissions',
      '?record_id=eq.rec%2F1&order=submitted_at.desc,id.desc&limit=1',
    )
    expect(result.submission?.revision_id).toBe('rev-sub')
    expect(result.revision?.superseded_by_revision_id).toBeNull()
  })
})

describe('recordFromRevisionSnapshot', () => {
  it('overlays snapshot title, tags, status and dates onto the live record', () => {
    const live = sourceRecord({
      title: 'Amended title',
      status: 'in-progress',
      tags: ['new'],
      updatedAt: '2026-08-20T00:00:00.000Z',
      lockedAt: null,
      lockedByRevisionId: null,
    })
    const overlaid = recordFromRevisionSnapshot(live, {
      title: 'Submitted title',
      status: 'in-progress',
      identifier: 'EXP-2026-0001',
      tags: ['qPCR', 'stability'],
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-18T12:00:00.000Z',
    })
    expect(overlaid.title).toBe('Submitted title')
    expect(overlaid.tags).toEqual(['qPCR', 'stability'])
    expect(overlaid.updatedAt).toBe('2026-08-18T12:00:00.000Z')
    expect(overlaid.id).toBe(live.id)
    expect(overlaid.lockedAt).toBeNull()
  })
})

describe('notebookQueryKeysAfterSignature', () => {
  it('includes record, blocks, review and history keys so the signer tab refetches', () => {
    const keys = notebookQueryKeysAfterSignature({
      recordId: 'r1',
      submissionId: 'sub1',
      revisionId: 'rev1',
    })
    expect(keys).toContainEqual(['notebook', 'record', 'r1'])
    expect(keys).toContainEqual(['notebook', 'blocks', 'r1'])
    expect(keys).toContainEqual(['notebook', 'review', 'r1'])
    expect(keys).toContainEqual(['notebook', 'activity', 'r1'])
    expect(keys).toContainEqual(['sign-002', 'timeline', 'r1'])
    expect(keys).toContainEqual([
      'sign-001',
      'signatures',
      'submission',
      'sub1',
    ])
  })
})
