import { useSyncExternalStore } from 'react'

import { defaultDevSettings, parseStoredSettings } from './dev-settings'
import type { DevSettings } from './dev-settings'

const SETTINGS_KEY = 'sb-dev-settings'
const SWITCH_KEY = 'sb-devtools'
const STYLE_ID = 'sb-dev-toolbar-style'

const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode / disabled storage: the change lasts for this page */
  }
}

let settings: DevSettings = defaultDevSettings
let switched: '1' | '0' | null = null
let loaded = false

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  settings = parseStoredSettings(read(SETTINGS_KEY))
  const stored = read(SWITCH_KEY)
  switched = stored === '1' || stored === '0' ? stored : null
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

export function getDevSettings(): DevSettings {
  load()
  return settings
}

export function updateDevSettings(patch: Partial<DevSettings>) {
  load()
  settings = { ...settings, ...patch }
  write(SETTINGS_KEY, JSON.stringify(settings))
  emit()
}

export function resetDevSettings() {
  load()
  settings = defaultDevSettings
  write(SETTINGS_KEY, null)
  emit()
}

export function useDevSettings(): DevSettings {
  return useSyncExternalStore(
    subscribe,
    getDevSettings,
    () => defaultDevSettings,
  )
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
  write(SWITCH_KEY, switched)
  emit()
}

/** Write the settings into one `<style>` element, or remove it when empty. */
export function applyDevCss(css: string) {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID)
  if (!css) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = css
}
