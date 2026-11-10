import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AuditEventsPageWire } from '#/lib/audit-history'
import { DatasetHistoryTab } from './dataset-history-tab'
import { datasetTabTestServer } from './dataset-tab-test-server'

const page: AuditEventsPageWire = {
  formatVersion: 1,
  events: [
    {
      sequence: 7,
      id: 'event-1',
      createdAt: '2026-09-25T10:11:00.000000Z',
      entityType: 'dataset',
      entityUuid: 'ds-1',
      operation: 'update',
      recordId: null,
      projectId: null,
      actorUserId: 'user-1',
      actorName: 'Priya Raman',
      actorCredentialId: null,
      clientId: null,
      payload: { changes: { name: { from: 'Old name', to: 'New name' } } },
    },
  ],
  hasMore: false,
  nextCursor: null,
}

async function renderTab(...replies: Parameters<typeof datasetTabTestServer>) {
  const context = await datasetTabTestServer(...replies)

  const root = createRootRoute({
    component: () => (
      <DatasetHistoryTab datasetId="ds-1" client={context.client} />
    ),
  })

  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <QueryClientProvider client={context.queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return context
}

describe('DatasetHistoryTab', () => {
  it('renders the dataset’s change_events page through the timeline', async () => {
    const { requests } = await renderTab({ body: JSON.stringify(page) })
    expect(await screen.findByText('Priya Raman')).toBeTruthy()
    expect(screen.getByText('Old name')).toBeTruthy()
    expect(screen.getByText('New name')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open dataset' }).getAttribute('href'),
    ).toBe('/datasets/ds-1')
    expect(requests[0]?.path).toBe('/api/db/rpc/audit_events')
    expect(JSON.parse(requests[0]?.body ?? 'null')).toEqual(
      expect.objectContaining({
        p_object: 'ds-1',
        p_limit: 50,
        p_before_sequence: null,
      }),
    )
  })

  it('shows an honest empty state when the dataset has no changes', async () => {
    await renderTab({ body: JSON.stringify({ ...page, events: [] }) })
    expect(await screen.findByText('No recorded activity yet')).toBeTruthy()
  })

  it('shows a denied state rather than an empty list', async () => {
    await renderTab({
      status: 403,
      body: JSON.stringify({
        error: { code: 'permission_denied', message: 'denied' },
      }),
    })
    expect(
      await screen.findByText('History isn’t available for this dataset'),
    ).toBeTruthy()
    expect(screen.queryByText('No recorded activity yet')).toBeNull()
  })

  it('uses the canonical sequence cursor for the next page and keeps earlier events', async () => {
    const { requests } = await renderTab(
      { body: JSON.stringify({ ...page, hasMore: true, nextCursor: 7 }) },
      {
        body: JSON.stringify({
          ...page,
          events: page.events.map((event) => ({
            ...event,
            id: 'event-2',
            sequence: 6,
            actorName: 'Second actor',
          })),
        }),
      },
    )

    expect(await screen.findByText('Priya Raman')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Second actor')).toBeTruthy()
    expect(screen.getByText('Priya Raman')).toBeTruthy()
    expect(requests[1]?.path).toBe('/api/db/rpc/audit_events')
    expect(JSON.parse(requests[1]?.body ?? 'null')).toEqual(
      expect.objectContaining({
        p_object: 'ds-1',
        p_limit: 50,
        p_before_sequence: 7,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('does not show empty history while the read is pending', async () => {
    let release: () => void = () => undefined

    const ready = new Promise<void>((resolve) => {
      release = resolve
    })

    await renderTab({ body: JSON.stringify(page), ready })
    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-slot="history-timeline"][aria-busy="true"]',
        ),
      ).toBeTruthy(),
    )
    expect(screen.queryByText('No recorded activity yet')).toBeNull()
    release()
    expect(await screen.findByText('Priya Raman')).toBeTruthy()
  })

  it('shows a server error without claiming empty or denied history', async () => {
    await renderTab({
      status: 500,
      body: JSON.stringify({
        error: { code: 'upstream_error', message: 'failed' },
      }),
    })
    expect(await screen.findByText('History couldn’t be loaded')).toBeTruthy()
    expect(screen.queryByText('No recorded activity yet')).toBeNull()
    expect(
      screen.queryByText('History isn’t available for this dataset'),
    ).toBeNull()
  })
})
