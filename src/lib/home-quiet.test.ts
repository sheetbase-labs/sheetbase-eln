import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import { toCalendarBooking, toCalendarInstrument } from './calendar'
import type { CalendarBookingWire, CalendarInstrumentWire } from './calendar'
import { describeRecentChange, recentStatusLabel } from './recents'
import type { RecentItem } from './recents'
import {
  buildComingUp,
  continueWorkingItems,
  fetchProjectApprovalProgress,
  fetchUnreadNotificationCount,
  fetchUpcomingMilestones,
  fetchUpcomingRecordEnds,
  freeInstruments,
  groupComingUp,
  homeIsoDay,
  homePace,
  homeUpcomingWindow,
  homeWaitingItem,
  pickUpItems,
} from './home-quiet'

const NOW = new Date('2026-09-25T09:30:00.000Z')
const TZ = 'Europe/London'

function recent(overrides: Partial<RecentItem>): RecentItem {
  const id = overrides.id ?? 'rec-1'
  return {
    kind: 'record',
    id,
    label: 'Harvest clarification',
    identifier: 'EXP-0145',
    destination: `/experiments/${id}`,
    signal: 'viewed',
    lastActivityAt: '2026-09-25T08:00:00.000Z',
    viewedAt: '2026-09-25T08:00:00.000Z',
    editedAt: null,
    status: 'draft',
    ...overrides,
  }
}

const bookingWire = (
  overrides: Partial<CalendarBookingWire>,
): CalendarBookingWire => ({
  id: 'booking-1',
  workspace_id: 'ws-1',
  resource_id: 'resource-1',
  project_id: null,
  title: 'inoculation',
  status: 'confirmed',
  all_day: false,
  starts_at: '2026-09-28T08:00:00.000Z',
  ends_at: '2026-09-28T10:00:00.000Z',
  timezone: TZ,
  location: null,
  color: null,
  notes: null,
  linked_experiment_record_id: null,
  linked_experiment_identifier: null,
  linked_experiment_title: null,
  metadata_version: 1,
  cancelled_at: null,
  created_at: '2026-09-20T08:00:00.000Z',
  updated_at: '2026-09-20T08:00:00.000Z',
  created_by_user_id: null,
  updated_by_user_id: null,
  ...overrides,
})

const instrumentWire = (
  overrides: Partial<CalendarInstrumentWire>,
): CalendarInstrumentWire => ({
  id: 'instrument-1',
  display_id: 'INS-0007',
  name: 'Plate reader PR-01',
  location: null,
  retired_at: null,
  ...overrides,
})

describe('homePace', () => {
  it('is quiet only when nothing waits on any authority', () => {
    expect(
      homePace({ inbox: 0, datasetsWithErrors: 0, unreadNotifications: 0 }),
    ).toBe('quiet')
  })

  it('is near-quiet for exactly one waiting item, whatever its source', () => {
    expect(
      homePace({ inbox: 1, datasetsWithErrors: 0, unreadNotifications: 0 }),
    ).toBe('near-quiet')
    expect(
      homePace({ inbox: 0, datasetsWithErrors: 1, unreadNotifications: 0 }),
    ).toBe('near-quiet')
    expect(
      homePace({ inbox: 0, datasetsWithErrors: 0, unreadNotifications: 1 }),
    ).toBe('near-quiet')
  })

  it('is busy once two things wait, counting across authorities', () => {
    expect(
      homePace({ inbox: 1, datasetsWithErrors: 1, unreadNotifications: 0 }),
    ).toBe('busy')
    expect(
      homePace({ inbox: 2, datasetsWithErrors: 0, unreadNotifications: 0 }),
    ).toBe('busy')
    expect(
      homePace({ inbox: 0, datasetsWithErrors: 0, unreadNotifications: 4 }),
    ).toBe('busy')
  })
})

