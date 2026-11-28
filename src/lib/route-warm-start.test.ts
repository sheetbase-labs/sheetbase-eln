import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadSpec } from './data-client'
import { createWarmStart, pagePattern } from './route-warm-start'
import type { WarmStartRouter } from './route-warm-start'

const EXP_A = '11111111-1111-4111-8111-111111111111'
const EXP_B = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'

type Navigation = Parameters<Parameters<WarmStartRouter['subscribe']>[1]>[0]

/** A warm start over a fake router and fake storage, with the reads it primes recorded. */
function setup(storage = new Map<string, string>()) {
  const primed: ReadSpec[] = []
  let observer: ((read: ReadSpec) => void) | null = null
  const listeners = new Map<string, (event: Navigation) => void>()

  const warm = createWarmStart({
    observe: (listener) => {
      observer = listener
    },
    prime: (read) => primed.push(read),
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value)
      },
    },
  })

  const router: WarmStartRouter = {
    subscribe: (type, fn) => {
      listeners.set(type, fn)

      return () => listeners.delete(type)
    },
  }

  return {
    warm,
    primed,
    storage,
    install: (firstPathname = '/experiments') =>
      warm.install(router, firstPathname),
    /** A person opens a page; `to` is where it ends up when it redirects. */
    go: (pathname: string, to = pathname) => {
      listeners.get('onBeforeNavigate')?.({
        toLocation: { pathname },
        pathChanged: true,
      })
      listeners.get('onResolved')?.({
        toLocation: { pathname: to },
        pathChanged: true,
      })
    },
    /** Only the search of the page changes. */
    goSearchOnly: (pathname: string) =>
      listeners.get('onBeforeNavigate')?.({
        toLocation: { pathname },
        pathChanged: false,
      }),
    /** The page asks for a read while it is open. */
    ask: (read: ReadSpec) => observer?.(read),
  }
}

const get = (path: string): ReadSpec => ({
  method: 'GET',
  path,
  headers: { accept: 'application/json' },
})

beforeEach(() => {
  vi.useFakeTimers()

  return () => {
    vi.useRealTimers()
  }
})

describe('pagePattern', () => {
  it('makes every record of one kind the same page', () => {
    expect(pagePattern(`/experiments/${EXP_A}/notebook`)).toEqual({
      pattern: '/experiments/:id/notebook',
      subjects: [EXP_A],
    })
    expect(pagePattern('/experiments/EXP-0145')).toEqual({
      pattern: '/experiments/:id',
      subjects: ['EXP-0145'],
    })
  })

  it('finds no record on a list page', () => {
    expect(pagePattern('/experiments').subjects).toEqual([])
  })
})

describe('warm start', () => {
  it('starts nothing for a page it has not seen', () => {
    const { warm } = setup()

    expect(warm.warmStart(`/experiments/${EXP_A}/notebook`)).toBe(0)
  })

  it('starts the reads of the last visit for a different record', () => {
    const { install, go, ask, primed } = setup()

    install()
    go(`/experiments/${EXP_A}/notebook`)
    ask(get(`/records?id=eq.${EXP_A}`))
    ask(get(`/record_links?source_record_id=eq.${EXP_A}`))
    ask(get('/workspace_settings?select=site'))
    vi.advanceTimersByTime(7000)

    go(`/experiments/${EXP_B}/notebook`)

    expect(primed.map((read) => read.path)).toEqual([
      `/records?id=eq.${EXP_B}`,
      `/record_links?source_record_id=eq.${EXP_B}`,
      '/workspace_settings?select=site',
    ])
  })

  it('leaves out a read that names a record other than the page’s own', () => {
    const { install, go, ask, primed } = setup()

    install()
    go(`/experiments/${EXP_A}/notebook`)
    ask(get(`/records?id=eq.${EXP_A}`))
    ask(get(`/projects?id=eq.${PROJECT}`))
    ask(get(`/records?project_id=eq.${PROJECT}&kind=eq.sample`))
    vi.advanceTimersByTime(7000)

    go(`/experiments/${EXP_B}/notebook`)

    expect(primed.map((read) => read.path)).toEqual([`/records?id=eq.${EXP_B}`])
  })

  it('carries a function call’s arguments over to the new record', () => {
    const { install, go, ask, primed } = setup()

    install()
    go(`/experiments/${EXP_A}/notebook`)
    ask({
      method: 'POST',
      path: '/rpc/record_series',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ p_record_id: EXP_A }),
    })
    vi.advanceTimersByTime(7000)

    go(`/experiments/${EXP_B}/notebook`)

    expect(primed).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ p_record_id: EXP_B }),
      }),
    ])
  })

  it('follows a redirect, so a page that opens another page is warmed too', () => {
    const { install, go, ask, primed } = setup()

    install()
    go(`/experiments/${EXP_A}`, `/experiments/${EXP_A}/notebook`)
    ask(get(`/records?id=eq.${EXP_A}`))
    vi.advanceTimersByTime(7000)

    go(`/experiments/${EXP_B}`, `/experiments/${EXP_B}/notebook`)

    expect(primed.map((read) => read.path)).toEqual([`/records?id=eq.${EXP_B}`])
  })

  it('learns the page afresh each visit, so a changed page is not replayed as it was', () => {
    const { install, go, ask, primed } = setup()

    install()
    go(`/experiments/${EXP_A}/notebook`)
    ask(get(`/records?id=eq.${EXP_A}`))
    ask(get(`/old_things?record_id=eq.${EXP_A}`))
    vi.advanceTimersByTime(7000)
    go(`/experiments/${EXP_B}/notebook`)
    ask(get(`/records?id=eq.${EXP_B}`))
    vi.advanceTimersByTime(7000)
    primed.length = 0

    go(`/experiments/${EXP_A}/notebook`)

    expect(primed.map((read) => read.path)).toEqual([`/records?id=eq.${EXP_A}`])
  })

  it('keeps what it learned for the next time the app opens', () => {
    const first = setup()

    first.install()
    first.go(`/experiments/${EXP_A}/notebook`)
    first.ask(get(`/records?id=eq.${EXP_A}`))
    vi.advanceTimersByTime(7000)

    const next = setup(first.storage)

    next.install(`/experiments/${EXP_B}/notebook`)

    expect(next.primed.map((read) => read.path)).toEqual([
      `/records?id=eq.${EXP_B}`,
    ])
  })

  it('does not warm a list page, which has no record of its own', () => {
    const { install, go, ask, warm } = setup()

    install()
    go('/experiments')
    ask(get('/records?kind=eq.experiment'))
    vi.advanceTimersByTime(7000)

    expect(warm.warmStart('/experiments')).toBe(0)
  })

  it('ignores a navigation that only changes the search', () => {
    const { primed, install, go, ask, goSearchOnly } = setup()

    install()
    go(`/experiments/${EXP_A}/notebook`)
    ask(get(`/records?id=eq.${EXP_A}`))
    vi.advanceTimersByTime(7000)
    goSearchOnly(`/experiments/${EXP_B}/notebook`)

    expect(primed).toEqual([])
  })

  it('works without storage, from memory', () => {
    const primed: ReadSpec[] = []

    const warm = createWarmStart({
      observe: () => undefined,
      prime: (read) => primed.push(read),
      storage: null,
    })

    expect(warm.warmStart(`/experiments/${EXP_A}/notebook`)).toBe(0)
  })
})
