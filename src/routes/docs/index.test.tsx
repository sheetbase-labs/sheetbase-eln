/** Docs index route tests — auth guard and document listing. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockAuth = { current: null as null | Record<string, unknown> }

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useRouteContext: () => ({ context: mockAuth.current }),
    options: config,
  }),
  redirect: (options: unknown) => options,
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, encodeURIComponent(value))
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

const { Route } = await import('./index')

const beforeLoad = Route.options.beforeLoad as ({
  context,
}: {
  context: { auth: { workspace: unknown } | null }
}) => Promise<unknown>

afterEach(() => {
  cleanup()
  mockAuth.current = null
})

describe('docs index route — auth guard', () => {
  it('redirects unauthenticated users to sign-in', async () => {
    await expect(beforeLoad({ context: { auth: null } })).rejects.toMatchObject(
      { to: '/sign-in' },
    )
  })

  it('redirects authenticated users with no workspace to home', async () => {
    const auth = {
      user: { id: 'u1', name: 'Test', email: 't@e.com' },
      workspace: null,
    }
    await expect(beforeLoad({ context: { auth } })).rejects.toMatchObject({
      to: '/',
    })
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

describe('docs index route — component', () => {
  it('lists every runbook with a link to its /docs/$name page', () => {
    const DocsIndexPage = Route.options.component as React.ComponentType
    render(<DocsIndexPage />)
    const link = screen.getByRole('link', { name: 'Deployment' })
    expect(link.getAttribute('href')).toBe('/docs/deployment')
    for (const title of [
      'Recovery',
      'Security',
      'Performance',
      'Observability',
      'Administration',
    ]) {
      expect(screen.getByRole('link', { name: title })).toBeTruthy()
    }
  })
})
