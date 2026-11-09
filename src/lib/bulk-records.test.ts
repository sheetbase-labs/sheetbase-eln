import { describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'

import {
  bulkArchive,
  bulkAssign,
  bulkMoveToProject,
  bulkSetField,
  fetchBulkTargets,
  runBulk,
} from './bulk-records'
import type { BulkTarget } from './bulk-records'

function target(over: Partial<BulkTarget> = {}): BulkTarget {
  return {
    id: 'r1',
    kind: 'experiment',
    identifier: 'EXP-1',
    title: 'One',
    status: 'draft',
    projectId: 'p1',
    metadataVersion: 3,
    archived: false,
    locked: false,
    hasLocation: false,
    ...over,
  }
}

function client(rpc: DataClient['rpc']): DataClient {
  return { rpc } as unknown as DataClient
}

describe('fetchBulkTargets', () => {
  it('reads the picked records in the order they were picked', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        id: 'b',
        kind: 'sample',
        identifier: 'SMP-2',
        title: 'Two',
        status: 'draft',
        project_id: null,
        metadata_version: 2,
        archived_at: null,
        locked_at: null,
        properties: { storageLocation: ' Freezer 1 ' },
      },
      {
        id: 'a',
        kind: 'sample',
        identifier: 'SMP-1',
        title: 'One',
        status: 'draft',
        project_id: null,
        metadata_version: 1,
        archived_at: '2026-01-01',
        locked_at: null,
        properties: null,
      },
    ])

    const targets = await fetchBulkTargets({ list } as unknown as DataClient, [
      'a',
      'b',
    ])

    expect(list).toHaveBeenCalledWith(
      'records',
      expect.stringContaining('id=in.(a,b)'),
    )
    expect(targets.map((x) => x.id)).toEqual(['a', 'b'])
    expect(targets[0].archived).toBe(true)
    expect(targets[1].hasLocation).toBe(true)
    expect(targets[1].metadataVersion).toBe(2)
  })
})

describe('runBulk', () => {
  it('reports each record that was refused and still does the rest', async () => {
    const act = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new DataClientError('SB001', 'stale', 409))
      .mockResolvedValueOnce(undefined)

    const outcome = await runBulk(
      [
        target({ id: 'a', identifier: 'A' }),
        target({ id: 'b', identifier: 'B' }),
        target({ id: 'c', identifier: 'C' }),
      ],
      act,
    )

    expect(outcome.done.sort()).toEqual(['A', 'C'])
    expect(outcome.failed).toEqual([
      {
        id: 'b',
        identifier: 'B',
        message: 'Someone else changed it. Reload and try again.',
      },
    ])
  })

  it('never calls the action for a record it skips', async () => {
    const act = vi.fn()
    const outcome = await runBulk([target()], act, () => 'No.')
    expect(act).not.toHaveBeenCalled()
    expect(outcome.failed[0].message).toBe('No.')
  })
})

describe('bulk actions', () => {
  it('archives a sample through archive_sample and others through archive_record', async () => {
    const rpc = vi.fn().mockResolvedValue({})

    const outcome = await bulkArchive(client(rpc), [
      target({ id: 's', kind: 'sample', identifier: 'SMP-1' }),
      target({ id: 'e', kind: 'experiment' }),
      target({ id: 'x', archived: true, identifier: 'EXP-9' }),
    ])

    expect(rpc).toHaveBeenCalledWith(
      'archive_sample',
      expect.objectContaining({ p_record_id: 's' }),
    )
    expect(rpc).toHaveBeenCalledWith('archive_record', {
      p_record_id: 'e',
      p_expected_metadata_version: 3,
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(outcome.failed.map((f) => f.identifier)).toEqual(['EXP-9'])
  })

  it('does not move a record to the project it is already in', async () => {
    const rpc = vi.fn().mockResolvedValue({})
    const outcome = await bulkMoveToProject(client(rpc), [target()], 'p1')
    expect(rpc).not.toHaveBeenCalled()
    expect(outcome.failed).toHaveLength(1)
  })

  it('assigns with the version just read, and clears with null', async () => {
    const rpc = vi.fn().mockResolvedValue({})
    await bulkAssign(client(rpc), [target()], 'u1')
    await bulkAssign(client(rpc), [target()], null)
    expect(rpc).toHaveBeenNthCalledWith(1, 'assign_record', {
      p_record_id: 'r1',
      p_expected_metadata_version: 3,
      p_assignee_user_id: 'u1',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'assign_record', {
      p_record_id: 'r1',
      p_expected_metadata_version: 3,
      p_assignee_user_id: null,
    })
  })

  it('skips a locked record when setting a field', async () => {
    const rpc = vi.fn().mockResolvedValue({})

    const outcome = await bulkSetField(
      client(rpc),
      [target({ id: 'a' }), target({ id: 'b', locked: true, identifier: 'B' })],
      'batch',
      'L1',
    )

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('update_record_custom_fields', {
      p_record_id: 'a',
      p_expected_metadata_version: 3,
      p_values: { batch: 'L1' },
    })
    expect(outcome.failed[0].message).toBe('It is signed and locked.')
  })
})
