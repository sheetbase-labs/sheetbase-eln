import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  fetchHomeCounts,
  homeAssignedProjects,
  homeDayRange,
  homeDueLabel,
} from './home-data'

describe('Home project assignments', () => {
  it('uses explicit view permission, never lead status or the display level', () => {
    const permissions = {
      can_view: false,
      can_edit: false,
      can_review: false,
      can_manage: false,
      client_portal: false,
    }
    expect(
      homeAssignedProjects(
        [
          { id: 'lead-only', title: 'No explicit access' },
          { id: 'denied', title: 'Denied' },
          { id: 'assigned', title: 'AAV9 process transfer' },
        ],
        [
          { ...permissions, project_id: 'denied', access_level: 'owner' },
          {
            ...permissions,
            project_id: 'assigned',
            can_view: true,
            access_level: 'editor',
          },
          {
            ...permissions,
            project_id: 'unreadable',
            can_view: true,
            access_level: 'viewer',
          },
        ],
      ),
    ).toEqual([
      { id: 'assigned', title: 'AAV9 process transfer', accessLevel: 'editor' },
    ])
  })
})

describe('Home day boundaries', () => {
  it.each([
    [
      '2026-03-29T12:00:00Z',
      '2026-03-29T00:00:00.000Z',
      '2026-03-29T23:00:00.000Z',
    ],
    [
      '2026-10-25T12:00:00Z',
      '2026-10-24T23:00:00.000Z',
      '2026-10-26T00:00:00.000Z',
    ],
    [
      '2026-09-24T23:30:00Z',
      '2026-09-24T23:00:00.000Z',
      '2026-09-25T23:00:00.000Z',
    ],
  ])('resolves both London midnights around %s', (now, start, end) => {
    expect(homeDayRange(new Date(now), 'Europe/London')).toEqual({ start, end })
  })

  it('uses the workspace day, not the browser or UTC date', () => {
    expect(
      homeDayRange(new Date('2026-09-24T23:30:00Z'), 'America/New_York'),
    ).toEqual({
      start: '2026-09-24T04:00:00.000Z',
      end: '2026-09-25T04:00:00.000Z',
    })
    expect(
      homeDueLabel(
        '2026-09-24T23:45:00Z',
        new Date('2026-09-25T12:00:00Z'),
        'Europe/London',
      ),
    ).toBe('Today')
    expect(homeDueLabel(null, new Date(), 'Europe/London')).toBe('—')
  })
})

describe('Home exact totals', () => {
  it('uses permission-scoped distinct Datasets and real runs, with totals beyond every preview cap', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), 'http://sheetbase.test')
      urls.push(url.pathname + url.search)
      let total: number
      if (url.pathname.endsWith('/rpc/dataset_list_summary')) {
        expect(url.searchParams.get('issue_count')).toBe('gt.0')
        expect(url.searchParams.get('archived_at')).toBe('is.null')
        total = 7
      } else if (url.pathname.endsWith('/instrument_runs')) {
        expect(url.searchParams.get('workspace_id')).toBe('eq.workspace-a')
        expect(url.searchParams.getAll('started_at')).toEqual([
          'gte.2026-09-24T23:00:00.000Z',
          'lt.2026-09-25T23:00:00.000Z',
        ])
        total = 2
      } else if (url.pathname.endsWith('/records')) {
        expect(url.searchParams.get('workspace_id')).toBe('eq.workspace-a')
        expect(url.searchParams.get('kind')).toBe('eq.experiment')
        expect(url.searchParams.get('status')).toBe('eq.in_progress')
        expect(url.searchParams.get('deleted_at')).toBe('is.null')
        total = 1403
      } else if (url.pathname.endsWith('/my_work_items')) {
        expect(url.searchParams.get('state')).toBe('in.(needs_action,overdue)')
        total =
          url.searchParams.get('kind') === 'eq.review_requested' ? 257 : 280
      } else {
        throw new Error(`Unexpected Home authority: ${url.pathname}`)
      }
      expect(url.searchParams.has('limit')).toBe(false)
      return new Response('[{"id":"one-row"}]', {
        headers: { 'content-range': `0-0/${total}` },
      })
    })
    expect(
      await fetchHomeCounts(createDataClient(fetchImpl), 'workspace-a', {
        start: '2026-09-24T23:00:00.000Z',
        end: '2026-09-25T23:00:00.000Z',
      }),
    ).toEqual({
      reviews: 257,
      datasetsWithErrors: 7,
      experimentsInProgress: 1403,
      instrumentRuns: 2,
      inbox: 280,
    })
    expect(urls).toHaveLength(5)
  })

  it('propagates unavailable counts instead of rendering empty or partial totals', async () => {
    const client = createDataClient(
      vi.fn<typeof fetch>().mockImplementation(async () => new Response('[]')),
    )
    await expect(
      fetchHomeCounts(client, 'workspace-a', homeDayRange(new Date(), 'UTC')),
    ).rejects.toMatchObject({ code: 'invalid_count' })
  })
})
