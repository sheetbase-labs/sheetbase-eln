import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$name'

/** What the route's loader hands the page for one document name. */
interface DocLoaderData {
  name: string
  html: string | null
  known: boolean
}

/** The route options the mocked factory records, so the suite can call them. */
interface RouteOptions {
  component?: React.ComponentType
  loader?: unknown
}

/** A redirect as this route states it; the mock hands it straight back. */
interface RedirectOptions {
  to: string
}

// The mocked router exposes the route options and the loader data the page
// reads, so the unknown-name path can be rendered without a real router.
const mocks = vi.hoisted(() => {
  const loaderData = {
    // SAFETY: this is the shape the route's loader returns for a missing name, which is the state the first render shows.
    current: { name: '', html: null, known: false } as DocLoaderData,
  }

  return { loaderData }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory binds to the generated route tree at import time; this suite reads the route's own options and renders its component with the loader data a router would supply, which is the whole subject of these assertions.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: RouteOptions) => ({
    options,
    useLoaderData: () => mocks.loaderData.current,
  }),
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/settings">{children}</a>
  ),
  redirect: (options: RedirectOptions) => options,
}))

// SAFETY: the route declares `component` in its options, so this is the screen
// a router renders for the path.
const DocPage = Route.options.component as React.ComponentType

type DocLoader = (args: { params: { name: string } }) => Promise<DocLoaderData>

// SAFETY: the route declares `loader`, and its contract is the parameter and
// the `{ name, html, known }` answer this suite calls it with and reads back.
const loader = Route.options.loader as DocLoader

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
