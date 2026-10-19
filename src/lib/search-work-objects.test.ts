import { describe, expect, it, vi } from 'vitest'

import {
  executeSearchWithWorkObjects,
  markMatch,
  searchWorkObjects,
  workObjectClassesFor,
  workObjectPattern,
} from './search-work-objects'
import { searchResultGroup } from './search'
import type { DataClient } from './data-client'

const now = '2026-09-01T00:00:00.000Z'

function fakeClient(
  tables: Record<string, unknown[] | Error | undefined>,
  rpcRows: unknown[] = [],
) {
  const list = vi.fn(async (table: string, _query?: string) => {
    const rows = tables[table]
    if (rows instanceof Error) throw rows
    return rows ?? []
  })
  const rpc = vi.fn(async () => rpcRows)
  return { client: { list, rpc } as unknown as DataClient, list, rpc }
}

describe('workObjectPattern', () => {
  it('wraps the term and removes the characters that end a filter', () => {
    expect(workObjectPattern('cell (growth), 5*')).toBe(
      encodeURIComponent('*cell growth 5*'),
    )
    expect(workObjectPattern('  ')).toBeNull()
  })
})

describe('markMatch', () => {
  it('marks the first occurrence the way the RPC does', () => {
    expect(markMatch('Cell growth', 'GROW')).toBe('Cell <b>grow</b>th')
    expect(markMatch('Cell growth', 'zzz')).toBe('Cell growth')
  })
})

describe('searchWorkObjects', () => {
  it('finds projects, pipelines and analyses and links each to its page', async () => {
    const { client } = fakeClient({
      projects: [
        {
          id: 'p-1',
          key: 'PRJ-1',
          title: 'Growth study',
          status: 'active',
          created_at: now,
          updated_at: now,
          archived_at: null,
        },
      ],
      pipeline_definitions: [
        {
          id: 'pl-1',
          key: 'growth-curve',
          name: 'Growth curve fit',
          description: null,
          lifecycle: 'active',
          created_at: now,
          updated_at: now,
          created_by_user_id: 'u-1',
        },
      ],
      analysis_views: [
        {
          id: 'a-1',
          display_id: 'AN-7',
          name: 'Growth over time',
          owner_user_id: 'u-1',
          created_at: now,
          updated_at: now,
        },
      ],
      analysis_definitions: [],
    })
    const rows = await searchWorkObjects(client, 'growth')
    expect(rows.map((r) => [r.resultType, r.deepLink])).toEqual([
      ['project', '/projects/p-1'],
      ['pipeline', '/pipelines/pl-1'],
      ['analysis', '/analysis/a-1'],
    ])
    expect(rows.map(searchResultGroup)).toEqual([
      'Projects',
      'Pipelines',
      'Analyses',
    ])
    expect(rows[0].matchedContext).toBe('<b>Growth</b> study')
  })

  it('leaves out a class that cannot be read, keeping the rest', async () => {
    const { client } = fakeClient({
      projects: new Error('denied'),
      pipeline_definitions: [
        {
          id: 'pl-1',
          key: 'k',
          name: 'Growth',
          description: null,
          lifecycle: 'active',
          created_at: now,
          updated_at: now,
          created_by_user_id: null,
        },
      ],
    })
    const rows = await searchWorkObjects(client, 'growth')
    expect(rows.map((r) => r.resultType)).toEqual(['pipeline'])
  })

  it('asks only for live projects and pipelines unless archived is included', async () => {
    const { client, list } = fakeClient({})
    await searchWorkObjects(client, 'x')
    const queries = list.mock.calls.map((c) => c[1] as string)
    expect(queries.some((q) => q.includes('archived_at=is.null'))).toBe(true)
    expect(queries.some((q) => q.includes('lifecycle=neq.archived'))).toBe(true)
    list.mockClear()
    await searchWorkObjects(client, 'x', { includeArchived: true })
    const widened = list.mock.calls.map((c) => c[1] as string)
    expect(widened.some((q) => q.includes('archived_at=is.null'))).toBe(false)
    expect(widened.some((q) => q.includes('neq.archived'))).toBe(false)
  })
})

describe('workObjectClassesFor', () => {
  it('searches every class unless a facet or RPC-only filter excludes them', () => {
    expect(workObjectClassesFor({})).toHaveLength(3)
    expect(workObjectClassesFor({ kind: 'sample' })).toEqual([])
    expect(workObjectClassesFor({ resultType: 'file' })).toEqual([])
    expect(workObjectClassesFor({}, ['Pipelines'])).toEqual(['pipeline'])
    expect(workObjectClassesFor({}, ['Files'])).toEqual([])
  })
})

describe('executeSearchWithWorkObjects', () => {
  it('adds the work objects to the first page only, carrying the RPC total', async () => {
    const wire = {
      result_type: 'record',
      record_id: 'r-1',
      kind: 'experiment',
      identifier: 'EXP-1',
      title: 'Growth run',
      status: 'approved',
      project_id: null,
      archived: false,
      created_by_user_id: 'u-1',
      created_at: now,
      updated_at: now,
      matched_context: '',
      matched_field: 'title',
      rank: '0.5',
      deep_link: '/records/r-1',
      total_count: '30',
    }
    const { client } = fakeClient(
      {
        projects: [
          {
            id: 'p-1',
            key: 'PRJ-1',
            title: 'Growth',
            status: 'active',
            created_at: now,
            updated_at: now,
            archived_at: null,
          },
        ],
      },
      [wire],
    )
    const first = await executeSearchWithWorkObjects(client, {
      query: 'growth',
      offset: 0,
    })
    expect(first.map((r) => r.resultType)).toEqual(['record', 'project'])
    expect(first[1].totalCount).toBe(30)
    const second = await executeSearchWithWorkObjects(client, {
      query: 'growth',
      offset: 20,
    })
    expect(second.map((r) => r.resultType)).toEqual(['record'])
  })
})
