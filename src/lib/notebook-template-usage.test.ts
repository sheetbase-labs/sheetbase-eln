import { describe, expect, it } from 'vitest'

import {
  buildInUseMatrix,
  countTemplateUse,
  filterInUseRecords,
  inUseStaleness,
  templateUseStatus,
} from './notebook-template-usage'
import type { TemplateUsageRecord } from './notebook-template-usage'
import type { NotebookTemplateVersion } from './notebook-template-data'

function record(
  overrides: Partial<TemplateUsageRecord> = {},
): TemplateUsageRecord {
  return {
    id: 'rec-1',
    identifier: 'EXP-1',
    title: 'Run',
    status: 'in_progress',
    locked_at: null,
    project_id: 'prj-1',
    created_by_user_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    source_notebook_template_version_id: 'v-1',
    ...overrides,
  }
}

function version(
  overrides: Partial<NotebookTemplateVersion> = {},
): NotebookTemplateVersion {
  return {
    id: 'v-1',
    templateId: 'tpl-1',
    version: 1,
    lifecycle: 'published',
    configuration: { formatVersion: 1, parameters: [], placements: [] },
    revision: 1,
    publishedAt: '2026-01-02T00:00:00Z',
    publishedByUserId: null,
    reason: null,
    signedByUserId: null,
    signedMeaning: null,
    signedAt: null,
    retiredAt: null,
    ...overrides,
  }
}

describe('templateUseStatus', () => {
  it('puts a locked record in the signed bucket regardless of status', () => {
    expect(
      templateUseStatus({ status: 'in_review', locked_at: '2026-01-03' }),
    ).toBe('signed')
  })

  it('separates review from progress', () => {
    expect(templateUseStatus({ status: 'in_review', locked_at: null })).toBe(
      'in-review',
    )
    expect(templateUseStatus({ status: 'In Progress', locked_at: null })).toBe(
      'in-progress',
    )
  })
})

describe('countTemplateUse', () => {
  it('counts each bucket once per record', () => {
    expect(
      countTemplateUse([
        record(),
        record({ id: 'rec-2', status: 'in_review' }),
        record({ id: 'rec-3', locked_at: '2026-01-03' }),
      ]),
    ).toEqual({ total: 3, inProgress: 1, inReview: 1, signed: 1 })
  })
})

describe('buildInUseMatrix', () => {
  it('groups pinned records by version, newest first, including empty versions', () => {
    const matrix = buildInUseMatrix(
      [
        record({ id: 'rec-1', source_notebook_template_version_id: 'v-1' }),
        record({
          id: 'rec-2',
          source_notebook_template_version_id: 'v-1',
          status: 'in_review',
        }),
        record({
          id: 'rec-3',
          source_notebook_template_version_id: 'v-1',
          locked_at: '2026-01-03',
        }),
        record({
          id: 'rec-4',
          source_notebook_template_version_id: 'v-2',
          status: 'in_review',
        }),
      ],
      [version({ id: 'v-1', version: 1 }), version({ id: 'v-2', version: 2 })],
    )
    expect(matrix.map((row) => [row.version.version, row.total])).toEqual([
      [2, 1],
      [1, 3],
    ])
    expect(matrix[0]).toMatchObject({
      inProgress: 0,
      inReview: 1,
      signed: 0,
    })
    expect(matrix[1]).toMatchObject({
      inProgress: 1,
      inReview: 1,
      signed: 1,
    })
  })

  it('ignores a pin that names no version in the list', () => {
    const matrix = buildInUseMatrix(
      [record({ source_notebook_template_version_id: 'v-other' })],
      [version({ id: 'v-1', version: 1 })],
    )
    expect(matrix).toHaveLength(1)
    expect(matrix[0].total).toBe(0)
  })
})

describe('inUseStaleness', () => {
  it('counts records behind the current version and how many can move', () => {
    expect(
      inUseStaleness(
        [
          record({ id: 'a', source_notebook_template_version_id: 'v-2' }),
          record({ id: 'b', source_notebook_template_version_id: 'v-1' }),
          record({
            id: 'c',
            source_notebook_template_version_id: 'v-1',
            status: 'in_review',
          }),
          record({
            id: 'd',
            source_notebook_template_version_id: 'v-1',
            locked_at: '2026-01-03',
          }),
        ],
        'v-2',
      ),
    ).toEqual({ behind: 3, updatable: 1, stays: 1 })
  })

  it('reports nothing stale when there is no current version', () => {
    expect(inUseStaleness([record()], undefined)).toEqual({
      behind: 0,
      updatable: 0,
      stays: 0,
    })
  })
})

describe('filterInUseRecords', () => {
  const records = [
    record({ id: 'a', project_id: 'prj-1' }),
    record({
      id: 'b',
      project_id: 'prj-2',
      source_notebook_template_version_id: 'v-2',
    }),
  ]

  it('filters by version, project, or both', () => {
    expect(
      filterInUseRecords(records, { versionId: 'v-2' }).map((r) => r.id),
    ).toEqual(['b'])
    expect(
      filterInUseRecords(records, { projectId: 'prj-1' }).map((r) => r.id),
    ).toEqual(['a'])
    expect(
      filterInUseRecords(records, { versionId: 'v-1', projectId: 'prj-2' }),
    ).toEqual([])
  })

  it('returns everything when no filter is set', () => {
    expect(filterInUseRecords(records, {})).toHaveLength(2)
  })
})
