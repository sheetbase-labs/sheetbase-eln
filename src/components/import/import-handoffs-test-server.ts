import { once } from 'node:events'
import { createServer } from 'node:http'
import { z } from 'zod'

interface Reply {
  path: string
  body: string
  status?: number
  ready?: Promise<void>
}

/** Only the URL changes: production fetch, DataClient and connector code still run. */
export async function importHandoffsTestServer() {
  const requests: {
    path: string | undefined
    method: string | undefined
    body: string
  }[] = []

  const replies: Reply[] = []
  const unexpected: string[] = []

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push({ path: request.url, method: request.method, body })
      const reply = replies.shift()

      if (!reply || reply.path !== request.url || request.method !== 'POST') {
        unexpected.push(`${request.method} ${request.url}`)
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Unexpected test request' }))

        return
      }

      const send = () => {
        response.writeHead(reply.status ?? 200, {
          'content-type': 'application/json',
        })
        response.end(reply.body)
      }

      if (reply.ready) void reply.ready.then(send)
      else send()
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = z.object({ port: z.number() }).parse(server.address())
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, init) =>
    originalFetch(
      new URL(
        input instanceof Request ? input.url : input,
        `http://127.0.0.1:${port}`,
      ),
      init,
    )

  return {
    requests,
    replies,
    unexpected,
    async close() {
      globalThis.fetch = originalFetch
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

export function handoffGate() {
  let resolve: () => void = () => undefined
  let reject: (error: Error) => void = () => undefined

  const promise = new Promise<void>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })

  return { promise, resolve, reject }
}
