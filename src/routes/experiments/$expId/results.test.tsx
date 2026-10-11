import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './results'

const data = vi.hoisted(() => ({ list: vi.fn(), rpc: vi.fn() }))
const routeContext = vi.hoisted(() => ({
  value: {
    capabilities: { sampleMeasurements: false, experimentResults: false },
    auth: { workspace: { role: 'scientist' } },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ expId: 'EXP-1' }),
    useRouteContext: () => routeContext.value,
    options: config,
  }),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to?: string
    params?: Record<string, string>
    children?: React.ReactNode
  } & Record<string, unknown>) => {
    let href = typeof to === 'string' ? to : '#'
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, encodeURIComponent(String(value)))
      }
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: data }))

vi.mock('../$expId', () => ({
  useExperimentLinks: () => ({ data: [] }),
}))

const ResultsTab = Route.options.component as React.ComponentType

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ResultsTab />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  routeContext.value = {
    capabilities: { sampleMeasurements: false, experimentResults: false },
    auth: { workspace: { role: 'scientist' } },
  }
  data.list.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('experiment results capability gap', () => {
  it('shows the honest gap with real alternatives and reads nothing', () => {
    renderTab()

    expect(
      screen.getByRole('heading', {
        name: 'Curated results aren’t available in this workspace yet',
      }),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    // No figure, table or decision is fabricated while the capability is off.
    expect(screen.queryByText('Figure')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull()
    expect(data.list).not.toHaveBeenCalled()

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/experiments/EXP-1/datasets')
    expect(hrefs).toContain('/experiments/EXP-1/notebook')
  })

  it('shows the roadmap chip only to workspace admins', () => {
    renderTab()
    expect(screen.queryByText(/Tracked as/)).toBeNull()

    cleanup()
    routeContext.value = {
      capabilities: { sampleMeasurements: false, experimentResults: false },
      auth: { workspace: { role: 'admin' } },
    }
    renderTab()
    expect(screen.getByText(/RM-118/)).toBeTruthy()
  })

  it('renders the real sections when the capability is on', async () => {
    routeContext.value = {
      capabilities: { sampleMeasurements: false, experimentResults: true },
      auth: { workspace: { role: 'scientist' } },
    }

    renderTab()

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Record decision' }),
      ).toBeTruthy(),
    )
    expect(screen.queryByText(/Not in this release yet/)).toBeNull()
    expect(screen.getByText('No cited analyses')).toBeTruthy()
    expect(screen.getByText('No datasets')).toBeTruthy()
  })
})
