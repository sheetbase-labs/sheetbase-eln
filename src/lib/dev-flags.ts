import { useSyncExternalStore } from 'react'

/**
 * Dev feature flags: switches a developer or admin flips from the dev toolbar
 * to try the app with a capability off. They are local to this browser and
 * only count while the toolbar is active, so no other person is ever affected
 * and a normal user's stale `localStorage` is ignored.
 *
 * They only ever turn a capability OFF for this browser. They never grant
 * anything: the deployment, the workspace settings and PostgreSQL RLS stay
 * authoritative (see `capabilities.ts`).
 *
 * To add a flag, add an entry to `devFlags` and read it with `useDevFlag` where
 * the feature starts.
 */
export const devFlags = [
  {
    key: 'liveUpdates',
    label: 'Live updates',
    hint: 'Changes from other people stream in. Off stops the event stream.',
  },
  {
    key: 'collaboration',
    label: 'Real-time collaboration',
    hint: 'Shared cursors and comments. Off hides them even where the deployment has them.',
  },
] as const

export type DevFlagKey = (typeof devFlags)[number]['key']
export type DevFlagOverrides = Partial<Record<DevFlagKey, boolean>>

const STORAGE_KEY = 'sb-dev-flags'
const listeners = new Set<() => void>()

let active = false
let overrides: DevFlagOverrides = {}
let loaded = false

export function parseOverrides(raw: string | null): DevFlagOverrides {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const out: DevFlagOverrides = {}
    for (const { key } of devFlags) {
      if (typeof value[key] === 'boolean') out[key] = value[key]
    }
    return out
  } catch {
    return {}
  }
}

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    overrides = parseOverrides(localStorage.getItem(STORAGE_KEY))
  } catch {
    /* blocked storage: start with no overrides */
  }
}

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  load()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** The flag's value: on unless the toolbar is active and switched it off. */
export function devFlagValue(key: DevFlagKey): boolean {
  load()
  return active ? (overrides[key] ?? true) : true
}

export function useDevFlag(key: DevFlagKey): boolean {
  return useSyncExternalStore(
    subscribe,
    () => devFlagValue(key),
    () => true,
  )
}

/** The raw overrides, for the toolbar's own list. */
export function useDevFlagOverrides(): DevFlagOverrides {
  return useSyncExternalStore(
    subscribe,
    () => {
      load()
      return overrides
    },
    () => ({}),
  )
}

/** The toolbar calls this when it shows or hides, so overrides only count while it is up. */
export function setDevFlagsActive(next: boolean) {
  load()
  if (active === next) return
  active = next
  emit()
}

export function setDevFlag(key: DevFlagKey, value: boolean | undefined) {
  load()
  const next = { ...overrides }
  if (value === undefined) delete next[key]
  else next[key] = value
  overrides = next
  try {
    if (Object.keys(next).length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* the change lasts for this page */
  }
  emit()
}
