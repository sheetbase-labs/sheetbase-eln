/**
 * The experiment Links tab lists the instrument bookings made for the
 * experiment, and offers a booking that comes back here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as router from '@tanstack/react-router'

import { ExperimentBookings, LinksPanel } from './-links-tab'

const dataClient = vi.hoisted(() => ({ list: vi.fn(), rpc: vi.fn() }))

for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof router>()),
  Link: ({
    to,
    search,
    children,
  }: {
    to?: string
    search?: Record<string, string>
    children?: React.ReactNode
  }) => (
    <a href={`${to ?? '#'}?${new URLSearchParams(search ?? {}).toString()}`}>
      {children}
    </a>
  ),
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

function renderBookings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ExperimentBookings expId="exp-1" />
    </QueryClientProvider>,
  )
}

beforeEach(() => dataClient.list.mockReset())
afterEach(cleanup)

describe('ExperimentBookings', () => {
  it('asks for this experiment’s live bookings only', async () => {
    dataClient.list.mockResolvedValue([])
    renderBookings()
    await waitFor(() => expect(dataClient.list).toHaveBeenCalled())
    const [resource, query] = dataClient.list.mock.calls[0] ?? []
    expect(resource).toBe('calendar_bookings')
    expect(query).toContain('linked_experiment_record_id=eq.exp-1')
    expect(query).toContain('cancelled_at=is.null')
  })

  it('lists a booking and offers a booking that returns to the experiment', async () => {
    dataClient.list.mockResolvedValue([
      {
        id: 'b-1',
        title: 'EXP-1 Titration',
        status: 'confirmed',
        starts_at: '2026-10-20T09:00:00.000Z',
      },
    ])
    renderBookings()
    expect(await screen.findByText('EXP-1 Titration')).toBeTruthy()
    const book = screen.getByRole('link', { name: 'Book an instrument' })
    expect(book.getAttribute('href')).toContain('experiment=exp-1')
    expect(decodeURIComponent(book.getAttribute('href') ?? '')).toContain(
      'returnTo=/experiments/exp-1/links',
    )
  })

  it('says so when nothing is booked', async () => {
    dataClient.list.mockResolvedValue([])
    renderBookings()
    expect(await screen.findByText('No instrument booked')).toBeTruthy()
  })
})

describe('LinksPanel samples', () => {
  it('offers to link a sample even when none is linked yet', async () => {
    dataClient.list.mockResolvedValue([])
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <LinksPanel expId="exp-1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('No samples linked')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Link a sample' })).toBeTruthy()
  })
})
