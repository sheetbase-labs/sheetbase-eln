import { useSyncExternalStore } from 'react'

const SWITCH_KEY = 'sb-devtools'
const listeners = new Set<() => void>()
let switched: '1' | '0' | null = null
let loaded = false

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    const stored = localStorage.getItem(SWITCH_KEY)
    switched = stored === '1' || stored === '0' ? stored : null
  } catch {
    /* blocked storage: the build decides */
  }
}

function subscribe(cb: () => void) {
  load()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** `'1'` shown, `'0'` hidden, `null` never chosen (the build decides). */
export function useDevSwitch(): '1' | '0' | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      load()
      return switched
    },
    () => null,
  )
}

export function setDevSwitch(on: boolean) {
  load()
  switched = on ? '1' : '0'
  try {
    localStorage.setItem(SWITCH_KEY, switched)
  } catch {
    /* lasts for this page */
  }
  listeners.forEach((l) => l())
}
