import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$name'

// The mocked router exposes the route options and the loader data the page
// reads, so the unknown-name path can be rendered without a real router.
const mocks = vi.hoisted(() => ({
  loaderData: {
    current: { name: '', html: null as string | null, known: false },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useLoaderData: () => mocks.loaderData.current,
  }),
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/settings">{children}</a>
  ),
  redirect: (options: object) => options,
}))

const DocPage = Route.options.component as React.ComponentType
const loader = Route.options.loader as (args: {
  params: { name: string }
}) => Promise<{ name: string; html: string | null; known: boolean }>

afterEach(cleanup)

describe('docs/$name', () => {
  it('an unknown name is a missing document, not a thrown error', async () => {
    const result = await loader({ params: { name: 'nope' } })
    expect(result).toEqual({ name: 'nope', html: null, known: false })
  })

  it('resolves every named document to its file in the docs tree', async () => {
    for (const name of [
      'deployment',
      'recovery',
      'security',
      'performance',
      'observability',
      'administration',
    ]) {
      const result = await loader({ params: { name } })
      expect(result.known).toBe(true)
      expect(result.html).toBeTruthy()
    }
  })

  it('renders a stated message for an unknown name', () => {
    mocks.loaderData.current = { name: 'nope', html: null, known: false }
    render(<DocPage />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Document not found',
    )
    expect(screen.getByText(/There’s no document named “nope”/)).toBeTruthy()
  })

  it('keeps the deployment message for a known name with no file', () => {
    mocks.loaderData.current = { name: 'security', html: null, known: true }
    render(<DocPage />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Security',
    )
    expect(
      screen.getByText(/This document isn’t available in the current/),
    ).toBeTruthy()
  })
})
