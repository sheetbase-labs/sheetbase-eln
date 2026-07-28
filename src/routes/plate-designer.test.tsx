/**
 * OPS-003 plate designer route tests: core route chrome, 96-well map,
 * toolbar actions, empty inspector, and assignment roles.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './plate-designer'

const PlateDesignerRoute = Route.options.component as React.ComponentType

const emptyQueryData: never[] = []

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () =>
    (config: Record<string, unknown>) => ({
      useRouteContext: () => ({
        context: {
          workspace: { id: 'workspace-1', name: 'Test workspace', role: 'owner' },
          user: { name: 'Test User', email: 'test@example.com' },
        },
      }),
      options: config,
    }),
  redirect: (options: unknown) => options,
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: never[]) => unknown) => fn,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: emptyQueryData, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

// Keep these route tests focused on the designer rather than AppShell's
// router and responsive-panel integration.
vi.mock('#/components/app-shell', () => ({
  AppShell: ({
    children,
    inspector,
  }: {
    children: React.ReactNode
    inspector: React.ReactNode
  }) => (
    <div>
      <main>{children}</main>
      <aside aria-label="Plate well">{inspector}</aside>
    </div>
  ),
}))

// jsdom does not implement ResizeObserver; responsive UI primitives read it.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => cleanup())

describe('PlateDesignerRoute', () => {
  it('renders the plate designer title and header copy', () => {
    render(<PlateDesignerRoute />)

    expect(screen.getByRole('heading', { name: 'Plate Designer' })).toBeTruthy()
    expect(
      screen.getByText('Design, validate, and save microplate layouts.'),
    ).toBeTruthy()
  })

  it('renders all 96 wells in an 8 by 12 plate grid', () => {
    render(<PlateDesignerRoute />)

    const grid = screen.getByRole('grid', { name: '8 by 12 plate' })
    expect(grid.querySelectorAll('button[data-cell]')).toHaveLength(96)
    expect(screen.getByRole('button', { name: 'A1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'H12' })).toBeTruthy()
  })

  it('renders the toolbar with an interactive Auto-fill button', async () => {
    const user = userEvent.setup()
    render(<PlateDesignerRoute />)

    const autoFill = screen.getByRole('button', { name: 'Auto-fill' })
    expect(autoFill).toBeTruthy()
    await user.click(autoFill)
    expect(screen.getByText('Rows A–H · 12 columns')).toBeTruthy()
  })

  it('shows the empty inspector hint when no well is selected', () => {
    render(<PlateDesignerRoute />)

    expect(screen.getByText('Select a well to see details')).toBeTruthy()
  })

  it('renders role assignment controls and the role legend', () => {
    render(<PlateDesignerRoute />)

    expect(screen.getByText('Assign selected')).toBeTruthy()
    expect(screen.getAllByText('Sample').length).toBeGreaterThanOrEqual(2)
    expect(
      screen.getAllByText('Positive control').length,
    ).toBeGreaterThanOrEqual(2)
    expect(
      screen.getAllByText('Negative control').length,
    ).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Blank').length).toBeGreaterThanOrEqual(2)
  })
})
