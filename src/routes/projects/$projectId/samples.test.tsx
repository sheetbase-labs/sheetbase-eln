import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NotebookData from '#/lib/notebook-data'
import { DataClientError } from '#/lib/data-client'
import { Route } from './samples'

const client = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  rpc: vi.fn(),
}))
const search = vi.hoisted(() => ({ value: {} }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ projectId: 'project-1' }),
    useSearch: () => search.value,
    options: config,
  }),
  Outlet: () => null,
  redirect: (options: unknown) => options,
  Link: ({
    to,
    params,
    search: _search,
    activeProps: _activeProps,
    activeOptions: _activeOptions,
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

vi.mock('#/lib/notebook-data', async (importOriginal) => {
  const actual = await importOriginal<typeof NotebookData>()
  return { ...actual, notebookDataClient: client }
})

const SAMPLE = {
  id: 'smp-1',
  workspace_id: 'ws',
  project_id: 'project-1',
  folder_id: null,
  kind: 'sample',
  identifier: 'SMP-0001',
  title: 'Lot A',
  status: 'available',
  tags: [],
  structure_version: 1,
  metadata_version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  archived_at: null,
  deleted_at: null,
  created_by_user_id: 'u1',
  updated_by_user_id: null,
  properties: {
    sampleType: 'Serum',
    quantity: 4,
    quantityUnit: 'mL',
    storageLocation: 'Freezer 2',
  },
  custom_fields: {},
  locked_at: null,
  locked_by_revision_id: null,
}

function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Project samples component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  search.value = {}
})

describe('project samples tab (R5-SURF-02)', () => {
  it('lists the project’s samples with a count', async () => {
    client.list.mockResolvedValue([SAMPLE])
    client.count.mockResolvedValue(1)

    renderRoute()

    expect(await screen.findAllByText('SMP-0001')).not.toHaveLength(0)
    expect(screen.getAllByText('Lot A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Serum').length).toBeGreaterThan(0)
    expect(screen.getAllByText('4 mL').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0)
  })

  it('shows the honest empty state when the project has no samples', async () => {
    client.list.mockResolvedValue([])
    client.count.mockResolvedValue(0)

    renderRoute()

    expect(await screen.findByText('No samples yet')).toBeTruthy()
    expect(screen.queryByText('SMP-0001')).toBeNull()
  })

  it('says denied, not empty, when the read is refused', async () => {
    client.list.mockRejectedValue(
      new DataClientError('permission_denied', 'no access', 403),
    )
    client.count.mockResolvedValue(0)

    renderRoute()

    expect(
      await screen.findByText(/You do not have access to this project/),
    ).toBeTruthy()
    expect(screen.queryByText('No samples yet')).toBeNull()
  })

  it('says the page is bounded and offers the next page when there is more', async () => {
    client.list.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        ...SAMPLE,
        id: `smp-${i}`,
        identifier: `SMP-000${i}`,
      })),
    )
    client.count.mockResolvedValue(30)

    const { container } = renderRoute()

    expect(await screen.findByRole('link', { name: 'Next' })).toBeTruthy()
    expect(container.textContent).toContain('Showing 1–25 of 30 samples')
  })

  it('says a hand-edited page past the end is out of range, not empty', async () => {
    search.value = { page: 9 }
    client.list.mockResolvedValue([])
    client.count.mockResolvedValue(30)

    renderRoute()

    expect(
      await screen.findByText('That page is past the end of this list.'),
    ).toBeTruthy()
    expect(screen.queryByText('No samples yet')).toBeNull()
  })
})
