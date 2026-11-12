import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type {
  PipelineDefinitionVersionWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'

export function renderPipeline(
  node: ReactNode,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  }),
) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>{node}</RouterContextProvider>
    </QueryClientProvider>,
  )
}

export function pipelineVersion(
  configuration: PipelineDefinitionVersionWire['configuration'] = {},
): PipelineDefinitionVersionWire {
  return {
    id: 'v-1',
    definition_id: 'p-1',
    workspace_id: 'ws-1',
    version: 2,
    lifecycle: 'draft',
    configuration_format_version: 2,
    configuration,
    revision: 1,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    created_by_user_id: null,
    published_at: null,
    published_by_user_id: null,
    retired_at: null,
    retired_by_user_id: null,
  }
}

export function pipelineRun(
  overrides: Partial<PipelineRunWire> = {},
): PipelineRunWire {
  return {
    id: 'run-1',
    workspace_id: 'ws-1',
    definition_version_id: 'v-1',
    trigger_kind: 'manual',
    status: 'succeeded',
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
    started_at: '2026-10-01T00:00:00Z',
    finished_at: '2026-10-01T00:00:03Z',
    actor_user_id: null,
    actor_credential_id: null,
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}
