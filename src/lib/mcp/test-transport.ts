import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '../data-client'
import type { DataClient } from '../data-client'

/** Exercise the real JSON transport; only the HTTP server is a fixture. */
export function testClient(
  replies: Partial<{
    [Method in 'rpc' | 'list' | 'count']: Mock<DataClient[Method]>
  }> = {},
): DataClient {
  const client = createDataClient(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://mcp.test',
    )

    const request = new Request(url, init)
    const resource = url.pathname.replace(/^\/api\/db\//, '')

    if (resource.startsWith('rpc/')) {
      const args = z.record(z.string(), z.json()).parse(await request.json())

      const value = replies.rpc
        ? await replies.rpc(resource.slice(4), args)
        : {}

      return value === undefined
        ? new Response(null, { status: 204 })
        : Response.json(value)
    }

    if (request.headers.get('prefer') === 'count=exact') {
      const count = replies.count
        ? await replies.count(resource, url.search)
        : 0

      return Response.json([], { headers: { 'content-range': `*/${count}` } })
    }

    if (request.method !== 'GET') {
      throw new Error(
        `Unexpected table write in MCP test: ${request.method} ${resource}`,
      )
    }

    return Response.json(
      replies.list ? await replies.list(resource, url.search) : [],
    )
  })

  vi.spyOn(client, 'list')
  vi.spyOn(client, 'count')
  vi.spyOn(client, 'rpc')
  vi.spyOn(client, 'insert')
  vi.spyOn(client, 'patch')
  vi.spyOn(client, 'remove')

  return client
}
