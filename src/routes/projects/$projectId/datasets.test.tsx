import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { Route } from './datasets'

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

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: client }))

const DATASET = {
  id: 'ds-1',
  display_id: 'DS-0001',
  name: 'Plate read',
  model: 'ViCell v2',
  project_id: 'project-1',
  created_by_user_id: 'u1',
  row_count: '10',
  issue_count: '0',
  out_of_range_count: '0',
  missing_unit_count: '0',
  missing_unit_fields: null,
  experiment_display_id: 'EXP-0001',
  review_state: null,
  updated_at: '2026-01-02T00:00:00Z',
  archived_at: null,
}

function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Project datasets component required')
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

describe('project datasets tab (R5-SURF-02)', () => {
  it('lists the project’s datasets with a count', async () => {
    client.rpc.mockResolvedValue([DATASET])
    client.count.mockResolvedValue(1)

    renderRoute()

    expect(await screen.findAllByText('DS-0001')).not.toHaveLength(0)
    expect(screen.getAllByText('Plate read').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ViCell v2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Valid').length).toBeGreaterThan(0)
  })

  it('asks the RPC for the project, never the whole registry', async () => {
    client.rpc.mockResolvedValue([DATASET])
    client.count.mockResolvedValue(1)

    renderRoute()

    await screen.findAllByText('DS-0001')
    expect(client.rpc).toHaveBeenCalledWith(
      'dataset_list_summary',
      expect.objectContaining({ p_project_id: 'project-1' }),
    )
  })

  it('shows the honest empty state when the project has no datasets', async () => {
    client.rpc.mockResolvedValue([])
    client.count.mockResolvedValue(0)

    renderRoute()

    expect(await screen.findByText('No datasets yet')).toBeTruthy()
    expect(screen.queryByText('DS-0001')).toBeNull()
  })

  it('says denied, not empty, when the read is refused', async () => {
    client.rpc.mockRejectedValue(
      new DataClientError('permission_denied', 'no access', 403),
    )
    client.count.mockResolvedValue(0)

    renderRoute()

    expect(
      await screen.findByText(/You do not have access to this project/),
    ).toBeTruthy()
    expect(screen.queryByText('No datasets yet')).toBeNull()
  })

  it('says the page is bounded and offers the next page when there is more', async () => {
    client.rpc.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        ...DATASET,
        id: `ds-${i}`,
        display_id: `DS-000${i}`,
      })),
    )
    client.count.mockResolvedValue(40)

    const { container } = renderRoute()

    expect(await screen.findByRole('link', { name: 'Next' })).toBeTruthy()
    expect(container.textContent).toContain('Showing 1–25 of 40 datasets')
  })

  it('says a hand-edited page past the end is out of range, not empty', async () => {
    search.value = { page: 9 }
    client.rpc.mockResolvedValue([])
    client.count.mockResolvedValue(40)

    renderRoute()

    expect(
      await screen.findByText('That page is past the end of this list.'),
    ).toBeTruthy()
    expect(screen.queryByText('No datasets yet')).toBeNull()
  })
})
