/**
 * The experiments list reads one explicit page and counts the tabs from the
 * database, so a workspace with more experiments than one page states how many
 * are loaded instead of losing the rest. The row mapper carries the record's own
 * dates: the model has no experiment start date.
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import {
  toExperimentListRow,
  useExperimentRecords,
  useExperimentTabCounts,
} from './experiments-data'

const { list, count } = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
}))

const client = { list, count } as unknown as DataClient

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    children,
  )
}

beforeEach(() => vi.resetAllMocks())

const wire = {
  id: 'rec-1',
  project_id: 'p-1',
  identifier: 'EXP-0007',
  title: 'Plate reader run',
  status: 'in_progress',
  created_by_user_id: 'u-1',
  created_at: '2026-09-02T08:00:00.000Z',
  updated_at: '2026-10-11T12:01:43.921Z',
}

describe('toExperimentListRow', () => {
  it('carries the record’s own creation and update dates', () => {
    const row = toExperimentListRow(
      wire,
      new Map([['p-1', 'Process Development']]),
      new Map([['u-1', 'Tom H.']]),
    )

    expect(row.created).toBe('2026-09-02')
    expect(row.updated).toBe('2026-10-11')
    expect(row.project).toBe('Process Development')
    expect(row.owner).toBe('Tom H.')
  })

  it('tints an on-hold experiment and files it under the On hold tab', () => {
    // EXP-0139 carries `on_hold`, which the status table used to miss: it fell
    // to the untinted fallback and no tab listed it.
    const row = toExperimentListRow(
      { ...wire, status: 'on_hold' },
      new Map(),
      new Map(),
    )
    expect(row.status).toEqual({ tone: 'warn', label: 'On hold' })
    expect(row.statusTab).toBe('onhold')
  })

  it('lists every experiment status under exactly one status tab', () => {
    // No experiment may fall outside every status tab: the tab totals have to
    // account for the `All` total.
    const statuses = [
      'draft',
      'planned',
      'in_progress',
      'returned',
      'in_review',
      'approved',
      'locked',
      'failed',
      'paused',
      'on_hold',
    ]
    expect(
      statuses.map(
        (status) =>
          toExperimentListRow({ ...wire, status }, new Map(), new Map())
            .statusTab,
      ),
    ).toEqual([
      'drafts',
      'drafts',
      'inprogress',
      'inreview',
      'inreview',
      'approved',
      'approved',
      'approved',
      'onhold',
      'onhold',
    ])
  })
})

describe('useExperimentRecords', () => {
  it('reads the page the caller asked for, not a fixed cap', async () => {
    list.mockResolvedValue([])
    const { result } = renderHook(
      () => useExperimentRecords('ws-1', 600, client),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const query = list.mock.calls[0]?.[1] as string
    expect(query).toContain('limit=600')
    expect(query).toContain('kind=eq.experiment&deleted_at=is.null')
  })
})

describe('useExperimentTabCounts', () => {
  it('counts every tab from the database under the list’s own filter', async () => {
    count.mockImplementation(async (_resource: string, query: string) => {
      if (query.includes('archived_at=not.is.null')) return 2
      if (query.includes('created_by_user_id=eq.u-1')) return 3
      if (query.includes('status=eq.in_progress')) return 5
      if (query.includes('status=in.(paused,on_hold)')) return 1
      if (query.includes('status=in.(in_review,returned)')) return 2
      if (query.includes('status=in.(approved,locked,failed)')) return 7
      if (query.includes('status=in.(draft,planned)')) return 1
      return 12
    })

    const { result } = renderHook(() => useExperimentTabCounts('u-1', client), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // `all` is the workspace total, larger than any single page.
    expect(result.current.data).toEqual({
      all: 12,
      mine: 3,
      inprogress: 5,
      onhold: 1,
      inreview: 2,
      approved: 7,
      drafts: 1,
      archived: 2,
    })
    for (const [, query] of count.mock.calls) {
      expect(query as string).toContain('kind=eq.experiment&deleted_at=is.null')
    }
  })

  it('counts every status in exactly one status tab', async () => {
    count.mockResolvedValue(0)
    const { result } = renderHook(() => useExperimentTabCounts('u-1', client), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const statusesInFilter = (query: string) => {
      const listed = /status=in\.\(([^)]*)\)/.exec(query)?.[1]
      if (listed) return listed.split(',')
      const single = /status=eq\.([a-z_]+)/.exec(query)?.[1]
      return single ? [single] : []
    }
    const counted = count.mock.calls.flatMap(([, query]) =>
      statusesInFilter(query as string),
    )
    // No status is counted twice, and none is missing: the status tabs account
    // for the `All` total, so a record outside every tab cannot exist.
    expect([...counted].sort()).toEqual([
      'approved',
      'draft',
      'failed',
      'in_progress',
      'in_review',
      'locked',
      'on_hold',
      'paused',
      'planned',
      'returned',
    ])
  })
})
