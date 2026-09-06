/** ADMIN-02 — webhook operations section tests. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminWebhooks } from './admin-webhooks'
import type * as WebhookAdmin from '#/lib/webhook-admin'
import type {
  WebhookDeliveryWire,
  WebhookHealthResultWire,
  WebhookSubscriptionWire,
} from '#/lib/webhook-admin'

const subscriptions: WebhookSubscriptionWire[] = [
  {
    id: 'sub-orders',
    key: 'orders',
    url: 'https://example.com/orders',
    description: null,
    eventTypes: ['record.created'],
    status: 'active',
    maxRetries: 5,
    failureThreshold: 10,
    consecutiveFailures: 2,
    rateLimitPerMinute: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  },
  {
    id: 'sub-billing',
    key: 'billing',
    url: 'https://example.com/billing',
    description: null,
    eventTypes: [],
    status: 'disabled',
    maxRetries: 5,
    failureThreshold: 3,
    consecutiveFailures: 3,
    rateLimitPerMinute: 60,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  },
]

const health: WebhookHealthResultWire = {
  generatedAt: '2026-09-06T10:00:00.000Z',
  data: [
    {
      subscriptionId: 'sub-orders',
      key: 'orders',
      url: 'https://example.com/orders',
      status: 'active',
      consecutiveFailures: 2,
      failureThreshold: 10,
      maxRetries: 5,
      rateLimitPerMinute: null,
      total24h: 20,
      delivered24h: 15,
      failed24h: 3,
      deadLetter24h: 2,
      retrying24h: 1,
      pending24h: 0,
      successRate24h: 0.75,
      lastDeliveredAt: '2026-09-05T10:00:00.000Z',
      oldestPendingAt: null,
      lastError: {
        code: 'http_500',
        message: 'upstream failed',
        at: '2026-09-05T11:00:00.000Z',
        deliveryId: 'del-dead',
      },
    },
    {
      subscriptionId: 'sub-billing',
      key: 'billing',
      url: 'https://example.com/billing',
      status: 'disabled',
      consecutiveFailures: 3,
      failureThreshold: 3,
      maxRetries: 5,
      rateLimitPerMinute: 60,
      total24h: 0,
      delivered24h: 0,
      failed24h: 0,
      deadLetter24h: 0,
      retrying24h: 0,
      pending24h: 0,
      successRate24h: null,
      lastDeliveredAt: null,
      oldestPendingAt: null,
      lastError: null,
    },
  ],
}

const deliveries: WebhookDeliveryWire[] = [
  {
    id: 'del-dead',
    subscriptionId: 'sub-orders',
    changeEventId: 'evt-1',
    eventType: 'record.created',
    attempt: 5,
    status: 'dead_letter',
    responseStatus: 500,
    responseBody: null,
    errorCode: 'http_500',
    errorMessage: 'attempt 5 failed with 500',
    replayOfDeliveryId: null,
    nextAttemptAt: null,
    deliveredAt: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T12:00:00.000Z',
  },
  {
    id: 'del-pending',
    subscriptionId: 'sub-orders',
    changeEventId: 'evt-2',
    eventType: 'record.created',
    attempt: 0,
    status: 'pending',
    responseStatus: null,
    responseBody: null,
    errorCode: null,
    errorMessage: null,
    replayOfDeliveryId: null,
    nextAttemptAt: '2026-09-06T11:00:00.000Z',
    deliveredAt: null,
    createdAt: '2026-09-06T09:00:00.000Z',
    updatedAt: '2026-09-06T09:00:00.000Z',
  },
]

const mocks = vi.hoisted(() => ({
  listSubs: vi.fn(),
  fetchHealth: vi.fn(),
  listDeliveries: vi.fn(),
  setStatus: vi.fn(),
  archive: vi.fn(),
  rotate: vi.fn(),
  replayOne: vi.fn(),
  replayMany: vi.fn(),
}))

vi.mock('#/lib/webhook-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof WebhookAdmin>()
  return {
    ...actual,
    listWebhookSubscriptionsFn: mocks.listSubs,
    fetchWebhookHealthFn: mocks.fetchHealth,
    listWebhookDeliveriesFn: mocks.listDeliveries,
    setWebhookSubscriptionStatusFn: mocks.setStatus,
    archiveWebhookSubscriptionFn: mocks.archive,
    rotateWebhookSecretFn: mocks.rotate,
    replayWebhookDeliveryFn: mocks.replayOne,
    replayWebhookDeliveriesFn: mocks.replayMany,
  }
})

function setup(role = 'owner') {
  mocks.listSubs.mockResolvedValue(subscriptions)
  mocks.fetchHealth.mockResolvedValue(health)
  mocks.listDeliveries.mockResolvedValue({
    data: deliveries,
    total: 2,
    limit: 50,
    offset: 0,
  })
  mocks.setStatus.mockImplementation(
    async ({
      data,
    }: {
      data: { subscriptionId: string; status: string }
    }) => ({
      ...subscriptions.find((s) => s.id === data.subscriptionId)!,
      status: data.status,
    }),
  )
  mocks.replayOne.mockResolvedValue(deliveries[0])
  mocks.replayMany.mockResolvedValue({ replayedCount: 2, deliveryIds: [] })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AdminWebhooks workspaceId="ws-1" role={role} />
    </QueryClientProvider>,
  )
  return client
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminWebhooks', () => {
  it('renders subscriptions with EVENT-02 health and auto-disable state', async () => {
    setup()
    expect((await screen.findAllByText('orders')).length).toBeGreaterThanOrEqual(
      2,
    )
    expect(await screen.findByText('75.0% (15/20)')).toBeTruthy()
    expect(await screen.findByText('Auto-disabled')).toBeTruthy()
    expect(await screen.findByText('No traffic 24h')).toBeTruthy()
    expect(screen.getAllByText(/http_500/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('2/10')).toBeTruthy()
  })

  it('shows delivery history with the dead-letter reason', async () => {
    setup()
    expect(
      await screen.findByText('http_500 — attempt 5 failed with 500'),
    ).toBeTruthy()
    expect(
      screen.getAllByText('Dead letter').length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('offers replay only for terminal deliveries', async () => {
    setup()
    await screen.findByText('http_500 — attempt 5 failed with 500')
    expect(screen.getAllByRole('button', { name: 'Replay' })).toHaveLength(1)
    const deadLetterRow = screen
      .getAllByText('Dead letter')
      .map((element) => element.closest('tr'))
      .find(Boolean)
    expect(deadLetterRow).toBeTruthy()
    expect(
      within(deadLetterRow as HTMLElement).getByRole('button', {
        name: 'Replay',
      }),
    ).toBeTruthy()
  })

  it('disables and re-enables through the status operation', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findAllByText('orders')
    await user.click(screen.getAllByRole('button', { name: 'Disable' })[0])
    expect(mocks.setStatus).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-1',
        subscriptionId: 'sub-orders',
        status: 'disabled',
      },
    })
    await user.click(screen.getAllByRole('button', { name: 'Enable' })[0])
    expect(mocks.setStatus).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-1',
        subscriptionId: 'sub-billing',
        status: 'active',
      },
    })
  })

  it('replays a single delivery and a window', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(
      await screen.findByRole('button', { name: 'Replay' }),
    )
    expect(mocks.replayOne).toHaveBeenCalledWith({
      data: { workspaceId: 'ws-1', deliveryId: 'del-dead' },
    })
    await user.click(
      screen.getByRole('button', { name: 'Replay window' }),
    )
    expect(mocks.replayMany).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-1',
        subscriptionId: null,
        since: null,
        until: null,
        status: 'dead_letter',
        limit: 50,
      },
    })
    expect(await screen.findByText(/Replayed 2 dead_letter/)).toBeTruthy()
  })

  it('reveals a rotated secret exactly once with dismissal', async () => {
    const user = userEvent.setup()
    mocks.rotate.mockResolvedValue({
      subscriptionId: 'sub-orders',
      signingSecret: 'new-secret-once',
    })
    setup()
    await user.click(
      (await screen.findAllByRole('button', { name: 'Rotate secret' }))[0],
    )
    expect(await screen.findByText('new-secret-once')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('new-secret-once')).toBeNull()
  })

  it('fail-closes for roles without integrations.manage', async () => {
    setup('member')
    expect(
      await screen.findByText(/integrations\.manage/),
    ).toBeTruthy()
    expect(mocks.listSubs).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull()
  })
})
