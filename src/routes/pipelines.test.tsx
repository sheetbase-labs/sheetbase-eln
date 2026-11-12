/**
 * The Pipelines list tells a failed read from an empty workspace, offers the way
 * to register the first pipeline, and counts a run waiting for a person as
 * needing attention (the Inbox sends people here for exactly that).
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { Route } from './pipelines'
import type * as notebookDataModule from '#/lib/notebook-data'
import type * as pipelinesDataModule from '#/components/pipelines/pipelines-data'
import type { PipelineListRow } from '#/components/pipelines/pipelines-data'

/** A React component: something that can be called. */
const routeComponent = z.custom<React.ComponentType>(
  (value) => z.function().safeParse(value).success,
)

const List = routeComponent.parse(Route.options.component)

/** The rows and read state these cases hand the list's query hook. */
interface ListState {
  rows: PipelineListRow[]
  isError: boolean
  tab: string | undefined
  refetch: ReturnType<typeof vi.fn>
}

const state = vi.hoisted(() => {
  const held: ListState = {
    rows: [],
    isError: false,
    tab: undefined,
    refetch: vi.fn(),
  }

  return held
})

for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time; this suite renders the route's own component with the search and context the shell would supply.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <TOptions,>(options: TOptions) => ({
      fullPath: '/pipelines',
      useSearch: () => ({ tab: state.tab }),
      useRouteContext: () => ({
        context: {
          user: { id: 'u-1' },
          workspace: { id: 'ws-1', role: 'admin' },
        },
      }),
      options,
    }),
  redirect: vi.fn(),
  Outlet: () => null,
  useRouterState: () => true,
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The page's reads run through the module-level notebook client with no injection point; this suite answers them with empty lists.
vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<typeof notebookDataModule>()),
  notebookDataClient: { list: async () => [] },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The pipeline rows come from a query hook over the shared client; this suite fixes the rows and error state the screen renders.
vi.mock('#/components/pipelines/pipelines-data', async (importOriginal) => ({
  ...(await importOriginal<typeof pipelinesDataModule>()),
  usePipelineRows: () => ({
    data: state.isError ? undefined : state.rows,
    isLoading: false,
    isError: state.isError,
    error: state.isError ? new Error('network') : null,
    refetch: state.refetch,
  }),
}))

afterEach(() => {
  cleanup()
  state.rows = []
  state.isError = false
  state.tab = undefined
  state.refetch.mockReset()
})

function renderList() {
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(List),
    ),
  )
}

function row(status: 'failed' | 'waiting' | 'succeeded'): PipelineListRow {
  return {
    id: 'def-1',
    workspace_id: 'ws-1',
    key: 'glucose_trend',
    name: 'Glucose trend',
    description: null,
    lifecycle: 'active',
    revision: 1,
    created_at: '2026-10-10T09:00:00Z',
    updated_at: '2026-10-10T09:00:00Z',
    created_by_user_id: 'u-9',
    updated_by_user_id: null,
    versions: [],
    current: undefined,
    draft: undefined,
    runCount: 1,
    lastRun: {
      id: 'run-1',
      workspace_id: 'ws-1',
      definition_version_id: 'defv-1',
      trigger_kind: 'manual',
      status,
      attempt: 1,
      retry_of_run_id: null,
      trigger_occurrence_id: null,
      schedule_id: null,
      input_digest: null,
      parameters: {},
      input_versions: {},
      result: {},
      error_code: null,
      error_message: null,
      started_at: '2026-10-10T09:00:00Z',
      finished_at: null,
      actor_user_id: null,
      actor_credential_id: null,
      created_at: '2026-10-10T09:00:00Z',
    },
    recentRuns: [],
  }
}

describe('Pipelines list states', () => {
  it('shows a failed read with a retry, not an empty workspace', () => {
    state.isError = true
    renderList()
    expect(screen.getByText('Couldn’t load pipelines.')).toBeTruthy()
    expect(screen.queryByText(/No pipelines (in|yet)/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.refetch).toHaveBeenCalled()
  })

  it('offers New pipeline from the empty workspace', () => {
    renderList()
    expect(screen.getByText(/No pipelines yet/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /New pipeline/ }).length).toBe(
      2,
    )
  })

  it('suggests the key from the name until the key is typed by hand', async () => {
    renderList()
    fireEvent.click(screen.getAllByRole('button', { name: /New pipeline/ })[0])
    const name = await screen.findByLabelText(/^Name/)
    const key = screen.getByLabelText<HTMLInputElement>(/^Key/)
    fireEvent.change(name, { target: { value: 'Viability summary' } })
    expect(key.value).toBe('viability_summary')
    fireEvent.change(key, { target: { value: 'my_key' } })
    fireEvent.change(name, { target: { value: 'Something else' } })
    expect(key.value).toBe('my_key')
  })

  it('counts a waiting run under Needs attention', () => {
    state.rows = [row('waiting')]
    state.tab = 'needsattention'
    renderList()
    expect(screen.getByText(/1 pipeline · needs attention/)).toBeTruthy()
  })

  it('does not count a succeeded run under Needs attention', () => {
    state.rows = [row('succeeded')]
    state.tab = 'needsattention'
    renderList()
    expect(screen.getByText(/0 pipelines · needs attention/)).toBeTruthy()
  })
})
