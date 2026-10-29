import { useSyncExternalStore } from 'react'

/**
 * Data request instrumentation for the dev toolbar: a log of recent requests
 * with timings, and optional simulated latency or failure so a developer can
 * feel a slow or broken API. Inert (a plain pass-through) unless the toolbar is
 * active, and never runs on the server.
 */
export interface DevRequest {
  id: number
  method: string
  path: string
  /** HTTP status, or 0 for a request that failed before a response. */
  status: number
  ms: number
  simulated: boolean
}

export interface DevNetworkSettings {
  latencyMs: number
  /** 0 to 1: the share of requests answered with a simulated 503. */
  failRate: number
  offline: boolean
}

export const noSimulation: DevNetworkSettings = {
  latencyMs: 0,
  failRate: 0,
  offline: false,
}

const MAX_LOG = 40
const STORAGE_KEY = 'sb-dev-network'
const listeners = new Set<() => void>()

let active = false
let settings: DevNetworkSettings = noSimulation
let log: DevRequest[] = []
let inFlight = 0
let nextId = 1
let loaded = false
let snapshot = { log, inFlight }

export function parseNetworkSettings(raw: string | null): DevNetworkSettings {
  if (!raw) return noSimulation
  try {
    const v = JSON.parse(raw) as Partial<DevNetworkSettings>
    return {
      latencyMs:
        typeof v.latencyMs === 'number' && v.latencyMs >= 0 ? v.latencyMs : 0,
      failRate:
        typeof v.failRate === 'number' && v.failRate >= 0 && v.failRate <= 1
          ? v.failRate
          : 0,
      offline: v.offline === true,
    }
  } catch {
    return noSimulation
  }
}

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    settings = parseNetworkSettings(localStorage.getItem(STORAGE_KEY))
  } catch {
    /* blocked storage */
  }
}

function emit() {
  snapshot = { log, inFlight }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  load()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function setDevNetworkActive(next: boolean) {
  load()
  active = next
}

export function setDevNetwork(patch: Partial<DevNetworkSettings>) {
  load()
  settings = { ...settings, ...patch }
  try {
    if (isQuiet(settings)) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    }
  } catch {
    /* lasts for this page */
  }
  emit()
}

export function isQuiet(s: DevNetworkSettings): boolean {
  return s.latencyMs === 0 && s.failRate === 0 && !s.offline
}

export function clearDevRequests() {
  log = []
  emit()
}

export function useDevNetworkSettings(): DevNetworkSettings {
  return useSyncExternalStore(
    subscribe,
    () => {
      load()
      return settings
    },
    () => noSimulation,
  )
}

export function useDevRequests() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  )
}

/** Summary numbers over the logged requests. */
export function summariseRequests(requests: readonly DevRequest[]) {
  const total = requests.reduce((sum, r) => sum + r.ms, 0)
  return {
    count: requests.length,
    failed: requests.filter((r) => r.status === 0 || r.status >= 400).length,
    averageMs: requests.length ? Math.round(total / requests.length) : 0,
    slowestMs: requests.reduce((max, r) => Math.max(max, r.ms), 0),
  }
}

function record(entry: Omit<DevRequest, 'id'>) {
  log = [{ id: nextId++, ...entry }, ...log].slice(0, MAX_LOG)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `fetch` for the data client: logs, and applies any simulation, when active. */
export async function devFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!active || typeof window === 'undefined') return fetchImpl(url, init)
  const started = performance.now()
  const method = (init.method ?? 'GET').toUpperCase()
  const path = url.replace(/^\/api\/db/, '')
  inFlight += 1
  emit()
  let settled = false
  const finish = (status: number, simulated: boolean) => {
    if (settled) return
    settled = true
    inFlight -= 1
    record({
      method,
      path,
      status,
      ms: Math.round(performance.now() - started),
      simulated,
    })
    emit()
  }
  try {
    if (settings.latencyMs > 0) await wait(settings.latencyMs)
    if (settings.offline) {
      finish(0, true)
      throw new TypeError('Failed to fetch')
    }
    if (settings.failRate > 0 && Math.random() < settings.failRate) {
      finish(503, true)
      return new Response(
        JSON.stringify({
          error: {
            code: 'dev_simulated_failure',
            message: 'Simulated failure from the dev toolbar',
          },
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      )
    }
    const response = await fetchImpl(url, init)
    finish(response.status, false)
    return response
  } catch (error) {
    finish(0, false)
    throw error
  }
}
