import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { Route } from './experiments'

const client = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  rpc: vi.fn(),
}))
const search = vi.hoisted(() => ({ value: {} }))

vi.mock('#/lib/use-capability', () => ({ useHasCapability: () => true }))
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
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => `name:${id}` }),
}))

const EXPERIMENT = {
  id: 'exp-1',
  project_id: 'project-1',
  identifier: 'EXP-0001',
  title: 'AAV9 titration',
  status: 'in_progress',
  created_by_user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Project experiments component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
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

describe('project experiments tab (R5-SURF-02)', () => {
  it('lists the project’s experiments with a count', async () => {
    client.list.mockResolvedValue([EXPERIMENT])
    client.count.mockResolvedValue(1)

    renderRoute()

    expect(await screen.findAllByText('EXP-0001')).not.toHaveLength(0)
    expect(screen.getAllByText('AAV9 titration').length).toBeGreaterThan(0)
    expect(screen.getAllByText('name:u1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
  })

  it('shows the honest empty state when the project has no experiments', async () => {
    client.list.mockResolvedValue([])
    client.count.mockResolvedValue(0)

    renderRoute()

    expect(await screen.findByText('No experiments yet')).toBeTruthy()
    expect(screen.queryByText('EXP-0001')).toBeNull()
  })

  it('says denied, not empty, when the read is refused', async () => {
    client.list.mockRejectedValue(
      new DataClientError('permission_denied', 'no access', 403),
    )
    client.count.mockResolvedValue(0)

    renderRoute()

    expect(
      await screen.findByText(/You don’t have access to this project/),
    ).toBeTruthy()
    expect(screen.queryByText('No experiments yet')).toBeNull()
  })

  it('says the page is bounded and offers the next page when there is more', async () => {
    client.list.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        ...EXPERIMENT,
        id: `exp-${i}`,
        identifier: `EXP-000${i}`,
      })),
    )
    client.count.mockResolvedValue(60)

    const { container } = renderRoute()

    expect(await screen.findByRole('link', { name: 'Next' })).toBeTruthy()
    expect(container.textContent).toContain('Showing 1–25 of 60 experiments')
    // On the first page "Previous" is present and disabled, not absent: a
    // control that vanishes moves the row and reads as a missing control rather
    // than a first page. (The router's `Link` is mocked in this suite, so the
    // `aria-disabled` and the dropped `href` it adds are asserted in the
    // component's story and in the browser check.)
    const previous = screen.getByRole('link', { name: 'Previous' })
    expect(previous.getAttribute('disabled')).not.toBeNull()
  })

  it('says a hand-edited page past the end is out of range, not empty', async () => {
    search.value = { page: 9 }
    client.list.mockResolvedValue([])
    client.count.mockResolvedValue(30)

    renderRoute()

    expect(
      await screen.findByText('That page is past the end of this list.'),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Back to the first page' }),
    ).toBeTruthy()
    expect(screen.queryByText('No experiments yet')).toBeNull()
  })
})
