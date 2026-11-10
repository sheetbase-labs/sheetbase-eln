import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import './$identifier'

interface RouterDouble {
  identifier: string
  navigate: ReturnType<typeof vi.fn>
  resolve: ReturnType<typeof vi.fn>
  /** Filled by the router double when the route registers its component. */
  component: React.ComponentType | undefined
}

const hoisted: RouterDouble = vi.hoisted(() => ({
  identifier: 'SMP-1',
  navigate: vi.fn(),
  resolve: vi.fn(),
  component: undefined,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The route resolves its params and navigate from the router at import time, so the test renders it through a router double.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component?: React.ComponentType }) => {
    hoisted.component = config.component

    return {
      useParams: () => ({ identifier: hoisted.identifier }),
      options: config,
    }
  },
  redirect: <T,>(options: T): T => options,
  useNavigate: () => hoisted.navigate,
  Link: ({ to, children }: { to?: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- notebook-data opens its client at module scope; the route under test never reads through it.
vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The identifier lookup is the read under test; it is replaced so the redirect can be driven without a database.
vi.mock('#/lib/object-resolver', async () => ({
  ...(await vi.importActual<object>('#/lib/object-resolver')),
  resolveObjectByIdentifier: hoisted.resolve,
}))

/** The component the route registered with the router double. */
function routeComponent(): React.ComponentType {
  const component = hoisted.component

  if (!component) throw new Error('the resolve route has no component')

  return component
}

const Resolve = routeComponent()

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
