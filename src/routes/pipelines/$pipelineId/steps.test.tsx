/**
 * The Standard editor: a step list the author adds to, edits and saves, with no-code
 * steps that write their own SQL and turn into plain SQL only on purpose.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { z } from 'zod'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './steps'
import { pipelineTestRouter, routeQueryClient } from '../-route-test-support'
import { pipelineDataQueryKeys } from '#/components/pipelines/pipelines-data'
import type { PythonRuntimeInfo } from '#/components/pipelines/pipelines-data'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import { dropSharedReads } from '#/lib/data-client'
import {
  PipelineEditorProvider,
  usePipelineEditorModel,
} from '#/components/pipelines/step-list/use-pipeline-editor'

const transport = vi.hoisted(() => {
  const request = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', request)

  return request
})

const rpc =
  vi.fn<
    (
      name: string,
      args: ReturnType<typeof pipelineJsonObjectSchema.parse>,
    ) => void
  >()

interface RuntimeState {
  isLoading: boolean
  data: PythonRuntimeInfo | undefined
}

interface RuntimeFixture {
  current: RuntimeState
}

const pythonRuntime: RuntimeFixture = {
  current: { isLoading: false, data: undefined },
}

function Harness() {
  const editor = usePipelineEditorModel('def-1', 'ws-1')
  const Page = Route.options.component

  if (!Page) return null

  return (
    <PipelineEditorProvider value={editor}>
      <Page />
    </PipelineEditorProvider>
  )
}

let router: Awaited<ReturnType<typeof pipelineTestRouter>>

beforeEach(async () => {
  router = await pipelineTestRouter(
    Harness,
    '/pipelines/$pipelineId/steps',
    '/pipelines/def-1/steps',
  )
  vi.stubGlobal('fetch', transport)
  transport.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        'http://localhost',
      )

      if (url.pathname.startsWith('/api/db/rpc/')) {
        if (url.pathname.endsWith('workspace_members_list'))
          return Response.json([])
        rpc(
          url.pathname.split('/').at(-1) ?? '',
          pipelineJsonObjectSchema.parse(
            JSON.parse(z.string().parse(init?.body)),
          ),
        )

        return Response.json({})
      }

      if (url.pathname === '/api/pipelines/runtime')
        return Response.json(pythonRuntime.current.data ?? { available: false })

      return Response.json([])
    },
  )
})

afterEach(() => {
  cleanup()
  rpc.mockClear()
  pythonRuntime.current = { isLoading: false, data: undefined }
  vi.unstubAllGlobals()
  dropSharedReads()
})

function renderSteps() {
  const client = routeQueryClient()
  client.setQueryData(pipelineDataQueryKeys.versions('def-1'), [])
  client.setQueryData(pipelineDataQueryKeys.definition('def-1'), {
    name: 'Viability summary',
  })
  client.setQueryData(['ui-port', 'pipelines', 'member-names'], {
    'u-1': 'Ada Lovelace',
  })
  client.setQueryData(
    ['ui-port', 'pipelines', 'python-runtime'],
    pythonRuntime.current.data ?? { available: false },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function addStep(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
  fireEvent.click(
    screen.getByRole('menuitem', { name: new RegExp(`^${label}`) }),
  )
}

describe('Standard editor', () => {
  it('shows the starts, inputs and output rows before any step is added', async () => {
    renderSteps()
    await screen.findByRole('button', { name: 'Add step' })
    expect(screen.getByText('Starts')).toBeTruthy()
    expect(screen.getByText('Inputs')).toBeTruthy()
    expect(screen.getByText('Output')).toBeTruthy()
  })

  it('adds a no-code step that shows the SQL it writes, read-only', async () => {
    renderSteps()
    await screen.findByRole('button', { name: 'Add step' })
    addStep('Filter rows')
    expect(await screen.findByText('Generated SQL')).toBeTruthy()
    expect(screen.getAllByText('Edit as SQL…').length).toBeGreaterThan(0)
  })

  it('asks before turning a form step into SQL', async () => {
    renderSteps()
    await screen.findByRole('button', { name: 'Add step' })
    addStep('Calculate')
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Edit as SQL…' }))[0],
    )
    expect(
      await screen.findByText(/You can’t turn it back into a form/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit as SQL' }))
    await waitFor(() =>
      expect(document.querySelector('.cm-content')).toBeTruthy(),
    )
  })

  it('removes a step from its menu', async () => {
    renderSteps()
    await screen.findByRole('button', { name: 'Add step' })
    addStep('SQL')
    fireEvent.click(
      await screen.findByRole('button', { name: /^More for step 1/ }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /^More for step 1/ }),
      ).toBeNull(),
    )
  })
})
