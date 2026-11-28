// @vitest-environment jsdom
import { runInThisContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { ReadAnswer, ReadSpec } from './data-client'
import { adoptEarlyReads, earlyReadsScript } from './early-reads'
import { UNBATCHED_FLAG } from './read-batch'
import {
  createWarmStart,
  REST_MS,
  STORAGE_KEY,
  warmOnRest,
} from './route-warm-start'
import type { WarmStartRouter } from './route-warm-start'

const EXP = '11111111-1111-4111-8111-111111111111'

const get = (path: string): ReadSpec => ({
  method: 'GET',
  path,
  headers: { accept: 'application/json' },
})

const answer = (body: string): ReadAnswer => ({
  status: 200,
  body,
  contentRange: null,
})

/** Learns `reads` for the page at `learnedAt`, as the app would, into localStorage. */
function learn(learnedAt: string, reads: ReadSpec[]) {
  vi.useFakeTimers()
  let observer: ((read: ReadSpec) => void) | null = null

  const warm = createWarmStart({
    observe: (listener) => {
      observer = listener
    },
    prime: () => undefined,
    storage: window.localStorage,
  })

  const router: WarmStartRouter = { subscribe: () => () => undefined }

  // The page the app opens on is learned as it loads.
  warm.install(router, learnedAt)
  reads.forEach((read) => observer?.(read))
  vi.advanceTimersByTime(7000)
  vi.useRealTimers()
}

/** Runs the inline script at `pathname`; returns the batches it sent. */
/** What the batch route answers: its results, or something malformed. */
interface BatchReply {
  results: ReadAnswer[]
}

function runScript(pathname: string, reply: (reads: ReadSpec[]) => BatchReply) {
  window.history.replaceState(null, '', pathname)
  const sent: ReadSpec[][] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      // SAFETY: the body is the JSON the inline script built from ReadSpecs.
      const { reads } = JSON.parse(z.string().parse(init.body)) as {
        reads: ReadSpec[]
      }

      sent.push(reads)

      return new Response(JSON.stringify(reply(reads)), { status: 200 })
    }),
  )
  // The script is page markup: run it in the page's global scope, as the
  // browser does.
  runInThisContext(earlyReadsScript)

  return sent
}

afterEach(() => {
  window.localStorage.clear()
  window.__sheetbaseEarlyReads = undefined
  Reflect.deleteProperty(globalThis, UNBATCHED_FLAG)
})

describe('early reads', () => {
  it('sends the same reads the warm start would prime, for a record page', () => {
    learn(`/experiments/${EXP}/notebook`, [
      get(`/records?id=eq.${EXP}`),
      get('/my_profile'),
    ])
    const other = '22222222-2222-4222-8222-222222222222'
    const primed: ReadSpec[] = []

    const check = createWarmStart({
      observe: () => undefined,
      prime: (read) => primed.push(read),
      storage: window.localStorage,
    })

    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    check.warmStart(`/experiments/${other}/notebook`)

    const sent = runScript(`/experiments/${other}/notebook`, (reads) => ({
      results: reads.map(() => answer('[]')),
    }))

    expect(sent.flat()).toEqual(primed)
    expect(sent.flat()[0].path).toBe(`/records?id=eq.${other}`)
  })

  it('sends nothing for a page it has never seen', () => {
    learn('/', [get('/my_profile')])

    expect(runScript('/samples', () => ({ results: [] }))).toEqual([])
    expect(window.__sheetbaseEarlyReads).toBeUndefined()
  })

  it('leaves every read to the page when reads are kept unbatched', () => {
    learn('/', [get('/my_profile')])
    // A browser spec that answers reads by their own URL sets this first.
    Reflect.set(globalThis, UNBATCHED_FLAG, true)

    expect(runScript('/', () => ({ results: [answer('[]')] }))).toEqual([])
    expect(window.__sheetbaseEarlyReads).toBeUndefined()
  })

  it('hands each answer to the read that asks for it', async () => {
    learn('/', [get('/my_profile'), get('/inbox_counts')])
    runScript('/', (reads) => ({
      results: reads.map((read) => answer(JSON.stringify(read.path))),
    }))
    const held = new Map<string, Promise<ReadAnswer>>()

    expect(adoptEarlyReads((read, result) => held.set(read.path, result))).toBe(
      2,
    )
    expect((await held.get('/inbox_counts'))?.body).toBe('"/inbox_counts"')
    // Taken once: a second start finds nothing left.
    expect(adoptEarlyReads(() => undefined)).toBe(0)
  })

  it('lets the page ask for itself when the early batch fails', async () => {
    learn('/', [get('/my_profile')])
    runScript('/', () => ({ results: [] }))
    const held: Promise<ReadAnswer>[] = []

    adoptEarlyReads((_read, result) => held.push(result))

    await expect(held[0]).rejects.toThrow()
  })
})

describe('warming a record on a resting pointer', () => {
  it('starts a record page after a rest, once, and never for a passing pointer', () => {
    vi.useFakeTimers()
    const warmed: string[] = []
    const list = document.createElement('div')

    const link = (href: string) => {
      const a = document.createElement('a')
      a.href = href
      list.append(a)

      return a
    }

    const row = link(`/experiments/${EXP}`)
    const samples = link('/samples')

    const over = (el: Element) =>
      el.dispatchEvent(new Event('pointerover', { bubbles: true }))

    const out = (el: Element) =>
      el.dispatchEvent(new Event('pointerout', { bubbles: true }))

    document.body.append(list)
    warmOnRest(list, (pathname) => warmed.push(pathname))

    // A pointer passing over the row on its way somewhere else.
    over(row)
    vi.advanceTimersByTime(REST_MS / 2)
    out(row)
    vi.advanceTimersByTime(REST_MS)
    expect(warmed).toEqual([])

    // Resting on it starts it, and resting again soon after does not.
    over(row)
    vi.advanceTimersByTime(REST_MS)
    over(row)
    vi.advanceTimersByTime(REST_MS)
    // A list has no record to start.
    over(samples)
    vi.advanceTimersByTime(REST_MS)

    expect(warmed).toEqual([`/experiments/${EXP}`])
    list.remove()
    vi.useRealTimers()
  })
})
