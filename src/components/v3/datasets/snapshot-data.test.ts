/**
 * DSET-03.1/03.3 — snapshot read-model presentation and compare paging helper
 * tests. These pin the truthful retention/source/citation copy and the
 * response-count-driven "Load more" decision without needing a browser.
 */
import { describe, expect, it } from 'vitest'

import {
  countSnapshotCitations,
  describeSnapshotCitations,
  describeSnapshotError,
  describeSnapshotRetention,
  describeSnapshotSource,
  hasMoreSnapshotCompareRows,
  snapshotCompareTotalRows,
} from './snapshot-data'
import type {
  DatasetVersionCitations,
  DatasetVersionRetention,
} from '#/lib/dataset-explorer-data'

const policy = { citedYears: 15, uncitedYears: 2 }

function retention(reason: string): DatasetVersionRetention {
  return { reason, keptUntil: '2038-01-01T00:00:00.000Z', policy }
}

describe('describeSnapshotRetention', () => {
  it('shows cited and kept snapshots as safe', () => {
    expect(describeSnapshotRetention(retention('cited_by_signed_record'))).toMatchObject({
      label: 'Kept',
      tone: 'ok',
    })
    expect(describeSnapshotRetention(retention('kept'))).toMatchObject({
      label: 'Kept',
      tone: 'ok',
    })
  })

  it('shows an uncited-after-archive snapshot as prunable, not kept', () => {
    expect(describeSnapshotRetention(retention('uncited_after_archive'))).toMatchObject({
      label: 'Prunable',
      tone: 'warn',
    })
  })

  it('reports unknown rather than inventing a policy', () => {
    expect(
      describeSnapshotRetention({ reason: 'future_reason', keptUntil: null }),
    ).toMatchObject({ label: 'Unknown', tone: 'none' })
  })
})

describe('describeSnapshotSource', () => {
  it('joins the pipeline run identity for a run-produced snapshot', () => {
    expect(
      describeSnapshotSource({
        kind: 'pipeline_run',
        runId: 'run-1',
        definitionName: 'Plate import',
        triggerKind: 'schedule',
        status: 'succeeded',
        label: 'plate 4',
        startedAt: '2026-09-25T10:00:00.000Z',
      }),
    ).toBe('Plate import · schedule · succeeded · plate 4')
  })

  it('distinguishes API and manual snapshots', () => {
    expect(describeSnapshotSource({ kind: 'api' } as never)).toBe(
      'Saved through the API',
    )
    expect(describeSnapshotSource({ kind: 'manual' } as never)).toBe(
      'Saved by hand',
    )
    expect(describeSnapshotSource(null)).toBe('—')
  })
})

describe('snapshot citations', () => {
  const citedBy: DatasetVersionCitations = {
    signedRevisions: [
      {
        revisionId: '11111111-1111-1111-1111-111111111111',
        signedAt: '2026-09-25T12:00:00.000Z',
        signerUserId: 'user-1',
      },
    ],
    pipelineRuns: [
      {
        runId: '22222222-2222-2222-2222-222222222222',
        status: 'succeeded',
        triggerKind: 'manual',
        startedAt: '2026-09-25T11:00:00.000Z',
      },
    ],
    analyses: [
      {
        blockId: 'block-1',
        recordId: '33333333-3333-3333-3333-333333333333',
      },
    ],
  }

  it('counts every citation class', () => {
    expect(countSnapshotCitations(citedBy)).toEqual({
      signedRevisions: 1,
      pipelineRuns: 1,
      analyses: 1,
    })
  })

  it('lists individual citations for the inspector', () => {
    expect(describeSnapshotCitations(citedBy)).toEqual([
      'Signed record 11111111 · 2026-09-25',
      'Pipeline run 22222222 · succeeded',
      'Analysis in 33333333',
    ])
    expect(describeSnapshotCitations(null)).toEqual([])
  })
})

describe('snapshot compare paging', () => {
  it('totals added, removed and changed rows', () => {
    expect(
      snapshotCompareTotalRows({
        added: 3,
        removed: 1,
        changed: 4,
        flags: 9,
      }),
    ).toBe(8)
  })

  it('keeps paging while loaded pages under-cover the server count', () => {
    expect(
      hasMoreSnapshotCompareRows({
        counts: { added: 120, removed: 0, changed: 0, flags: 0 },
        offset: 0,
        limit: 100,
        rows: new Array(100).fill({}),
      }),
    ).toBe(true)
  })

  it('stops once the loaded rows cover the whole comparison', () => {
    expect(
      hasMoreSnapshotCompareRows({
        counts: { added: 5, removed: 0, changed: 0, flags: 0 },
        offset: 0,
        limit: 100,
        rows: new Array(5).fill({}),
      }),
    ).toBe(false)
  })

  it('does not page an identical comparison', () => {
    expect(
      hasMoreSnapshotCompareRows({
        counts: { added: 0, removed: 0, changed: 0, flags: 0 },
        offset: 0,
        limit: 100,
        rows: [],
      }),
    ).toBe(false)
  })
})

describe('describeSnapshotError', () => {
  it('explains stale revisions and permission refusals', () => {
    expect(describeSnapshotError({ code: 'SB001' })).toMatch(/changed elsewhere/)
    expect(describeSnapshotError({ code: '42501' })).toMatch(/permission/)
    expect(describeSnapshotError({ code: '22023' })).toMatch(/Archived/)
  })

  it('falls back to the error message then generic copy', () => {
    expect(describeSnapshotError(new Error('boom'))).toBe('boom')
    expect(describeSnapshotError(null)).toBe('Please try again.')
  })
})
