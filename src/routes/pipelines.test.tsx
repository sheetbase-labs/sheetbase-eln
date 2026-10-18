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

import { Route } from './pipelines'
import type * as pipelinesDataModule from '#/components/v3/pipelines/pipelines-data'
import type { PipelineListRow } from '#/components/v3/pipelines/pipelines-data'

const List = Route.options.component as React.ComponentType

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  isError: false,
  tab: undefined as string | undefined,
  refetch: vi.fn(),
}))

for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    fullPath: '/pipelines',
    useSearch: () => ({ tab: state.tab }),
    useRouteContext: () => ({
      context: { user: { id: 'u-1' }, workspace: { id: 'ws-1' } },
    }),
    options: config,
  }),
  redirect: vi.fn(),
  Outlet: () => null,
  useRouterState: () => true,
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: { list: async () => [] },
}))

vi.mock('#/components/v3/pipelines/pipelines-data', async (importOriginal) => ({
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
    ) as ReactNode,
  )
}

function row(status: 'failed' | 'waiting' | 'succeeded'): PipelineListRow {
  return {
    id: 'def-1',
    key: 'glucose_trend',
    name: 'Glucose trend',
    description: null,
    created_by_user_id: 'u-9',
    versions: [],
    current: undefined,
    draft: undefined,
    runCount: 1,
    lastRun: { id: 'run-1', status, started_at: '2026-10-10T09:00:00Z' },
  } as unknown as PipelineListRow
}

describe('Pipelines list states', () => {
  it('shows a failed read with a retry, not an empty workspace', () => {
    state.isError = true
    renderList()
    expect(screen.getByText('Could not load pipelines.')).toBeTruthy()
    expect(screen.queryByText(/No pipelines in/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.refetch).toHaveBeenCalled()
  })

  it('offers New pipeline from the empty workspace', () => {
    renderList()
    expect(screen.getByText(/No pipelines in all/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /New pipeline/ }).length).toBe(
      2,
    )
  })

  it('counts a waiting run under Needs attention', () => {
    state.rows = [row('waiting')]
    state.tab = 'needsattention'
    renderList()
    expect(screen.getByText(/1 of 1 needs attention/)).toBeTruthy()
  })

  it('does not count a succeeded run under Needs attention', () => {
    state.rows = [row('succeeded')]
    state.tab = 'needsattention'
    renderList()
    expect(screen.getByText(/0 of 0 needs attention/)).toBeTruthy()
  })
})
