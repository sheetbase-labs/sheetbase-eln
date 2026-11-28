/**
 * How the service worker serves a page. A server that is slow to answer is
 * still there: the page waits for it, or shows its last saved copy, and only a
 * request that fails reads "You are offline". Before, any page that took over
 * five seconds was cut off and replaced by the offline page.
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FetchHandler = (event: {
  request: Request
  respondWith: (response: Promise<Response>) => void
}) => void

function loadWorker(
  fetchImpl: (request: Request) => Promise<Response>,
  saved: Record<string, string> = {},
) {
  const handlers: FetchHandler[] = []

  const store = new Map(
    Object.entries(saved).map(([key, body]) => [key, new Response(body)]),
  )

  const cache = {
    match: async (key: string) => store.get(key)?.clone(),
    put: async (key: string, response: Response) => {
      store.set(key, response)
    },
    keys: async () => [...store.keys()],
    delete: async (key: string) => store.delete(key),
  }

  const self = {
    location: { origin: 'https://lab.test' },
    addEventListener: (type: string, handler: FetchHandler) => {
      if (type === 'fetch') handlers.push(handler)
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }

  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self,
    caches: { open: async () => cache, keys: async () => [] },
    fetch: fetchImpl,
    Response,
    URL,
    setTimeout,
    clearTimeout,
    Promise,
    console,
  })

  return (path: string): Promise<Response> => {
    // SAFETY: the worker reads only url, method and mode from a navigation.
    const request = {
      url: `https://lab.test${path}`,
      method: 'GET',
      mode: 'navigate',
    } as Request

    let answer: Promise<Response> | undefined

    for (const handler of handlers)
      handler({ request, respondWith: (response) => (answer = response) })

    if (!answer) throw new Error('the worker did not answer the page')

    return answer
  }
}

const later = (ms: number, body: string) =>
  new Promise<Response>((resolve) =>
    setTimeout(
      () =>
        resolve(
          new Response(body, { headers: { 'content-type': 'text/html' } }),
        ),
      ms,
    ),
  )

afterEach(() => {
  vi.useRealTimers()
})

describe('service worker pages', () => {
  it('waits for a slow server instead of saying the person is offline', async () => {
    vi.useFakeTimers()
    const open = loadWorker(() => later(9_000, 'review page'))
    const page = open('/review/r-1')
    await vi.advanceTimersByTimeAsync(9_000)
    const response = await page
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('review page')
  })

  it('shows the saved copy while a slow server answers', async () => {
    vi.useFakeTimers()

    const open = loadWorker(() => later(9_000, 'fresh'), {
      '/review/r-1': 'saved',
    })

    const page = open('/review/r-1')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await (await page).text()).toBe('saved')
  })

  it('says offline only when the request fails and nothing is saved', async () => {
    const open = loadWorker(() => Promise.reject(new TypeError('offline')))
    const response = await open('/review/r-1')
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('You are offline')
  })
})
