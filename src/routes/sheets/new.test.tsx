import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type * as routerModule from '@tanstack/react-router'

import { Route } from './new'

// oxlint-disable-next-line anti-slop/no-module-mocking -- The page is built by the router's createFileRoute at import time and this suite renders it alone; the double supplies the navigation and links the shell would, with every other export real.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof routerModule>()),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Project summaries come from the shared data client the page creates at import time, which needs a live PostgREST; the double answers the one read the page makes.
vi.mock('#/components/projects/project-data', () => ({
  fetchProjectSummaries: async () => [],
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The create-context search keys the page accepts. */
interface CreateContextSearch {
  project?: string
  experiment?: string
  returnTo?: string
}

// SAFETY: this route declares `validateSearch` as a function, not as a schema
// object, so the option holds the callable the router invokes.
const validate = Route.options.validateSearch as (
  search: CreateContextSearch,
) => CreateContextSearch

describe('/sheets/new search', () => {
  it('accepts the shared create-context params', () => {
    expect(
      validate({
        project: 'p-1',
        experiment: 'e-1',
        returnTo: '/projects/p-1',
      }),
    ).toEqual({ project: 'p-1', experiment: 'e-1', returnTo: '/projects/p-1' })
  })

  it('drops a returnTo that leaves the app and empty values', () => {
    expect(validate({ project: '', returnTo: '//evil.example' })).toEqual({})
  })

  it('starts a local sheet by focusing and scrolling only its own form', () => {
    // SAFETY: the page reads only the workspace id from its route context;
    // this is the context the shell provides.
    vi.spyOn(Route, 'useRouteContext').mockReturnValue({
      context: { workspace: { id: 'w1' } },
    } as ReturnType<typeof Route.useRouteContext>)
    vi.spyOn(Route, 'useSearch').mockReturnValue({})
    const NewSheet = Route.options.component!

    const first = render(
      <QueryClientProvider client={new QueryClient()}>
        <NewSheet />
      </QueryClientProvider>,
    )

    const second = render(
      <QueryClientProvider client={new QueryClient()}>
        <NewSheet />
      </QueryClientProvider>,
    )

    const firstName = within(first.container).getByRole<HTMLInputElement>(
      'textbox',
      {
        name: 'Name',
      },
    )

    const secondName = within(second.container).getByRole('textbox', {
      name: 'Name',
    })

    const firstScroll = vi.fn()
    const secondScroll = vi.fn()
    firstName.closest('div')!.scrollIntoView = firstScroll
    secondName.closest('div')!.scrollIntoView = secondScroll
    fireEvent.change(firstName, { target: { value: 'Keep this draft' } })
    fireEvent.click(
      within(second.container).getByRole('button', { name: /Paste a table/ }),
    )
    expect(document.activeElement).toBe(secondName)
    expect(secondScroll).toHaveBeenCalledTimes(1)
    expect(firstScroll).not.toHaveBeenCalled()
    expect(firstName.value).toBe('Keep this draft')
    expect(
      within(second.container).getByRole('button', {
        name: 'Create sheet and paste',
      }),
    ).toBeTruthy()
    expect(
      within(first.container).getByRole('button', {
        name: 'Create blank sheet',
      }),
    ).toBeTruthy()
  })
})
