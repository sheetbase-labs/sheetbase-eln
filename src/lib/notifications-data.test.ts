import { describe, expect, it, vi } from 'vitest'

import {
  fetchLatestReviews,
  isReviewNotification,
  notificationDestination,
} from './notifications-data'
import type { NotificationItem } from './notifications-data'
import type { DataClient } from './data-client'

function notification(
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id: 'n1',
    eventType: 'review_requested',
    title: 'Review requested',
    body: null,
    recordId: 'record-1',
    projectId: 'project-1',
    createdAt: '2026-10-01T09:00:00Z',
    readAt: null,
    ...overrides,
  }
}

describe('notificationDestination', () => {
  it('opens a review request on the review for its revision', () => {
    const reviews = new Map([
      ['record-1', { revisionId: 'rev-9', state: 'submitted' }],
    ])
    expect(notificationDestination(notification(), reviews)).toBe(
      '/review/rev-9',
    )
    expect(
      notificationDestination(
        notification({ eventType: 'signature_requested' }),
        reviews,
      ),
    ).toBe('/review/rev-9')
  })

  it('opens a review that came back on the record, where the changes are made', () => {
    const reviews = new Map([
      ['record-1', { revisionId: 'rev-9', state: 'returned' }],
    ])
    expect(
      notificationDestination(
        notification({ eventType: 'review_returned_or_signed' }),
        reviews,
      ),
    ).toBe('/records/record-1')
  })

  it('falls back to the record until the review is known, and for other events', () => {
    expect(notificationDestination(notification())).toBe('/records/record-1')
    expect(
      notificationDestination(
        notification({ eventType: 'comment_or_mention' }),
        new Map([['record-1', { revisionId: 'rev-9', state: 'submitted' }]]),
      ),
    ).toBe('/records/record-1')
  })

  it('has no destination for a notification about no record', () => {
    expect(
      notificationDestination(notification({ recordId: null })),
    ).toBeUndefined()
  })
})

describe('fetchLatestReviews', () => {
  it('asks once for the records review notifications name and keeps the newest submission', async () => {
    const list = vi.fn(async () => [
      { record_id: 'record-1', revision_id: 'rev-new', state: 'submitted' },
      { record_id: 'record-1', revision_id: 'rev-old', state: 'returned' },
    ])
    const latest = await fetchLatestReviews(
      [
        notification(),
        notification({ id: 'n2' }),
        notification({ id: 'n3', eventType: 'comment_or_mention' }),
      ],
      { list } as unknown as DataClient,
    )
    expect(list).toHaveBeenCalledTimes(1)
    expect(latest.get('record-1')).toEqual({
      revisionId: 'rev-new',
      state: 'submitted',
    })
  })

  it('does not ask when no notification is about a review', async () => {
    const list = vi.fn(async () => [])
    const latest = await fetchLatestReviews(
      [notification({ eventType: 'comment_or_mention' })],
      { list } as unknown as DataClient,
    )
    expect(list).not.toHaveBeenCalled()
    expect(latest.size).toBe(0)
  })
})

describe('isReviewNotification', () => {
  it('needs both a review event and a record', () => {
    expect(isReviewNotification(notification())).toBe(true)
    expect(isReviewNotification(notification({ recordId: null }))).toBe(false)
  })
})
