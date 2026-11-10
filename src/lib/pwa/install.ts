/**
 * Installing Sheetbase as an app. Chrome and Edge offer an install prompt the
 * page can trigger once the browser has said the app is installable; iOS
 * Safari has no such prompt, so there the page can only point at Share > Add
 * to Home Screen. A person who says "not now" is not asked again for a month.
 */
import { useSyncExternalStore } from 'react'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Navigator {
    standalone?: boolean
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

export type InstallOffer = 'none' | 'prompt' | 'ios'

export const INSTALL_SNOOZE_KEY = 'sheetbase.install.snoozedUntil'
export const INSTALL_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

/** True when the page is already running as an installed app. */
export function isStandalone(win: Window = window): boolean {
  const nav = win.navigator

  return (
    nav.standalone === true ||
    win.matchMedia('(display-mode: standalone)').matches === true
  )
}

/** iPhone and iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIos(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true

  return platform === 'MacIntel' && maxTouchPoints > 1
}

/** Other iOS browsers (Chrome, Firefox, Edge) cannot add to the Home Screen. */
export function isIosSafari(userAgent: string): boolean {
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(userAgent)
}

export function installSnoozed(
  storage: Pick<Storage, 'getItem'> | null,
  now: number,
): boolean {
  try {
    const until = Number(storage?.getItem(INSTALL_SNOOZE_KEY) ?? 0)

    return Number.isFinite(until) && until > now
  } catch {
    return false
  }
}

export function snoozeInstall(
  storage: Pick<Storage, 'setItem'> | null,
  now: number,
): void {
  try {
    storage?.setItem(INSTALL_SNOOZE_KEY, String(now + INSTALL_SNOOZE_MS))
  } catch {
    /* private mode: the offer simply comes back next visit */
  }
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
let snoozedNow = false
let started = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('beforeinstallprompt', (event) => {
    // Hold the browser's own mini-bar back; we show our own offer instead.
    event.preventDefault()
    deferred = event
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

function localStore(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function snapshot(): InstallOffer {
  if (typeof window === 'undefined' || installed || snoozedNow) return 'none'

  if (isStandalone() || installSnoozed(localStore(), Date.now())) return 'none'

  if (deferred) return 'prompt'
  const nav = window.navigator

  if (
    isIos(nav.userAgent, nav.platform, nav.maxTouchPoints) &&
    isIosSafari(nav.userAgent)
  ) {
    return 'ios'
  }

  return 'none'
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** What kind of install offer to show right now, if any. */
export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribe, snapshot, () => 'none' as const)
}

/** Ask the browser to install. Resolves true if the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred

  if (!event) return false
  deferred = null
  emit()

  try {
    await event.prompt()
    const choice = await event.userChoice

    return choice.outcome === 'accepted'
  } catch {
    return false
  }
}

/** "Not now": hide the offer for a month. */
export function dismissInstallOffer(): void {
  snoozeInstall(localStore(), Date.now())
  snoozedNow = true
  emit()
}
