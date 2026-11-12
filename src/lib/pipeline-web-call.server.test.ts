import { describe, expect, it, vi } from 'vitest'

import {
  WebCallError,
  isForbiddenAddress,
  newWebCallSession,
  requestDigestOf,
  runWebCallStep,
  webCallUrl,
} from './pipeline-web-call.server'
import type { WebCallDeps } from './pipeline-web-call.server'
import type { PipelineWebCall } from './pipelines/web-call'

const CONNECTION = {
  id: 'c1',
  key: 'lims',
  name: 'LIMS',
  baseUrl: 'https://lims.example.com/api',
  status: 'active',
  authHeader: 'Authorization',
  authScheme: 'Bearer',
}

const SECRET = 'tok-very-secret-123'

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function deps(
  fetchImpl: (url: URL, init: RequestInit) => Response | Promise<Response>,
  over: Partial<WebCallDeps> = {},
): WebCallDeps & { fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) =>
    fetchImpl(new URL(url), init ?? {}),
  )

  return {
    loadConnection: async () => CONNECTION,
    loadSecret: async (_ws, _id, name) =>
      name === 'LIMS_READ_TOKEN' ? SECRET : null,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => undefined,
    resolveHost: async () => ['93.184.216.34'],
    checkHostPolicy: () => undefined,
    ...over,
  } as WebCallDeps & { fetch: ReturnType<typeof vi.fn> }
}

const GET: PipelineWebCall = {
  connection: 'lims',
  method: 'GET',
  path: '/batches?project={parameters.project}',
  secret: 'LIMS_READ_TOKEN',
  itemsPath: 'items',
}

const run = (
  d: WebCallDeps,
  session = newWebCallSession('live'),
  call: PipelineWebCall = GET,
) =>
  runWebCallStep({
    workspaceId: 'w1',
    stepName: 'lims',
    call,
    parameters: { project: 'AAV9 PT' },
    session,
    deps: d,
  })

