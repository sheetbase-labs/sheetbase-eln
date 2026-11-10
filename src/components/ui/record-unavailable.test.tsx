import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaneContext } from '#/components/workspace/workspace-navigation'
import type { PaneContextValue } from '#/components/workspace/workspace-navigation'

import { RecordUnavailable } from './record-unavailable'

afterEach(cleanup)

/** Render inside a real router so `Link` builds its href from real route state. */
function renderInRouter(ui: React.ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(<RouterProvider router={router} />)
}

const back = { to: '/samples' as const, label: 'Back to samples' }

function query(
  overrides: Partial<Parameters<typeof RecordUnavailable>[0]['query']> = {},
) {
  return {
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

function pane(reportMissing: (missing: boolean) => void): PaneContextValue {
  return {
    paneId: 'p1',
    readOnly: false,
    reportNewer: () => {},
    reportFrozen: () => {},
    reportSelection: () => {},
    reportMissing,
  }
}

describe('RecordUnavailable', () => {
  it('renders nothing while the record is loading', () => {
    const { container } = renderInRouter(
      <RecordUnavailable
        query={query({ isLoading: true })}
        what="sample"
        back={back}
      />,
    )

    expect(container.textContent).toBe('')
  })

  it('says a missing record was not found and links back to its list', async () => {
    renderInRouter(
      <RecordUnavailable query={query()} what="sample" back={back} />,
    )

    expect(await screen.findByText('This sample wasn’t found.')).toBeTruthy()
    expect(
      screen.getByText('Back to samples').closest('a')?.getAttribute('href'),
    ).toBe('/samples')
  })

  it('offers a retry when the read failed', async () => {
    const refetch = vi.fn()
    renderInRouter(
      <RecordUnavailable
        query={query({ isError: true, error: new Error('boom'), refetch })}
        what="sample"
        back={back}
      />,
    )
    expect(await screen.findByText('Couldn’t load sample.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('tells its pane the record is missing, and withdraws it on unmount', async () => {
    const reportMissing = vi.fn()

    const { unmount } = renderInRouter(
      <PaneContext.Provider value={pane(reportMissing)}>
        <RecordUnavailable query={query()} what="sample" back={back} />
      </PaneContext.Provider>,
    )

    expect(await screen.findByText('This sample wasn’t found.')).toBeTruthy()
    expect(reportMissing).toHaveBeenLastCalledWith(true)
    unmount()
    expect(reportMissing).toHaveBeenLastCalledWith(false)
  })
})
