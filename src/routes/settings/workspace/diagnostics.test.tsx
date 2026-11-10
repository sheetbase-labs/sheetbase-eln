import { afterEach, expect, it, vi } from 'vitest'
import { createDataClient } from '#/lib/data-client'
import { listPipelineRunLogs } from '#/lib/pipelines/data'

afterEach(() => vi.unstubAllGlobals())

// The compiled-browser diagnostics case renders this same identity. Verify the
// service's real HTTP query here, without replacing its DataClient with a cast.
it('keys pipeline run logs by the request ID shown in diagnostics', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111'
  const requests: URL[] = []

  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    requests.push(
      new URL(
        input instanceof Request ? input.url : String(input),
        'http://localhost',
      ),
    )

    return Promise.resolve(Response.json([]))
  })

  await expect(
    listPipelineRunLogs(createDataClient(), requestId),
  ).resolves.toEqual([])
  expect(requests).toHaveLength(1)
  expect(requests[0].pathname).toBe('/api/db/pipeline_run_logs')
  expect(requests[0].searchParams.get('run_id')).toBe(`eq.${requestId}`)
})
