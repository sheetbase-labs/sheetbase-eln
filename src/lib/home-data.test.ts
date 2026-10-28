import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  fetchHomeCounts,
  fetchHomeReviews,
  fetchHomeDatasetIssues,
  fetchHomePeople,
  hasOpenedHomeProject,
  homeAssignedProjects,
  homeDayRange,
  homeDueLabel,
  homeMaterialExpiryLabel,
} from './home-data'

describe('Home authority enrichment', () => {
  it.each([
    ['2026-10-01T00:00:00Z', '2026-09-25T08:30:00Z', 'lot expires in 6 days'],
    ['2026-09-26T00:00:00Z', '2026-09-24T23:30:00Z', 'lot expires in 1 day'],
    ['2026-09-25T00:00:00Z', '2026-09-24T23:30:00Z', 'lot expires today'],
    ['2026-09-24T00:00:00Z', '2026-09-24T23:30:00Z', 'lot expired 1 day ago'],
    ['2026-03-30T00:00:00Z', '2026-03-28T23:30:00Z', 'lot expires in 2 days'],
    ['2026-10-26T00:00:00Z', '2026-10-24T23:30:00Z', 'lot expires in 1 day'],
    [null, '2026-09-25T08:30:00Z', 'Expiry information unavailable'],
  ])(
    'uses actual expiry and London calendar dates (%s, %s)',
    (dueAt, now, label) => {
      expect(
        homeMaterialExpiryLabel(
          { dueAt, reason: 'Expiry information unavailable' },
          new Date(now),
          'Europe/London',
        ),
      ).toBe(label)
    },
  )

  it('uses submitted revisions/due dates and joins identities by ID, dropping unreadable records', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), 'http://sheetbase.test')
      const resource = url.pathname.split('/api/db/')[1]
      let rows: unknown
      if (resource === 'review_submissions') {
        expect(url.searchParams.get('state')).toBe('eq.submitted')
        expect(url.searchParams.get('assigned_reviewer_user_ids')).toBe(
          'cs.{reviewer-a}',
        )
        rows = [
          {
            id: 's1',
            record_id: 'r1',
            revision_id: 'rev-frozen',
            due_at: '2026-09-29T12:00:00Z',
            submitted_by_user_id: 'priya',
          },
          {
            id: 's2',
            record_id: 'unreadable',
            revision_id: 'rev-hidden',
            due_at: null,
            submitted_by_user_id: 'tom',
          },
        ]
      } else if (resource === 'records') {
        rows = [
          {
            id: 'r1',
            identifier: 'EXP-0138',
            title: 'PEI:DNA sweep',
            project_id: 'p1',
          },
        ]
      } else if (resource === 'projects') {
        expect(url.searchParams.get('id')).toBe('in.(p1)')
        rows = [{ id: 'p1', title: 'AAV9 process transfer' }]
      } else if (resource === 'rpc/workspace_members_list') {
        rows = [
          { user_id: 'tom', name: 'Tom H.' },
          { user_id: 'priya', name: 'Priya S.' },
        ]
      } else throw new Error(`Unexpected Home authority ${resource}`)
      return new Response(JSON.stringify(rows))
    })
    expect(
      await fetchHomeReviews(createDataClient(fetchImpl), 'reviewer-a'),
    ).toEqual([
      {
        id: 's1',
        recordId: 'r1',
        revisionId: 'rev-frozen',
        identifier: 'EXP-0138',
        title: 'PEI:DNA sweep',
        projectTitle: 'AAV9 process transfer',
        submittedByName: 'Priya S.',
        dueAt: '2026-09-29T12:00:00Z',
      },
    ])
  })

  it('groups missing-unit columns under one real Dataset and retains actual flag reasons', async () => {
    const client = createDataClient(
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input), 'http://sheetbase.test')
        if (url.pathname.endsWith('/rpc/dataset_list_summary')) {
          expect(url.searchParams.get('archived_at')).toBe('is.null')
          return new Response(
            JSON.stringify([
              {
                id: 'd1',
                display_id: 'DS-0298',
                missing_unit_count: 2,
                out_of_range_count: 0,
                issue_count: 2,
                missing_unit_fields: ['Osmolality', 'Glucose'],
                updated_at: '2026-09-24T12:00:00Z',
              },
              {
                id: 'd2',
                display_id: 'DS-0311',
                missing_unit_count: 0,
                out_of_range_count: 1,
                issue_count: 1,
                missing_unit_fields: [],
                updated_at: '2026-09-24T12:00:00Z',
              },
            ]),
          )
        }
        expect(url.searchParams.get('cleared_at')).toBe('is.null')
        const reasons =
          url.searchParams.get('dataset_id') === 'eq.d1'
            ? ['Unit missing', 'Unit missing']
            : ['Measured 61.5 NTU, allowed 0–50 NTU']
        return new Response(
          JSON.stringify(
            reasons.map((reason, index) => ({
              id: String(index),
              reason,
              source: 'manual',
            })),
          ),
        )
      }),
    )
    expect(await fetchHomeDatasetIssues(client)).toEqual([
      {
        id: 'd1',
        identifier: 'DS-0298',
        label: '2 columns missing units',
        detail: '“Osmolality”, “Glucose” — add before review',
      },
      {
        id: 'd2',
        identifier: 'DS-0311',
        label: '1 value outside range',
        detail: 'Measured 61.5 NTU, allowed 0–50 NTU',
      },
    ])
  })

  it('derives People labels only from actual project/role assignments, excluding self', async () => {
    const client = createDataClient(
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify([
              {
                user_id: 'self',
                name: 'Me',
                access_level: 'editor',
                workspace_role: 'member',
                is_lead: false,
              },
              {
                user_id: 'lead',
                name: 'Gareth',
                access_level: 'owner',
                workspace_role: 'owner',
                is_lead: true,
              },
              {
                user_id: 'scientist',
                name: 'Priya',
                access_level: 'editor',
                workspace_role: 'member',
                is_lead: false,
              },
              {
                user_id: 'reviewer',
                name: 'Mei',
                access_level: 'editor',
                workspace_role: 'reviewer',
                is_lead: false,
              },
              {
                user_id: 'legacy-reviewer',
                name: 'Tom',
                access_level: 'reviewer',
                workspace_role: null,
                is_lead: false,
              },
            ]),
          ),
      ),
    )
    expect(await fetchHomePeople(client, ['p1', 'p2'], 'self')).toEqual([
      { id: 'lead', name: 'Gareth', role: 'Project lead' },
      { id: 'scientist', name: 'Priya', role: 'Workspace member' },
      { id: 'reviewer', name: 'Mei', role: 'Workspace reviewer' },
      { id: 'legacy-reviewer', name: 'Tom', role: 'Project member' },
    ])
  })

  it.each([0, 1])(
    'reads genuine own project opens, not membership (%s views)',
    async (total) => {
      const client = createDataClient(
        vi.fn<typeof fetch>(async (input) => {
          const url = new URL(String(input), 'http://sheetbase.test')
          expect(url.pathname).toBe('/api/db/recently_viewed')
          expect(url.searchParams.get('user_id')).toBe('eq.me')
          expect(url.searchParams.get('object_kind')).toBe('eq.project')
          expect(url.searchParams.get('object_id')).toBe('in.(p1,p2)')
          return new Response('[]', {
            headers: { 'content-range': total ? '0-0/1' : '*/0' },
          })
        }),
      )
      expect(await hasOpenedHomeProject(client, 'me', ['p1', 'p2'])).toBe(
        total > 0,
      )
    },
  )
})

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
            can_edit: true,
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
      { id: 'assigned', title: 'AAV9 process transfer', accessLevel: 'Editor' },
    ])
  })

  it.each<[boolean, boolean, boolean, string]>([
    [false, true, true, 'Reviewer'],
    [false, true, false, 'Editor'],
    [false, false, true, 'Review only'],
    [false, false, false, 'Viewer'],
    [true, false, false, 'Owner'],
  ])(
    'labels independent Manage/Edit/Review flags (%s/%s/%s)',
    (can_manage, can_edit, can_review, label) => {
      expect(
        homeAssignedProjects(
          [{ id: 'p1', title: 'Assigned project' }],
          [
            {
              project_id: 'p1',
              can_view: true,
              can_manage,
              can_edit,
              can_review,
              client_portal: false,
              access_level: 'editor',
            },
          ],
        ),
      ).toEqual([{ id: 'p1', title: 'Assigned project', accessLevel: label }])
    },
  )
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
      if (url.pathname.endsWith('/rpc/inbox_needs_action_counts')) {
        // The Inbox total is the server's count over every row the caller can
        // see, seen state included. Reading the list instead — as Home did —
        // returns at most `limit=200` rows, so a workspace past that cap
        // stated 200 where the sidebar stated more.
        expect(url.searchParams.has('limit')).toBe(false)
        return new Response(JSON.stringify([{ total: 250, reviews: 41 }]))
      }
      let total: number
      if (url.pathname.endsWith('/rpc/dataset_list_summary')) {
        expect(url.searchParams.get('issue_count')).toBe('gt.0')
        expect(url.searchParams.get('archived_at')).toBe('is.null')
        total = 7
      } else if (url.pathname.endsWith('/calendar_bookings')) {
        expect(url.searchParams.get('workspace_id')).toBe('eq.workspace-a')
        expect(url.searchParams.getAll('starts_at')).toEqual([
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
      } else if (url.pathname.endsWith('/my_notifications')) {
        expect(url.searchParams.get('read_at')).toBe('is.null')
        total = 3
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
      // The server states 250 needs-action items and 41 of them reviews; the
      // 200-row preview Home used to measure would have capped this at 200.
      reviews: 41,
      datasetsWithErrors: 7,
      experimentsInProgress: 1403,
      instrumentRuns: 2,
      inbox: 250,
      unreadNotifications: 3,
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
