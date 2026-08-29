/** PLAT-04 docs route tests — auth guard and document allowlist. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockAuth = { current: null as null | Record<string, unknown> }
const loaderResult = { current: { name: '', html: null as string | null } }

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useLoaderData: () => loaderResult.current,
    useRouteContext: () => ({ context: mockAuth.current }),
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

vi.mock('marked', () => ({
  marked: { parse: () => '<p>Mock markdown</p>' },
}))

const { Route } = await import('./$name')

const beforeLoad = Route.options.beforeLoad as ({
  context,
}: {
  context: { auth: unknown }
}) => Promise<unknown>

afterEach(() => {
  cleanup()
  mockAuth.current = null
  loaderResult.current = { name: '', html: null }
})

describe('docs/$name route — auth guard', () => {
  it('redirects unauthenticated users to sign-in', async () => {
    await expect(
      beforeLoad({ context: { auth: null } }),
    ).rejects.toMatchObject({ to: '/sign-in' })
  })

  it('allows authenticated workspace members', async () => {
    const auth = {
      user: { id: 'u1', name: 'Test', email: 't@e.com' },
      workspace: { id: 'w1', slug: 'ws', name: 'WS', role: 'owner' },
    }
    const result = await beforeLoad({ context: { auth } })
    expect(result).toEqual({ context: auth })
  })
})

describe('docs/$name route — component', () => {
  it('renders markdown content for an allowed document', () => {
    loaderResult.current = { name: 'deployment', html: '<p>Mock markdown</p>' }
    const DocPage = Route.options.component as React.ComponentType
    render(<DocPage />)
    expect(screen.getByText('Deployment')).toBeTruthy()
    expect(screen.getByText('Mock markdown')).toBeTruthy()
  })

  it('shows unavailable message when document is missing', () => {
    loaderResult.current = { name: 'deployment', html: null }
    const DocPage = Route.options.component as React.ComponentType
    render(<DocPage />)
    expect(
      screen.getByText('This document is not available in the current deployment.'),
    ).toBeTruthy()
  })

  it('includes a back link to the deployment admin section', () => {
    loaderResult.current = { name: 'deployment', html: '<p>Mock</p>' }
    const DocPage = Route.options.component as React.ComponentType
    render(<DocPage />)
    expect(screen.getByText('← Back to deployment')).toBeTruthy()
  })
})
