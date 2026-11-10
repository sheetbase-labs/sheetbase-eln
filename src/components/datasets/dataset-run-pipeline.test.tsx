import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildPipelineRows,
  pipelineDataQueryKeys,
} from '#/components/pipelines/pipelines-data'
import type {
  PipelineDefinitionVersionWire,
  PipelineDefinitionWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'
import { dropSharedReads } from '#/lib/data-client'
import { DatasetRunPipeline } from './dataset-run-pipeline'
import { pipelinesThatReadADataset } from './dataset-pipeline-candidates'

// The real notebook DataClient captures fetch at module initialization.
const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

afterEach(() => {
  cleanup()
  dropSharedReads()
  transport.mockReset()
})

afterAll(() => vi.unstubAllGlobals())

function definition(key: string): PipelineDefinitionWire {
  return {
    id: key,
    workspace_id: 'ws',
    key,
    name: `Pipeline ${key}`,
    description: null,
    lifecycle: 'active',
    revision: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by_user_id: null,
    updated_by_user_id: null,
  }
}

function version(
  key: string,
  lifecycle: PipelineDefinitionVersionWire['lifecycle'],
  inputs: Array<{ name: string; required: boolean }>,
): PipelineDefinitionVersionWire {
  return {
    id: `${key}-v1`,
    definition_id: key,
    workspace_id: 'ws',
    version: 1,
    lifecycle,
    configuration: { inputs },
    configuration_format_version: 1,
    revision: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by_user_id: null,
    published_at: null,
    published_by_user_id: null,
    retired_at: null,
    retired_by_user_id: null,
  }
}

const STARTED: PipelineRunWire = {
  id: 'run-1',
  workspace_id: 'ws',
  definition_version_id: 'reads-v1',
  trigger_kind: 'manual',
  status: 'running',
  attempt: 1,
  retry_of_run_id: null,
  trigger_occurrence_id: null,
  schedule_id: null,
  input_digest: null,
  parameters: {},
  input_versions: { raw: 'snap-1' },
  result: {},
  error_code: null,
  error_message: null,
  started_at: '2026-01-01T00:00:00Z',
  finished_at: null,
  actor_user_id: null,
  actor_credential_id: null,
  created_at: '2026-01-01T00:00:00Z',
}

async function mount({
  latestVersionId = 'snap-1',
  inputs = [{ name: 'raw', required: true }],
  refused = false,
}: {
  latestVersionId?: string | null
  inputs?: Array<{ name: string; required: boolean }>
  refused?: boolean
} = {}) {
  transport.mockImplementation(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    )

    switch (url.pathname) {
      case '/api/db/pipeline_definitions':
        return Response.json([definition('reads')])
      case '/api/db/pipeline_definition_versions':
        return Response.json([version('reads', 'published', inputs)])
      case '/api/db/pipeline_runs':
        return Response.json([])
      case '/api/db/dataset_versions':
        return Response.json([
          {
            id: 'snap-1',
            dataset_id: 'd1',
            label: 'Latest saved',
            created_at: '2026-01-01T00:00:00Z',
          },
        ])
      case '/api/db/datasets':
        return Response.json([{ id: 'd1', name: 'Dataset', display_id: null }])
      case '/api/db/dataset_schema_versions':
      case '/api/db/dataset_schema_definitions':
        return Response.json([])
      case '/api/db/rpc/start_pipeline_run':
        return refused
          ? Response.json(
              { message: 'Permission denied', code: '42501' },
              { status: 403 },
            )
          : Response.json(STARTED)
      case '/api/pipelines/execute':
        return Response.json(
          init?.method === 'POST'
            ? {}
            : { run: { ...STARTED, status: 'succeeded' }, job: null },
        )
      default:
        throw new Error(`Unexpected request: ${url}`)
    }
  })
  const onStarted = vi.fn<(run: PipelineRunWire) => void>()

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  queryClient.setQueryData(['ui-port', 'pipelines', 'invalidation-check'], [])

  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <DatasetRunPipeline
          workspaceId="ws"
          latestVersionId={latestVersionId}
          onStarted={onStarted}
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await waitFor(() =>
    expect(queryClient.getQueryState(pipelineDataQueryKeys.list)?.status).toBe(
      'success',
    ),
  )

  return { onStarted, queryClient }
}

