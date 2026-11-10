// @vitest-environment jsdom
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveDataAccessHandle } from '#/lib/data-access-handles'
import { Popover } from '#/components/ui/popover'
import { DataAccessPanel } from './data-access-panel'

afterEach(cleanup)

/** The panel's one link target, so a real router can paint it. */
const API_SETTINGS = '/settings/account/api'

/** Render inside a real router: the panel's settings link is the router's own. */
async function renderInRouter(ui: React.ReactNode) {
  const rootRoute = createRootRoute({
    component: () => <Popover open>{ui}</Popover>,
  })

  const apiSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: API_SETTINGS,
    component: () => null,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([apiSettingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()
  render(<RouterProvider router={router} />)
}

describe('DataAccessPanel', () => {
  it('shows the key, API route and Postgres name of a record', async () => {
    await renderInRouter(
      <DataAccessPanel
        handle={resolveDataAccessHandle('/experiments/EXP-2026-0145')!}
      />,
    )
    await screen.findByText('Data access · Experiment')
    expect(screen.getByText('Data access · Experiment')).toBeTruthy()
    expect(screen.getByText('experiment')).toBeTruthy()
    expect(
      screen.getByText('/api/db/records?identifier=eq.EXP-2026-0145'),
    ).toBeTruthy()
    expect(screen.getByText('data.experiments')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /Settings/ }).getAttribute('href'),
    ).toBe('/settings/account/api')
  })

  it('offers the Python SDK beside the other snippets where it applies', async () => {
    await renderInRouter(
      <DataAccessPanel handle={resolveDataAccessHandle('/experiments')!} />,
    )
    await screen.findAllByRole('tab')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'curl',
      'Python SDK',
      'Python (requests)',
      'Python (psycopg)',
      'SQL',
    ])
  })

  it('offers copy buttons and a snippet per language', async () => {
    await renderInRouter(
      <DataAccessPanel handle={resolveDataAccessHandle('/samples?q=a')!} />,
    )
    await screen.findByRole('button', { name: 'Copy API route' })
    expect(screen.getByRole('button', { name: 'Copy API route' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'curl',
      'Python (requests)',
      'Python (psycopg)',
      'SQL',
    ])
  })
})
