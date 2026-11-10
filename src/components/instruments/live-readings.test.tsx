import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'

import { setDisplayClock } from '#/lib/display-clock'
import { LiveChart } from './live-readings'
import { liveFeedQueryKeys } from './live-feeds-data'
import type { FeedRow } from './live-feeds-data'

const feed: FeedRow = {
  id: 'f1',
  ownerId: 'i1',
  instrumentId: 'i1',
  storageUnitId: null,
  storageRoomId: null,
  outOfRangeSince: null,
  name: 'Temperature',
  unit: '°C',
  lowLimit: null,
  highLimit: null,
  limitState: 'ok',
  lastValue: 4.2,
  lastAt: '2026-11-10T12:00:00Z',
  readingCount: 2,
}

afterEach(() => {
  vi.unstubAllEnvs()
  setDisplayClock('24h')
})

it('renders an uncached chart without server-local clock text', () => {
  vi.stubEnv('TZ', 'UTC')
  const client = new QueryClient()

  try {
    const html = renderToString(
      <QueryClientProvider client={client}>
        <LiveChart feed={feed} windowId="1h" />
      </QueryClientProvider>,
    )

    expect(html).not.toContain('<svg')
    expect(html).not.toMatch(/\d{2}:\d{2}/)
  } finally {
    client.clear()
  }
})

it('retains the cached SVG and hydrates local range text after a server/browser zone change', async () => {
  vi.stubEnv('TZ', 'UTC')
  const client = new QueryClient()
  client.setQueryData(liveFeedQueryKeys.series('f1', '1h'), {
    since: Date.parse('2026-11-10T12:00:00Z'),
    until: Date.parse('2026-11-10T13:00:00Z'),
    points: [
      {
        at: Date.parse('2026-11-10T12:30:00Z'),
        min: 4,
        avg: 4.2,
        max: 4.4,
        readings: 2,
      },
    ],
  })

  const view = (
    <QueryClientProvider client={client}>
      <LiveChart feed={feed} windowId="1h" />
    </QueryClientProvider>
  )

  const html = renderToString(view)
  expect(html).toContain('<svg')
  expect(html).not.toContain('12:00')
  expect(html).not.toContain('13:00')
  expect(html).not.toContain('12:30:00')
  vi.stubEnv('TZ', 'America/New_York')
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.append(container)
  const errors: string[] = []

  const root = hydrateRoot(container, view, {
    onRecoverableError: (error) =>
      errors.push(error instanceof Error ? error.message : String(error)),
  })

  try {
    await waitFor(() =>
      expect(container.textContent).toContain('07:00 – 08:00'),
    )
    expect(container.querySelector('svg')).not.toBeNull()
    expect(errors).toEqual([])
  } finally {
    await act(async () => root.unmount())
    container.remove()
    client.clear()
  }
})
