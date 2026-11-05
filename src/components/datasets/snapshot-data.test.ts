/**
 * DSET-03.1/03.3 — snapshot read-model presentation and compare paging helper
 * tests. These pin the truthful retention/source/citation copy and the
 * response-count-driven "Load more" decision without needing a browser.
 */
import { describe, expect, it } from 'vitest'

import {
  countSnapshotCitations,
  describeKeepError,
  describePruneWarning,
  describeSnapshotCitations,
  describeSnapshotError,
  describeSnapshotKeeping,
  describeSnapshotRetention,
  describeSnapshotSource,
  describeSnapshotTombstone,
  hasMoreSnapshotCompareRows,
  isSnapshotPrunable,
  isSnapshotTombstone,
  mostUrgentPruneWarning,
  snapshotCompareTotalRows,
} from './snapshot-data'
import type {
  DatasetVersionCitations,
  DatasetVersionRetention,
} from '#/lib/dataset-explorer-data'
import type { SnapshotVersion } from './snapshot-data'

const policy = { citedYears: 15, uncitedYears: 2 }

function retention(reason: string): DatasetVersionRetention {
  return { reason, keptUntil: '2038-01-01T00:00:00.000Z', policy }
}

function summary(overrides: Partial<SnapshotVersion> = {}): SnapshotVersion {
  return {
    id: 'v-5',
    label: 'S-5',
    createdAt: '2026-09-01T00:00:00.000Z',
    createdByUserId: 'u-1',
    createdByCredentialId: null,
    createdByName: 'Gareth P.',
    sourceDatasetRevision: 12,
    rowCount: 40,
    contentHash: 'sha256:abc',
    rowsRemovedAt: null,
    change: null,
    retention: {
      reason: 'uncited_after_archive',
      keptUntil: '2026-10-03T00:00:00.000Z',
      policy,
    },
    source: null,
    citedBy: { signedRevisions: [], pipelineRuns: [], analyses: [] },
    ...overrides,
  }
}

