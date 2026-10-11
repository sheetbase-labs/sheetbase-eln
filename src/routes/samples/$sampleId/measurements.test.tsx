import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SampleMeasurement } from '#/lib/samples'

import { Route } from './measurements'

const samples = vi.hoisted(() => ({ fetchSampleMeasurements: vi.fn() }))
const routeContext = vi.hoisted(() => ({
  value: {
    capabilities: { sampleMeasurements: false, experimentResults: false },
    auth: { workspace: { role: 'scientist' } },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ sampleId: 's-1' }),
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

vi.mock('#/lib/samples', () => ({
  fetchSampleMeasurements: samples.fetchSampleMeasurements,
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

const MeasurementsTab = Route.options.component as React.ComponentType

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MeasurementsTab />
    </QueryClientProvider>,
  )
}

function measurement(
  overrides: Partial<SampleMeasurement> = {},
): SampleMeasurement {
  return {
    id: 'm-1',
    measurement: 'Capsid titre',
    value: 860000000000,
    valueText: '8.6 x 10^11 cp/mL',
    unit: 'cp/mL',
    method: 'ddPCR',
    source: 'QC run QC-14',
    result: 'pass',
    measuredAt: '2026-09-16T00:00:00.000Z',
    provenance: {
      kind: 'integration',
      datasetId: null,
      datasetDisplayId: null,
      datasetName: null,
      rowId: null,
      fieldId: null,
      fieldKey: null,
      sourceId: null,
      runId: null,
      runIdentifier: null,
      instrumentId: null,
      instrumentName: null,
    },
    ...overrides,
  }
}

beforeEach(() => {
  routeContext.value = {
    capabilities: { sampleMeasurements: false, experimentResults: false },
    auth: { workspace: { role: 'scientist' } },
  }
  samples.fetchSampleMeasurements.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('sample measurements capability gap', () => {
  it('shows the honest gap with real alternatives and reads no values', () => {
    renderTab()

    expect(
      screen.getByRole('heading', {
        name: 'Measurements aren’t recorded on samples in this workspace yet',
      }),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    // The gap is not a data state: no value, count or table is fabricated.
    expect(screen.queryByText(/Capsid titre/)).toBeNull()
    expect(samples.fetchSampleMeasurements).not.toHaveBeenCalled()

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/datasets')
    expect(hrefs).toContain('/samples/s-1/history')
  })

  it('shows the roadmap chip only to workspace admins', () => {
    renderTab()
    expect(screen.queryByText(/Tracked as/)).toBeNull()

    cleanup()
    routeContext.value = {
      capabilities: { sampleMeasurements: false, experimentResults: false },
      auth: { workspace: { role: 'owner' } },
    }
    renderTab()
    expect(screen.getByText(/RM-112/)).toBeTruthy()
  })

  it('renders the table when the deployment records measurements', async () => {
    routeContext.value = {
      capabilities: { sampleMeasurements: true, experimentResults: false },
      auth: { workspace: { role: 'scientist' } },
    }
    samples.fetchSampleMeasurements.mockResolvedValue([measurement()])

    renderTab()

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    expect(screen.getByText('Capsid titre')).toBeTruthy()
    expect(screen.queryByText(/Not in this release yet/)).toBeNull()
    expect(samples.fetchSampleMeasurements).toHaveBeenCalledTimes(1)
  })
})
