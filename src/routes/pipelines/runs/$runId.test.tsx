import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$runId'
import { pipelineTestRouter, routeQueryClient } from '../-route-test-support'
import { dropSharedReads } from '#/lib/data-client'

const transport = vi.hoisted(() => {
  const request = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', request)

  return request
})

let router: Awaited<ReturnType<typeof pipelineTestRouter>>

beforeEach(async () => {
  router = await pipelineTestRouter(
    Route.options.component,
    '/pipelines/runs/$runId',
    '/pipelines/runs/run-1',
  )
  vi.stubGlobal('fetch', transport)
  transport.mockResolvedValue(
    Response.json({ message: 'The run could not be read.' }, { status: 500 }),
  )
})

afterEach(() => {
  cleanup()
  transport.mockClear()
  vi.unstubAllGlobals()
  dropSharedReads()
})

function renderAlias(pipelineId: string | null, failed = false) {
  const client = routeQueryClient()
  const key = ['ui-port', 'pipelines', 'run-definition', 'run-1']
  client.setQueryData(key, pipelineId)

  if (failed)
    client
      .getQueryCache()
      .find({ queryKey: key })
      ?.setState({
        status: 'error',
        error: new Error('The run could not be read.'),
      })

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('legacy /pipelines/runs/$runId alias', () => {
  it('forwards a resolvable run to its pipeline', async () => {
    renderAlias('pipe-1')

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/pipelines/pipe-1/runs/run-1',
      ),
    )
    expect(router.state.location.pathname.split('/').slice(2)).toEqual([
      'pipe-1',
      'runs',
      'run-1',
    ])
  })

  it('says a missing run is not found and links back to Pipelines', () => {
    renderAlias(null)

    expect(screen.getByText('Run not found')).toBeTruthy()
    expect(screen.getByText('This run wasn’t found.')).toBeTruthy()
    expect(
      screen.getByText('Back to pipelines').closest('a')?.getAttribute('href'),
    ).toBe('/pipelines')
  })

  it('reports a failed lookup and offers a retry', async () => {
    renderAlias(null, true)

    expect(screen.getByText('Run unavailable')).toBeTruthy()
    expect(screen.getByText('Couldn’t load run.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        '/api/db/pipeline_runs?select=id,definition_version_id&id=eq.run-1',
        expect.objectContaining({ method: 'GET' }),
      ),
    )
  })
})