describe('runWebCallStep', () => {
  it('signs the call with the named secret and reads the rows', async () => {
    const d = deps(() => json({ items: [{ batch: 'A', titre: 3.2 }] }))
    const session = newWebCallSession('live')
    const result = await run(d, session)

    expect(result.rows).toEqual([{ batch: 'A', titre: 3.2 }])
    const [url, init] = d.fetch.mock.calls[0]

    expect(String(url)).toBe(
      'https://lims.example.com/api/batches?project=AAV9%20PT',
    )
    expect(init.headers.authorization).toBe(`Bearer ${SECRET}`)
    expect(init.method).toBe('GET')
    expect(init.redirect).toBe('manual')
  })

  it('records the response, and never the secret', async () => {
    const d = deps(() => json({ items: [] }))
    const session = newWebCallSession('live')
    await run(d, session)

    expect(session.collected).toHaveLength(1)
    const [kept] = session.collected

    expect(kept).toMatchObject({ stepName: 'lims', status: 200, attempts: 1 })
    expect(JSON.stringify(kept)).not.toContain(SECRET)
    expect(kept.requestDigest).toBe(requestDigestOf('GET', kept.url, undefined))
  })

  it('tries a failing call again three times, then says who answered what', async () => {
    const d = deps(() => new Response('no', { status: 503 }))

    await expect(run(d)).rejects.toThrow('LIMS answered 503.')
    expect(d.fetch).toHaveBeenCalledTimes(4)
  })

  it('does not retry a refusal', async () => {
    const d = deps(() => new Response('no', { status: 404 }))

    await expect(run(d)).rejects.toThrow('LIMS answered 404.')
    expect(d.fetch).toHaveBeenCalledTimes(1)
  })

  it('recovers when a retry succeeds and records how many tries it took', async () => {
    let n = 0
    const d = deps(() =>
      ++n < 3 ? new Response('busy', { status: 429 }) : json({ items: [] }),
    )

    const session = newWebCallSession('live')
    await run(d, session)

    expect(session.collected[0].attempts).toBe(3)
  })

  it('treats a network failure as unreachable, without the cause', async () => {
    const d = deps(() => {
      throw new Error(`connect ECONNREFUSED with ${SECRET}`)
    })

    const error: Error = await run(d).then(
      () => new Error('it did not fail'),
      (cause: Error) => cause,
    )

    expect(error.message).toBe('LIMS could not be reached after trying again.')
    expect(error.message).not.toContain(SECRET)
  })

  it('refuses a redirect to another address, so the secret goes nowhere else', async () => {
    const d = deps(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example.net/x' },
        }),
    )

    await expect(run(d)).rejects.toThrow('sent the call somewhere else')
    expect(d.fetch).toHaveBeenCalledTimes(1)
  })

  it('follows a redirect inside the same address', async () => {
    const d = deps((url) =>
      url.pathname === '/api/moved'
        ? json({ items: [{ a: 1 }] })
        : new Response(null, {
            status: 301,
            headers: { location: '/api/moved' },
          }),
    )

    expect((await run(d)).rows).toEqual([{ a: 1 }])
  })

  it('refuses addresses a connection must never reach', async () => {
    const metadata = deps(() => json({}), {
      loadConnection: async () => ({
        ...CONNECTION,
        baseUrl: 'https://169.254.169.254/latest',
      }),
    })

    await expect(run(metadata)).rejects.toThrow('cannot go to this computer')
    expect(metadata.fetch).not.toHaveBeenCalled()

    const rebound = deps(() => json({}), {
      resolveHost: async () => ['127.0.0.1'],
    })

    await expect(run(rebound)).rejects.toThrow('cannot go to this computer')
    expect(rebound.fetch).not.toHaveBeenCalled()
  })

  it('applies the deployment’s host policy', async () => {
    const d = deps(() => json({}), {
      checkHostPolicy: () => {
        throw new WebCallError(
          'not on this deployment’s connector host allowlist',
        )
      },
    })

    await expect(run(d)).rejects.toThrow('allowlist')
  })

  it('fails plainly for a missing connection, a switched-off one or a missing secret', async () => {
    await expect(
      run(deps(() => json({}), { loadConnection: async () => null })),
    ).rejects.toThrow('no connection called “lims”')
    await expect(
      run(
        deps(() => json({}), {
          loadConnection: async () => ({ ...CONNECTION, status: 'off' }),
        }),
      ),
    ).rejects.toThrow('switched off')
    await expect(
      run(
        deps(() => json({})),
        newWebCallSession('live'),
        {
          ...GET,
          secret: 'OTHER',
        },
      ),
    ).rejects.toThrow('has no secret called “OTHER”')
  })

  it('fails when the answer is not JSON or has no rows at the path', async () => {
    await expect(
      run(deps(() => new Response('<html>', { status: 200 }))),
    ).rejects.toThrow('did not answer with JSON')
    await expect(run(deps(() => json({ other: [] })))).rejects.toThrow(
      'nothing at “items”',
    )
  })

  it('sends a POST body as JSON', async () => {
    const d = deps(() => json({ items: [] }))

    await run(d, newWebCallSession('live'), {
      connection: 'lims',
      method: 'POST',
      path: '/search',
      body: { project: '{parameters.project}' },
      itemsPath: 'items',
    })
    const [, init] = d.fetch.mock.calls[0]

    expect(init.body).toBe('{"project":"AAV9 PT"}')
    expect(init.headers['content-type']).toBe('application/json')
  })

  describe('recordings', () => {
    it('a run that asks again from the top reads what it recorded', async () => {
      const first = deps(() => json({ items: [{ a: 1 }] }))
      const live = newWebCallSession('live')
      await run(first, live)

      const again = deps(() => {
        throw new Error('must not ask')
      })

      const resumed = newWebCallSession('live', live.collected)
      const result = await run(again, resumed)

      expect(result.rows).toEqual([{ a: 1 }])
      expect(again.fetch).not.toHaveBeenCalled()
      expect(resumed.collected).toEqual([])
    })

    it('a reproduction never asks, and says when nothing was recorded', async () => {
      const d = deps(() => json({}))

      await expect(run(d, newWebCallSession('replay'))).rejects.toThrow(
        'did not record an answer for step lims',
      )
      expect(d.fetch).not.toHaveBeenCalled()
    })

    it('a recording of another request is not the step’s answer', async () => {
      const live = newWebCallSession('live')
      await run(
        deps(() => json({ items: [] })),
        live,
      )

      await expect(
        runWebCallStep({
          workspaceId: 'w1',
          stepName: 'lims',
          call: GET,
          parameters: { project: 'something else' },
          session: newWebCallSession('replay', live.collected),
          deps: deps(() => json({})),
        }),
      ).rejects.toThrow('would now ask for something other than')
    })

    it('a try sends a GET and keeps nothing', async () => {
      const d = deps(() => json({ items: [{ a: 1 }] }))
      const session = newWebCallSession('trial')

      expect((await run(d, session)).rows).toEqual([{ a: 1 }])
      expect(session.collected).toEqual([])
    })

    it('a try does not send a POST: it reads the last recording of the same request, or stops', async () => {
      const post: PipelineWebCall = {
        connection: 'lims',
        method: 'POST',
        path: '/search',
        body: { q: 1 },
        itemsPath: 'items',
      }

      const d = deps(() => json({ items: [{ a: 1 }] }))

      await expect(run(d, newWebCallSession('trial'), post)).rejects.toThrow(
        'A try does not send a POST',
      )
      expect(d.fetch).not.toHaveBeenCalled()

      const live = newWebCallSession('live')
      await run(d, live, post)
      d.fetch.mockClear()

      const trial = newWebCallSession('trial', [], {
        latestFor: async (_ws, digest) =>
          live.collected.find((r) => r.requestDigest === digest) ?? null,
      })

      expect((await run(d, trial, post)).rows).toEqual([{ a: 1 }])
      expect(d.fetch).not.toHaveBeenCalled()
    })
  })
})

describe('webCallUrl', () => {
  it('keeps the call inside the connection’s address', () => {
    expect(
      String(
        webCallUrl('https://h.example.com/api', '/a?x={parameters.x}', {
          x: 'y z',
        }),
      ),
    ).toBe('https://h.example.com/api/a?x=y%20z')
    expect(() =>
      webCallUrl('https://h.example.com/api', '/../admin', {}),
    ).toThrow('outside the address')
    expect(() =>
      webCallUrl('https://h.example.com/api', '//evil.com/x', {}),
    ).not.toThrow()
    expect(
      String(webCallUrl('https://h.example.com/api', '//evil.com/x', {})),
    ).toBe('https://h.example.com/api//evil.com/x')
  })
})

describe('isForbiddenAddress', () => {
  it('blocks loopback, unspecified, link-local and metadata, not private ranges', () => {
    for (const a of [
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',
      '::1',
      '::',
      'fe80::1',
      '::ffff:127.0.0.1',
      'localhost',
      'app.localhost',
    ])
      expect(isForbiddenAddress(a), a).toBe(true)

    for (const a of [
      '10.1.2.3',
      '192.168.1.5',
      '93.184.216.34',
      '2606:2800::1',
    ])
      expect(isForbiddenAddress(a), a).toBe(false)
  })
})