describe('pipelinesThatReadADataset', () => {
  it('keeps live versions that declare an input and drops the rest', () => {
    const definitions = ['reads', 'no-input', 'draft', 'missing'].map(
      definition,
    )

    const versions = [
      version('reads', 'published', [{ name: 'raw', required: true }]),
      version('no-input', 'published', []),
      version('draft', 'draft', [{ name: 'raw', required: true }]),
    ]

    expect(
      pipelinesThatReadADataset(
        buildPipelineRows(definitions, versions, []),
      ).map((row) => row.key),
    ).toEqual(['reads'])
  })

  it('preserves retired current versions and optional declared inputs', () => {
    const rows = buildPipelineRows(
      [definition('retired')],
      [version('retired', 'retired', [{ name: 'raw', required: false }])],
      [],
    )

    expect(pipelinesThatReadADataset(rows).map((row) => row.key)).toEqual([
      'retired',
    ])
  })
})

describe('DatasetRunPipeline', () => {
  it('renders nothing when no pipeline reads a dataset', async () => {
    await mount({ inputs: [] })
    expect(screen.queryByRole('button', { name: /run pipeline/i })).toBeNull()
  })

  it('starts the first input on the newest snapshot', async () => {
    const { onStarted, queryClient } = await mount()
    await userEvent.click(
      await screen.findByRole('button', { name: /run pipeline/i }),
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /Pipeline reads/ }),
    )
    expect(
      await screen.findByRole('dialog', { name: /Run Pipeline reads with/ }),
    ).toBeTruthy()
    expect(onStarted).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledExactlyOnceWith(STARTED),
    )
    expect(transport).toHaveBeenCalledWith(
      '/api/db/rpc/start_pipeline_run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          p_workspace_id: 'ws',
          p_definition_version_id: 'reads-v1',
          p_trigger_kind: 'manual',
          p_parameters: {},
          p_input_versions: { raw: 'snap-1' },
          p_retry_of_run_id: null,
          p_trigger_occurrence_id: null,
          p_schedule_id: null,
        }),
      }),
    )
    expect(transport).toHaveBeenCalledWith(
      '/api/pipelines/execute',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ runId: 'run-1' }),
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      queryClient.getQueryState(['ui-port', 'pipelines', 'invalidation-check'])
        ?.isInvalidated,
    ).toBe(true)
    expect(transport).toHaveBeenCalledWith('/api/pipelines/execute?runId=run-1')
  })

  it('asks for a snapshot first when there is none', async () => {
    const { onStarted } = await mount({ latestVersionId: null })
    await userEvent.click(
      await screen.findByRole('button', { name: /run pipeline/i }),
    )
    expect(await screen.findByText(/take a snapshot first/i)).toBeTruthy()
    await userEvent.click(
      screen.getByRole('menuitem', { name: /Pipeline reads/ }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onStarted).not.toHaveBeenCalled()
    expect(
      transport.mock.calls.some(
        ([url]) => url === '/api/db/rpc/start_pipeline_run',
      ),
    ).toBe(false)
  })

  it('does not execute or call onStarted when permission is refused', async () => {
    const { onStarted, queryClient } = await mount({ refused: true })
    await userEvent.click(
      await screen.findByRole('button', { name: /run pipeline/i }),
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /Pipeline reads/ }),
    )
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll().at(-1)?.state.status).toBe(
        'error',
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Run' }).disabled,
      ).toBe(false),
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onStarted).not.toHaveBeenCalled()
    expect(
      transport.mock.calls.some(([url]) => url === '/api/pipelines/execute'),
    ).toBe(false)
    expect(
      queryClient.getQueryState(['ui-port', 'pipelines', 'invalidation-check'])
        ?.isInvalidated,
    ).toBe(false)
  })
})