describe('homeWaitingItem', () => {
  const counts = { inbox: 1, datasetsWithErrors: 0, unreadNotifications: 0 }

  it('names the review that is due, with its revision link', () => {
    expect(
      homeWaitingItem({
        counts,
        reviews: [{ revisionId: 'revision-1', identifier: 'EXP-0131' }],
        materials: [
          {
            recordId: 'lot-1',
            identifier: 'MAT-0420',
            reason: 'lot expires in 6 days',
          },
        ],
        datasetIssues: [
          {
            id: 'ds-1',
            identifier: 'DS-0298',
            label: '2 columns missing units',
          },
        ],
      }),
    ).toEqual({
      text: 'Review EXP-0131 is due',
      why: 'Assigned to you for review',
      action: 'Open review',
      to: '/review/revision-1',
    })
  })

  it('falls back to the expiring lot, then the flagged Dataset', () => {
    expect(
      homeWaitingItem({
        counts,
        reviews: [],
        materials: [
          {
            recordId: 'lot-1',
            identifier: 'MAT-0420',
            reason: 'lot expires in 6 days',
          },
        ],
        datasetIssues: [
          {
            id: 'ds-1',
            identifier: 'DS-0298',
            label: '2 columns missing units',
          },
        ],
      }),
    ).toMatchObject({
      text: 'MAT-0420 — lot expires in 6 days',
      to: '/materials?selected=lot-1',
    })
    expect(
      homeWaitingItem({
        counts,
        reviews: [],
        materials: [],
        datasetIssues: [
          {
            id: 'ds-1',
            identifier: 'DS-0298',
            label: '2 columns missing units',
          },
        ],
      }),
    ).toMatchObject({
      text: 'DS-0298 — 2 columns missing units',
      to: '/datasets?dataset=ds-1&archived=false',
    })
  })

  it('names an unread notification or a bare inbox item when it cannot be more specific', () => {
    expect(
      homeWaitingItem({
        counts: { inbox: 0, datasetsWithErrors: 0, unreadNotifications: 1 },
        reviews: [],
        materials: [],
        datasetIssues: [],
      }),
    ).toMatchObject({ text: 'One unread notification', to: '/inbox' })
    expect(
      homeWaitingItem({
        counts,
        reviews: [],
        materials: [],
        datasetIssues: [],
      }),
    ).toMatchObject({ text: 'One item in your inbox', to: '/inbox' })
  })
})

describe('the coming-up window', () => {
  it('spans fourteen days and reports the workspace calendar days', () => {
    const window = homeUpcomingWindow(NOW, TZ)
    expect(window.start).toBe('2026-09-25T09:30:00.000Z')
    expect(window.end).toBe('2026-10-09T09:30:00.000Z')
    expect(window.startDate).toBe('2026-09-25')
    expect(window.endDate).toBe('2026-10-09')
  })

  it('resolves the ISO day in the workspace timezone, not UTC', () => {
    // 23:30 UTC on the 25th is already the 26th in London (BST).
    expect(homeIsoDay(new Date('2026-09-25T23:30:00.000Z'), TZ)).toBe(
      '2026-09-26',
    )
    expect(homeIsoDay(new Date('2026-09-25T23:30:00.000Z'), 'UTC')).toBe(
      '2026-09-25',
    )
  })
})

describe('buildComingUp', () => {
  const projectNames = new Map([['project-1', 'AAV9 process transfer']])

  function entries(
    overrides: Partial<Parameters<typeof buildComingUp>[0]> = {},
  ) {
    return buildComingUp({
      bookings: [],
      resourceNames: new Map(),
      reviews: [],
      materials: [],
      plannedEnds: [],
      milestones: [],
      projectNames,
      now: NOW,
      timeZone: TZ,
      ...overrides,
    })
  }

  it('says why each entry is there and links to its own object', () => {
    const built = entries({
      bookings: [toCalendarBooking(bookingWire({}))],
      resourceNames: new Map([['resource-1', 'Ambr 250 bay 2']]),
      reviews: [
        {
          revisionId: 'revision-1',
          identifier: 'EXP-0131',
          dueAt: '2026-09-29T16:00:00.000Z',
        },
      ],
      materials: [
        {
          recordId: 'lot-1',
          identifier: 'MAT-0420',
          title: 'Filter train C',
          dueAt: '2026-10-01T00:00:00.000Z',
          reason: 'lot expires in 6 days',
        },
      ],
      plannedEnds: [
        {
          id: 'rec-1',
          identifier: 'EXP-0142',
          title: 'Clarification run',
          projectId: 'project-1',
          plannedEnd: '2026-09-30',
        },
      ],
      milestones: [
        {
          id: 'task-1',
          projectId: 'project-1',
          name: 'Clarification train selected',
          status: 'in_progress',
          dueAt: '2026-09-29T00:00:00.000Z',
        },
      ],
    })

    expect(built.map((entry) => entry.kind)).toEqual([
      'booking',
      'milestone',
      'review',
      'planned-end',
      'expiry',
    ])
    expect(built[0]).toMatchObject({
      text: 'Ambr 250 bay 2 · inoculation',
      why: 'You are booked',
      to: '/schedule',
      time: '09:00',
    })
    expect(built[1]).toMatchObject({
      text: 'Clarification train selected',
      why: 'AAV9 process transfer milestone',
      to: '/projects/project-1/milestones',
    })
    expect(built[2]).toMatchObject({
      why: 'Assigned to you for review',
      to: '/review/revision-1',
    })
    expect(built[3]).toMatchObject({
      text: 'Planned end of EXP-0142',
      why: 'Experiment in AAV9 process transfer',
      to: '/experiments/rec-1',
    })
    expect(built[4]).toMatchObject({
      why: 'A lot used in your work expires',
      to: '/materials?selected=lot-1',
    })
  })

  it('drops everything outside the two-week window', () => {
    const built = entries({
      bookings: [
        toCalendarBooking(
          bookingWire({ id: 'past', starts_at: '2026-09-24T08:00:00.000Z' }),
        ),
        toCalendarBooking(
          bookingWire({ id: 'far', starts_at: '2026-10-20T08:00:00.000Z' }),
        ),
        toCalendarBooking(
          bookingWire({ id: 'inside', starts_at: '2026-09-28T08:00:00.000Z' }),
        ),
      ],
      reviews: [
        {
          revisionId: 'r',
          identifier: 'EXP-1',
          dueAt: '2026-10-12T00:00:00.000Z',
        },
      ],
      milestones: [
        {
          id: 'task-1',
          projectId: 'project-1',
          name: 'Too late',
          status: 'planned',
          dueAt: '2026-10-12T00:00:00.000Z',
        },
      ],
      plannedEnds: [
        {
          id: 'rec-1',
          identifier: 'EXP-2',
          title: 'Too late',
          projectId: 'project-1',
          plannedEnd: '2026-10-11',
        },
      ],
    })
    expect(built.map((entry) => entry.key)).toEqual(['booking:inside'])
  })

  it('groups entries by workspace day, Today and Tomorrow named', () => {
    const built = entries({
      bookings: [
        toCalendarBooking(
          bookingWire({ id: 'today', starts_at: '2026-09-25T13:00:00.000Z' }),
        ),
        toCalendarBooking(
          bookingWire({
            id: 'tomorrow',
            starts_at: '2026-09-26T13:00:00.000Z',
          }),
        ),
        toCalendarBooking(
          bookingWire({ id: 'later', starts_at: '2026-09-30T13:00:00.000Z' }),
        ),
      ],
    })
    const groups = groupComingUp(built, NOW, TZ)
    expect(groups.map((group) => [group.day, group.label])).toEqual([
      ['2026-09-25', 'Today'],
      ['2026-09-26', 'Tomorrow'],
      ['2026-09-30', 'Wed 30 Sep'],
    ])
    expect(groups[2].entries).toHaveLength(1)
  })
})

