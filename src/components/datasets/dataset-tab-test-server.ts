import { createServer } from 'node:http'
import { once } from 'node:events'
import { QueryClient } from '@tanstack/react-query'
import { cleanup } from '@testing-library/react'
import { onTestFinished } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '#/lib/data-client'

interface Reply {
  body: string
  status?: number
  ready?: Promise<void>
}

/** Exercise the real DataClient request and error-envelope paths over HTTP. */
export async function datasetTabTestServer(...replies: Reply[]) {
  const requests: { path: string | undefined; body: string }[] = []

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push({ path: request.url, body })
      const reply = replies.shift()

      const send = () => {
        response.writeHead(reply?.status ?? 200, {
          'content-type': 'application/json',
        })
        response.end(reply?.body ?? 'null')
      }

      if (reply?.ready) void reply.ready.then(send)
      else send()
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = z.object({ port: z.number() }).parse(server.address())
  const origin = `http://127.0.0.1:${address.port}`

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  onTestFinished(async () => {
    cleanup()
    queryClient.clear()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })

  const client = createDataClient((input, init) =>
    fetch(new URL(input instanceof Request ? input.url : input, origin), init),
  )

  return { client, queryClient, requests }
}
