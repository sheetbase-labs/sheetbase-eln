import { cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  Outlet,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotFound, sectionForPath } from './not-found'

import { Route as SplatRoute } from '#/routes/$'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A minimal root that renders its outlet, so a matched splat is visible. */
function rootWithShell() {
  return createRootRoute({
    component: () => (
      <div data-testid="shell">
        <Outlet />
      </div>
    ),
  })
}

describe('sectionForPath', () => {
  it('maps the first path segment to a real section', () => {
    expect(sectionForPath('/datasets/abc/snapshots')?.label).toBe('Datasets')
    expect(sectionForPath('/datasets/abc/snapshots')?.link.to).toBe('/datasets')
    expect(sectionForPath('/models/m1/records/r1')?.label).toBe('Models')
    expect(sectionForPath('/models/m1/records/r1')?.link.to).toBe('/models')
  })

  it('returns null for an unknown or empty path', () => {
    expect(sectionForPath('/')).toBeNull()
    expect(sectionForPath('/nonsense/here')).toBeNull()
  })
})

describe('NotFound — unmatched URL', () => {
  it('renders the product screen inside the shell with exactly one h1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = rootWithShell()
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: '/$',
          component: NotFound,
        }),
      ]),
      context: { auth: { user: { id: 'u1' } } },
      history: createMemoryHistory({
        initialEntries: ['/definitely/not/here'],
      }),
    })

    render(<RouterProvider router={router} />)

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeTruthy(),
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Not found' }),
    ).toBeTruthy()
    expect(screen.getByTestId('shell')).toBeTruthy()
    // The address that failed is shown, and the screen offers a next step.
    expect(screen.getByText('/definitely/not/here')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go to Home' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
    expect(error).not.toHaveBeenCalled()
  })

  it('links back to the section the pathname implies', async () => {
    const root = rootWithShell()
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: '/$',
          component: NotFound,
        }),
      ]),
      context: { auth: { user: { id: 'u1' } } },
      history: createMemoryHistory({
        initialEntries: ['/datasets/abc/extra-tab'],
      }),
    })

    render(<RouterProvider router={router} />)

    const back = await screen.findByRole('button', { name: 'Back to Datasets' })
    expect(back.getAttribute('href')).toBe('/datasets')
  })

  it('redirects a signed-out visitor to sign-in', async () => {
    await expect(
      SplatRoute.options.beforeLoad?.({
        context: { auth: null },
        location: { href: '/nowhere/deep?x=1' },
      } as never),
    ).rejects.toMatchObject({
      options: { to: '/sign-in', search: { next: '/nowhere/deep?x=1' } },
    })
  })

  it('renders for a signed-in visitor', async () => {
    await expect(
      SplatRoute.options.beforeLoad?.({
        context: { auth: { user: { id: 'u1' } } },
      } as never),
    ).resolves.toBeUndefined()
  })
})

describe('NotFound — unknown record id inside a record layout', () => {
  it('renders without a duplicate h1', async () => {
    const root = createRootRoute()
    // Mimic a record layout: it owns the page header (and its h1) and renders
    // its children through an outlet.
    const layout = createRoute({
      getParentRoute: () => root,
      path: '/datasets/$datasetId',
      component: () => (
        <div>
          <h1>Dataset</h1>
          <Outlet />
        </div>
      ),
    })
    const index = createRoute({
      getParentRoute: () => layout,
      path: '/',
      loader: () => {
        throw notFound()
      },
    })

    const router = createRouter({
      routeTree: root.addChildren([layout.addChildren([index])]),
      context: {},
      defaultNotFoundComponent: NotFound,
      history: createMemoryHistory({
        initialEntries: ['/datasets/unknown-id'],
      }),
    })

    render(<RouterProvider router={router} />)

    await waitFor(() =>
      expect(screen.getByText('Not found in this workspace')).toBeTruthy(),
    )
    // The layout's h1 is the only one; the nested screen adds none.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dataset' }),
    ).toBeTruthy()
  })
})