describe('per-project approval progress', () => {
  it('counts each project’s own approved and in-review experiments', async () => {
    const urls: string[] = []
    const client = createDataClient(
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input), 'http://sheetbase.test')
        urls.push(url.pathname + url.search)
        const approved = url.searchParams.get('status') === 'eq.approved'
        return new Response('[{"id":"one-row"}]', {
          headers: { 'content-range': `0-0/${approved ? 9 : 2}` },
        })
      }),
    )
    expect(
      await fetchProjectApprovalProgress(client, [
        {
          id: 'project-1',
          title: 'AAV9 process transfer',
          stage: 'Clarification development',
          experimentCount: 14,
        },
      ]),
    ).toEqual([
      {
        id: 'project-1',
        title: 'AAV9 process transfer',
        stage: 'Clarification development',
        total: 14,
        approved: 9,
        inReview: 2,
      },
    ])
    expect(urls).toEqual([
      '/api/db/records?project_id=eq.project-1&kind=eq.experiment&archived_at=is.null&status=eq.approved',
      '/api/db/records?project_id=eq.project-1&kind=eq.experiment&archived_at=is.null&status=eq.in_review',
    ])
  })
})

describe('pickUpItems', () => {
  it('picks only the person’s own unfinished records, with a reason', () => {
    const recents = [
      recent({ id: 'draft', status: 'draft', identifier: 'EXP-0145' }),
      recent({
        id: 'paused',
        status: 'paused',
        identifier: 'EXP-0146',
        kind: 'record',
      }),
      recent({ id: 'approved', status: 'approved', identifier: 'EXP-0140' }),
      recent({
        id: 'sheet',
        kind: 'sheet',
        status: 'active',
        identifier: null,
        destination: '/sheets/sheet-1',
      }),
    ]
    const picked = pickUpItems(recents, recentStatusLabel, describeRecentChange)
    expect(picked.map((item) => item.identifier)).toEqual([
      'EXP-0145',
      'EXP-0146',
    ])
    expect(picked[0]).toMatchObject({
      action: 'Continue draft',
      why: 'Draft · Viewed record',
      to: '/experiments/draft',
    })
    expect(picked[1].action).toBe('Open experiment')

    expect(
      continueWorkingItems(recents, picked).map((item) => item.id),
    ).toEqual(['approved', 'sheet'])
  })
})

