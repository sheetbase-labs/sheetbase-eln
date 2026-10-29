import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$identifier'

const hoisted = vi.hoisted(() => ({
  identifier: 'SMP-1',
  navigate: vi.fn(),
  resolve: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ identifier: hoisted.identifier }),
    options: config,
  }),
  redirect: (options: unknown) => options,
  useNavigate: () => hoisted.navigate,
  Link: ({ to, children }: { to?: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))
vi.mock('#/lib/object-resolver', async () => ({
  ...(await vi.importActual<object>('#/lib/object-resolver')),
  resolveObjectByIdentifier: hoisted.resolve,
}))

const Resolve = Route.options.component as React.ComponentType

function renderRoute() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Resolve />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('/r/<identifier>', () => {
  it.each([
    [
      'a sample',
      { source: 'record', id: 's-1', kind: 'sample', identifier: 'SMP-1' },
      '/samples/s-1',
    ],
    [
      'an instrument',
      {
        source: 'registry',
        id: 'i-1',
        kind: 'instrument',
        identifier: 'INS-1',
      },
      '/instruments/i-1',
    ],
    [
      'a dataset',
      { source: 'registry', id: 'd-1', kind: 'dataset', identifier: 'DS-1' },
      '/datasets/d-1',
    ],
    [
      'a project',
      { source: 'registry', id: 'p-1', kind: 'project', identifier: 'PRJ-1' },
      '/projects/p-1',
    ],
  ])('continues to the page that owns %s', async (_name, object, path) => {
    hoisted.resolve.mockResolvedValue(object)
    renderRoute()
    await waitFor(() =>
      expect(hoisted.navigate).toHaveBeenCalledWith({
        to: path,
        replace: true,
      }),
    )
  })

  it('says nothing matched, and offers search, rather than redirecting', async () => {
    hoisted.resolve.mockResolvedValue(null)
    renderRoute()
    expect(await screen.findByText('Nothing matches this code')).toBeTruthy()
    expect(screen.getByText('Search the workspace')).toBeTruthy()
    expect(hoisted.navigate).not.toHaveBeenCalled()
  })

  it('says the lookup failed, with a retry, when it errors', async () => {
    hoisted.resolve.mockRejectedValue(new Error('down'))
    renderRoute()
    expect(await screen.findByText('Couldn’t look up this code')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