describe('describeSnapshotRetention', () => {
  it('shows cited and kept snapshots as safe', () => {
    expect(
      describeSnapshotRetention(retention('cited_by_signed_record')),
    ).toMatchObject({
      label: 'Kept',
      tone: 'ok',
    })
    expect(describeSnapshotRetention(retention('kept'))).toMatchObject({
      label: 'Kept',
      tone: 'ok',
    })
  })

  it('shows an uncited-after-archive snapshot as prunable, not kept', () => {
    expect(
      describeSnapshotRetention(retention('uncited_after_archive')),
    ).toMatchObject({
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

  it('names the import that made the snapshot', () => {
    expect(
      describeSnapshotSource({
        kind: 'import',
        runId: null,
        definitionName: null,
        triggerKind: null,
        status: null,
        label: 'qa3-append.csv',
        startedAt: null,
      }),
    ).toBe('Imported from qa3-append.csv')
    // A connector's import has no file behind it.
    expect(
      describeSnapshotSource({ kind: 'import', label: null } as never),
    ).toBe('Imported')
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
    expect(describeSnapshotError({ code: 'SB001' })).toMatch(
      /changed elsewhere/,
    )
    expect(describeSnapshotError({ code: '42501' })).toMatch(/permission/)
    expect(describeSnapshotError({ code: '22023' })).toMatch(/Archived/)
  })

  it('falls back to the error message then generic copy', () => {
    expect(describeSnapshotError(new Error('boom'))).toBe('boom')
    expect(describeSnapshotError(null)).toBe('Please try again.')
  })
})

describe('snapshot prune warning (DSET-04.3)', () => {
  const now = new Date('2026-09-01T00:00:00.000Z')

  it('only treats an uncited-after-archive snapshot as prunable', () => {
    expect(isSnapshotPrunable(retention('uncited_after_archive'))).toBe(true)
    expect(isSnapshotPrunable(retention('kept'))).toBe(false)
    expect(isSnapshotPrunable(retention('cited_by_signed_record'))).toBe(false)
    expect(isSnapshotPrunable(retention('active'))).toBe(false)
  })

  it('names the removal date from the read model, not a constant', () => {
    const warning = describePruneWarning(summary(), now)
    expect(warning).toMatchObject({
      versionId: 'v-5',
      label: 'S-5',
      overdue: false,
    })
    expect(warning?.title).toBe('S-5 is due for row removal on 2026-10-03.')
    expect(warning?.detail).toContain('cited by a signed record')
  })

  it('reports an overdue removal once the due date has passed', () => {
    const warning = describePruneWarning(
      summary(),
      new Date('2026-11-01T00:00:00.000Z'),
    )
    expect(warning?.overdue).toBe(true)
    expect(warning?.title).toBe(
      'S-5 is overdue for row removal (was due 2026-10-03).',
    )
  })

  it('warns for neither a kept nor an already-removed snapshot', () => {
    expect(
      describePruneWarning(summary({ retention: retention('kept') }), now),
    ).toBeNull()
    expect(
      describePruneWarning(
        summary({ rowsRemovedAt: '2026-09-12T00:00:00.000Z' }),
        now,
      ),
    ).toBeNull()
  })

  it('acts on the most urgent prunable snapshot', () => {
    const warning = mostUrgentPruneWarning(
      [
        summary({
          id: 'v-later',
          label: 'S-6',
          retention: {
            reason: 'uncited_after_archive',
            keptUntil: '2027-01-01T00:00:00.000Z',
            policy,
          },
        }),
        summary({ id: 'v-kept', label: 'S-7', retention: retention('kept') }),
        summary({
          id: 'v-sooner',
          label: 'S-5',
          retention: {
            reason: 'uncited_after_archive',
            keptUntil: '2026-10-03T00:00:00.000Z',
            policy,
          },
        }),
      ],
      now,
    )
    expect(warning?.versionId).toBe('v-sooner')
  })

  it('has no warning when nothing is prunable', () => {
    expect(
      mostUrgentPruneWarning([summary({ retention: retention('kept') })], now),
    ).toBeNull()
  })
})

describe('snapshot tombstone (DSET-04.3)', () => {
  it('is true only once rowsRemovedAt is reported', () => {
    expect(isSnapshotTombstone(summary({ rowsRemovedAt: null }))).toBe(false)
    expect(
      isSnapshotTombstone(
        summary({ rowsRemovedAt: '2026-09-12T00:00:00.000Z' }),
      ),
    ).toBe(true)
    expect(isSnapshotTombstone(null)).toBe(false)
  })

  it('states the removal, the rule and what still resolves', () => {
    const tombstone = describeSnapshotTombstone(
      summary({ rowsRemovedAt: '2026-09-12T00:00:00.000Z' }),
    )
    expect(tombstone).toMatchObject({
      label: 'Rows removed',
      tone: 'stored',
      removedAt: '2026-09-12',
      rule: 'Uncited, 2 years after archive',
    })
    expect(tombstone.detail).toContain('Rows removed 2026-09-12')
    expect(tombstone.why).toContain('Links and citations still open this page')
  })

  it('describes a tombstoned snapshot as rows removed, not prunable', () => {
    const keeping = describeSnapshotKeeping(
      summary({ rowsRemovedAt: '2026-09-12T00:00:00.000Z' }),
    )
    expect(keeping).toMatchObject({ label: 'Rows removed', tone: 'stored' })
    expect(keeping?.detail).toContain('history are kept')
  })

  it('falls back to the retention view for a live snapshot', () => {
    expect(describeSnapshotKeeping(summary())).toMatchObject({
      label: 'Prunable',
      tone: 'warn',
    })
    expect(describeSnapshotKeeping(null)).toBeNull()
  })
})

describe('describeKeepError', () => {
  it('explains permission and reason refusals', () => {
    expect(describeKeepError({ code: '42501' })).toMatch(/permission/)
    expect(describeKeepError({ code: '22023' })).toMatch(/1 and 500/)
  })

  it('falls back to the error message then generic copy', () => {
    expect(describeKeepError(new Error('boom'))).toBe('boom')
    expect(describeKeepError(null)).toBe('Please try again.')
  })
})