describe('freeInstruments', () => {
  it('lists instruments nothing is booked on, and when the next booking starts', () => {
    const free = freeInstruments(
      [
        toCalendarInstrument(
          instrumentWire({ id: 'busy', name: 'Plate reader PR-01' }),
        ),
        toCalendarInstrument(
          instrumentWire({
            id: 'later',
            display_id: 'INS-0009',
            name: 'Turbidimeter TB-02',
          }),
        ),
        toCalendarInstrument(
          instrumentWire({
            id: 'retired',
            display_id: 'INS-0006',
            name: 'Old reader',
            retired_at: '2026-09-01T00:00:00.000Z',
          }),
        ),
      ],
      [
        toCalendarBooking(
          bookingWire({
            id: 'now',
            resource_id: 'busy',
            starts_at: '2026-09-25T09:00:00.000Z',
            ends_at: '2026-09-25T10:00:00.000Z',
          }),
        ),
        toCalendarBooking(
          bookingWire({
            id: 'next',
            resource_id: 'later',
            starts_at: '2026-09-25T14:00:00.000Z',
            ends_at: '2026-09-25T15:00:00.000Z',
          }),
        ),
      ],
      NOW,
      TZ,
    )
    // The booking's resource_id IS the instrument id (ADR-0054), so 'busy' is
    // covered, 'later' is next free at 15:00, and a retired instrument is not
    // offered at all.
    expect(free).toEqual([
      {
        id: 'later',
        displayId: 'INS-0009',
        name: 'Turbidimeter TB-02',
        label: 'Free until 15:00',
      },
    ])
  })

  it('says an instrument is free all day when its next booking is not today', () => {
    const free = freeInstruments(
      [toCalendarInstrument(instrumentWire({ id: 'resource-1' }))],
      [
        toCalendarBooking(
          bookingWire({
            id: 'tomorrow',
            starts_at: '2026-09-26T14:00:00.000Z',
          }),
        ),
      ],
      NOW,
      TZ,
    )
    expect(free[0].label).toBe('Free all day')
  })
})

describe('the quiet Home reads', () => {
  it('counts unread notifications through the same authority the bell reads', async () => {
    const urls: string[] = []
    const client = createDataClient(
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input), 'http://sheetbase.test')
        urls.push(url.pathname + url.search)
        return new Response('[{"id":"one-row"}]', {
          headers: { 'content-range': '0-0/4' },
        })
      }),
    )
    expect(await fetchUnreadNotificationCount(client)).toBe(4)
    expect(urls).toEqual(['/api/db/my_notifications?read_at=is.null'])
  })

  it('reads planned ends only inside the window, for experiments that are live', async () => {
    const urls: string[] = []
    const client = createDataClient(
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input), 'http://sheetbase.test')
        urls.push(url.pathname + url.search)
        return new Response(
          JSON.stringify([
            {
              id: 'rec-1',
              identifier: 'EXP-0142',
              title: 'Clarification run',
              project_id: 'project-1',
              planned_end: '2026-09-30',
            },
          ]),
        )
      }),
    )
    const window = homeUpcomingWindow(NOW, TZ)
    expect(await fetchUpcomingRecordEnds(client, 'ws-1', window)).toEqual([
      {
        id: 'rec-1',
        identifier: 'EXP-0142',
        title: 'Clarification run',
        projectId: 'project-1',
        plannedEnd: '2026-09-30',
      },
    ])
    expect(urls[0]).toBe(
      '/api/db/records?workspace_id=eq.ws-1&kind=eq.experiment&archived_at=is.null&deleted_at=is.null' +
        '&planned_end=gte.2026-09-25&planned_end=lte.2026-10-09' +
        '&select=id,identifier,title,project_id,planned_end&order=planned_end.asc,id.asc&limit=50',
    )
  })

  it('reads milestones for the person’s projects, skipping the delivered ones', async () => {
    const urls: string[] = []
    const client = createDataClient(
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input), 'http://sheetbase.test')
        urls.push(url.pathname + url.search)
        return new Response(
          JSON.stringify([
            {
              id: 'task-1',
              project_id: 'project-1',
              title: 'Clarification train selected',
              status: 'in_progress',
              due_at: '2026-09-29T00:00:00.000Z',
            },
          ]),
        )
      }),
    )
    const window = homeUpcomingWindow(NOW, TZ)
    expect(
      await fetchUpcomingMilestones(client, ['project-1'], window),
    ).toEqual([
      {
        id: 'task-1',
        projectId: 'project-1',
        name: 'Clarification train selected',
        status: 'in_progress',
        dueAt: '2026-09-29T00:00:00.000Z',
      },
    ])
    expect(urls[0]).toContain('project_id=in.(project-1)')
    expect(urls[0]).toContain('task_type=eq.milestone')
    expect(urls[0]).toContain('status=neq.delivered')
  })

  it('does not read milestones when the person has no project', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const client = createDataClient(fetchImpl)
    expect(
      await fetchUpcomingMilestones(client, [], homeUpcomingWindow(NOW, TZ)),
    ).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
