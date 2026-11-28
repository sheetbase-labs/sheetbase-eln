/**
 * Warm start for pages. A record page asks for the same few dozen reads
 * every time it opens (the record, its links, its signatures, its review state
 * …), but only asks once its code has loaded and the record it needs has
 * arrived, so the reads queue up in waves. This module remembers which reads
 * each kind of page made last time and, the moment a person navigates to one,
 * starts the ones that depend only on the record's own id, all together, before
 * the page has rendered. The page then finds its answers waiting.
 *
 * Nothing here knows about any page: it watches the reads the data client is
 * asked for while a page is open, keeps the ones that can be asked again for a
 * different record, and replays them. A read that names anything else (the
 * project, a template, a linked record) is left out, because it cannot be known
 * ahead of the record. A page that changes its reads is learned afresh on its
 * next visit, and a guess that is never asked for is forgotten after a few
 * seconds (`PRIMED_READ_MS` in data-client.ts). Anything written, or any live
 * change, empties it all, so a primed read never shows rows from before a
 * change the app knows about. Reads still run as the signed-in person.
 */
import { z } from 'zod'

import { observeReads, primeRead } from './data-client'
import type { ReadSpec } from './data-client'

export const STORAGE_KEY = 'sheetbase.warm-start.v1'

/** How long after a page opens its reads are noted. */
const LEARN_WINDOW_MS = 6000

const MAX_READS_PER_PAGE = 120
const MAX_PAGES = 40

export const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export const IDENTIFIER = /^[A-Z]{2,6}-\d{1,8}$/

const readSpec = z.object({
  method: z.enum(['GET', 'POST']),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string().optional(),
})

const storedState = z.object({
  templates: z.record(z.string(), z.array(readSpec)),
  aliases: z.record(z.string(), z.string()),
})

type State = z.infer<typeof storedState>

/** The kind of page a path is, and the records it is about. */
export interface PagePattern {
  pattern: string
  subjects: string[]
}

/**
 * Each id in the path becomes `:id`, so every experiment is one kind of page. A
 * path with no id (Home, a list) is a page of its own.
 */
export function pagePattern(pathname: string): PagePattern {
  const subjects: string[] = []

  const pattern = pathname
    .split('/')
    .map((segment) => {
      const whole = UUID.exec(segment)

      if (
        (whole && whole[0].length === segment.length) ||
        IDENTIFIER.test(segment)
      ) {
        subjects.push(segment)

        return ':id'
      }

      return segment
    })
    .join('/')

  return { pattern, subjects }
}

const mark = (index: number) => `\u0001${index}\u0001`

/**
 * A read with the page's own ids taken out, or null when it names anything
 * else. A page with no id of its own (Home, a list) is the same page every
 * time, so its reads are kept as they were, ids and all: they are only ever
 * used by that page asking for exactly the same thing again.
 */
function templateOf(read: ReadSpec, subjects: string[]): ReadSpec | null {
  if (subjects.length === 0) return read

  const blank = (text: string) =>
    subjects.reduce(
      (out, subject, index) => out.split(subject).join(mark(index)),
      text,
    )

  const path = blank(read.path)
  const body = read.body === undefined ? undefined : blank(read.body)

  // Another record's id (a project, a linked record, a person) cannot be known
  // before the page has its own record, so that read is left for the page.
  if (UUID.test(path) || (body !== undefined && UUID.test(body))) return null

  // A read that names no record at all is the same on every page, so it stays.
  return { ...read, path, body }
}

function fill(template: ReadSpec, subjects: string[]): ReadSpec | null {
  const fillIn = (text: string) =>
    subjects.reduce(
      (out, subject, index) => out.split(mark(index)).join(subject),
      text,
    )

  const path = fillIn(template.path)
  const body = template.body === undefined ? undefined : fillIn(template.body)

  // The page that was learned had more ids than this one has.
  if (path.includes('\u0001') || body?.includes('\u0001') === true) return null

  return { ...template, path, body }
}

/** What the warm start needs from outside; the app wires the data client and browser storage. */
export interface WarmStartDeps {
  /** Hears every read the page is asked for. */
  observe: (listener: (read: ReadSpec) => void) => void
  /** Starts a read ahead of the page that will ask for it. */
  prime: (read: ReadSpec) => void
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
}

/** The part of the router the warm start listens to; the real router satisfies it. */
export interface WarmStartRouter {
  subscribe: (
    type: 'onBeforeNavigate' | 'onResolved',
    listener: (event: {
      toLocation: { pathname: string }
      pathChanged: boolean
    }) => void,
  ) => () => void
}

interface Learning extends PagePattern {
  reads: Map<string, ReadSpec>
  timer: ReturnType<typeof setTimeout>
}

