/**
 * The experiment Links tab lists the instrument bookings made for the
 * experiment, and offers a booking that comes back here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type * as router from '@tanstack/react-router'

import { dropSharedReads } from '#/lib/data-client'
import { ExperimentBookings, LinksPanel } from '../-links-tab'

/** The bookings the fake database answers with, per test. */
const bookings = vi.hoisted<{ rows: unknown[] }>(() => ({ rows: [] }))

/** Every `/api/db` URL this suite asked for. */
const reads = vi.hoisted<{ urls: string[] }>(() => ({ urls: [] }))

for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

// oxlint-disable-next-line anti-slop/no-module-mocking -- `Link` needs a mounted router and this suite renders one tab on its own; the mock keeps the real module's other exports and renders a plain anchor.
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

// The one boundary this suite fakes: the same-origin `/api/db` transport. It is
// installed before the modules that capture `fetch` are imported.
vi.hoisted(() => {
  const transport: typeof fetch = async (input) => {
    const url = new URL(
      z
        .union([z.string(), z.instanceof(URL), z.instanceof(Request)])
        .transform((value) => {
          if (value instanceof URL) return value.toString()

          if (value instanceof Request) return value.url

          return value
        })
        .parse(input),
      'http://localhost',
    )

    reads.urls.push(`${url.pathname}${url.search}`)

    return new Response(
      JSON.stringify(
        url.pathname.endsWith('/calendar_bookings') ? bookings.rows : [],
      ),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  globalThis.fetch = transport
})

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

beforeEach(() => {
  // Identical reads are shared for a moment; each test starts from its own.
  dropSharedReads()
  bookings.rows = []
  reads.urls = []
})

afterEach(cleanup)

describe('ExperimentBookings', () => {
  it('asks for this experiment’s live bookings only', async () => {
    renderBookings()
    await waitFor(() => expect(reads.urls).not.toHaveLength(0))
    const [read] = reads.urls
    expect(read).toContain('/calendar_bookings?')
    expect(read).toContain('linked_experiment_record_id=eq.exp-1')
    expect(read).toContain('cancelled_at=is.null')
  })

  it('lists a booking and offers a booking that returns to the experiment', async () => {
    bookings.rows = [
      {
        id: 'b-1',
        title: 'EXP-1 Titration',
        status: 'confirmed',
        starts_at: '2026-10-20T09:00:00.000Z',
      },
    ]
    renderBookings()
    expect(await screen.findByText('EXP-1 Titration')).toBeTruthy()
    const book = screen.getByRole('link', { name: 'Book an instrument' })
    expect(book.getAttribute('href')).toContain('experiment=exp-1')
    expect(decodeURIComponent(book.getAttribute('href') ?? '')).toContain(
      'returnTo=/experiments/exp-1/data/links',
    )
  })

  it('says so when nothing is booked', async () => {
    renderBookings()
    expect(await screen.findByText('No instrument booked')).toBeTruthy()
  })
})

describe('LinksPanel samples', () => {
  it('offers to link a sample even when none is linked yet', async () => {
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