export function createWarmStart(deps: WarmStartDeps) {
  let state: State | null = null
  let learning: Learning | null = null
  let requestedPattern: string | null = null

  function load(): State {
    if (state) return state

    try {
      const stored = deps.storage?.getItem(STORAGE_KEY)
      const parsed = storedState.safeParse(stored ? JSON.parse(stored) : null)

      state = parsed.success ? parsed.data : { templates: {}, aliases: {} }
    } catch {
      state = { templates: {}, aliases: {} }
    }

    return state
  }

  function save(): void {
    try {
      deps.storage?.setItem(STORAGE_KEY, JSON.stringify(load()))
    } catch {
      // Not saving only means the next visit starts from nothing.
    }
  }

  function finishLearning(): void {
    if (!learning) return
    clearTimeout(learning.timer)
    const { pattern, reads } = learning

    learning = null

    if (reads.size === 0) return
    const store = load()

    store.templates[pattern] = [...reads.values()].slice(0, MAX_READS_PER_PAGE)
    const known = Object.keys(store.templates)

    // The least recently learned pages go first once there are too many.
    for (const old of known.slice(0, Math.max(0, known.length - MAX_PAGES)))
      delete store.templates[old]
    save()
  }

  function noteRead(read: ReadSpec): void {
    if (!learning || learning.reads.size >= MAX_READS_PER_PAGE) return
    const template = templateOf(read, learning.subjects)

    if (!template) return
    learning.reads.set(
      `${template.method} ${template.path}\n${template.body ?? ''}\n${template.headers.prefer}\n${template.headers.range}`,
      template,
    )
  }

  /**
   * Starts the reads a record page is known to make, for the page at
   * `pathname`. Returns how many it started; a page never seen starts none.
   */
  function warmPage(pathname: string): number {
    const { pattern, subjects } = pagePattern(pathname)
    const store = load()
    const templates = store.templates[store.aliases[pattern] ?? pattern] ?? []
    let started = 0

    for (const template of templates) {
      const read = fill(template, subjects)

      if (!read) continue
      deps.prime(read)
      started += 1
    }

    return started
  }

  /** Notes the reads of the record page that has just opened, for its next visit. */
  function startLearning(pathname: string): void {
    finishLearning()
    const page = pagePattern(pathname)

    learning = {
      ...page,
      reads: new Map(),
      timer: setTimeout(finishLearning, LEARN_WINDOW_MS),
    }
  }

  /** Wires the warm start to a router, and starts what the first page needs. */
  function install(router: WarmStartRouter, firstPathname: string): void {
    deps.observe(noteRead)
    warmPage(firstPathname)
    // The page the app opens on is learned too: it is the one a person opens
    // most (Home, or the page they were on), and only a navigation inside the
    // app reports itself below.
    startLearning(firstPathname)

    router.subscribe('onBeforeNavigate', (event) => {
      if (!event.pathChanged) return
      requestedPattern = pagePattern(event.toLocation.pathname).pattern
      warmPage(event.toLocation.pathname)
    })

    router.subscribe('onResolved', (event) => {
      const { pattern } = pagePattern(event.toLocation.pathname)

      // A path that redirects (an experiment to its notebook) opens a
      // different page from the one asked for, so remember where it leads.
      if (requestedPattern && requestedPattern !== pattern) {
        load().aliases[requestedPattern] = pattern
        save()
      }

      requestedPattern = null
      startLearning(event.toLocation.pathname)
    })
  }

  return { warmStart: warmPage, install, finishLearning }
}

function browserStorage(): WarmStartDeps['storage'] {
  try {
    return window.localStorage
  } catch {
    // Storage can be blocked; the warm start then works from memory only.
    return null
  }
}

let app: ReturnType<typeof createWarmStart> | null = null

function appWarmStart() {
  app ??= createWarmStart({
    observe: (listener) => observeReads(listener),
    prime: primeRead,
    storage: browserStorage(),
  })

  return app
}

/** Starts the known reads of the record page at `pathname` (app instance). */
export function warmStart(pathname: string): number {
  return appWarmStart().warmStart(pathname)
}

/** Wires the app's warm start to its router (app instance). */
export function installWarmStart(
  router: WarmStartRouter,
  firstPathname: string,
): void {
  const warm = appWarmStart()

  warm.install(router, firstPathname)
  window.addEventListener('pagehide', warm.finishLearning)
  warmOnRest(document, (pathname) => warm.warmStart(pathname))
}

/** How long the pointer rests on a link to a record before its reads start. */
export const REST_MS = 150

/** A record page warmed by a rest is not warmed again for this long. */
const REWARM_MS = 10_000

/**
 * Starts a record page's known reads when the pointer rests on a link to it,
 * so a row that is about to be opened has its answers on the way. Only links
 * to record pages, only after a short rest (a pointer sweeping down a list
 * starts nothing), and each page at most once in a while.
 */
export function warmOnRest(
  root: Pick<EventTarget, 'addEventListener'>,
  warm: (pathname: string) => void,
  now: () => number = Date.now,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const warmed = new Map<string, number>()

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  root.addEventListener(
    'pointerover',
    (event) => {
      cancel()

      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null

      if (!link || link.origin !== window.location.origin) return
      const { pathname } = link

      if (
        pathname === window.location.pathname ||
        pagePattern(pathname).subjects.length === 0
      )
        return

      timer = setTimeout(() => {
        timer = null
        const last = warmed.get(pathname)

        if (last !== undefined && now() - last < REWARM_MS) return
        warmed.set(pathname, now())
        warm(pathname)
      }, REST_MS)
    },
    { passive: true },
  )
  root.addEventListener('pointerout', cancel, { passive: true })
}
