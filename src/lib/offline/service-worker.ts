/**
 * Browser side of the service worker (`public/sw.js`): registers it so the app
 * opens offline, asks the browser not to evict the device store, and wires
 * background sync to the offline replay. Every call is a quiet no-op where the
 * browser lacks the feature.
 */

export const OFFLINE_SYNC_EVENT = 'sheetbase:offline-sync'
const SYNC_TAG = 'sheetbase-replay'

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> }
}

function canUseServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

/** Ask the browser to keep this site's storage, so drafts are never evicted. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = (navigator as { storage?: StorageManager }).storage

    if (!storage || typeof storage.persist !== 'function') return false

    if (await storage.persisted()) return true

    return await storage.persist()
  } catch {
    return false
  }
}

/** Ask for a background sync so edits queued offline go out on reconnect. */
export async function requestBackgroundSync(): Promise<boolean> {
  try {
    if (!canUseServiceWorker()) return false

    const registration = (await navigator.serviceWorker
      .ready) as SyncRegistration

    if (!registration.sync) return false
    await registration.sync.register(SYNC_TAG)

    return true
  } catch {
    return false
  }
}

/** Tell the worker to drop cached pages (they hold one person's data). */
export function clearOfflinePages(): void {
  try {
    ;(
      navigator as { serviceWorker?: ServiceWorkerContainer }
    ).serviceWorker?.controller?.postMessage({
      type: 'sheetbase:clear-pages',
    })
  } catch {
    // Nothing is cached if there is no worker.
  }
}

/** Files the page already loaded, so the worker can keep them for offline. */
function loadedAssetUrls(): string[] {
  return performance
    .getEntriesByType('resource')
    .map((entry) => new URL(entry.name, location.href))
    .filter((url) => url.origin === location.origin)
    .map((url) => url.pathname)
    .filter((path) => path.startsWith('/assets/'))
}

/**
 * Register the worker, keep what this page loaded, ask for persistent storage
 * and turn the worker's sync wake-up into a window event the replay listens
 * for. Returns a cleanup function.
 */
export async function startOfflineSupport(): Promise<() => void> {
  if (!canUseServiceWorker()) return () => undefined

  const onMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'sheetbase:replay') {
      window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT))
    }
  }

  navigator.serviceWorker.addEventListener('message', onMessage)

  try {
    await navigator.serviceWorker.register('/sw.js')
    const registration = await navigator.serviceWorker.ready
    registration.active?.postMessage({
      type: 'sheetbase:warm',
      urls: loadedAssetUrls(),
    })
    void requestPersistentStorage()
  } catch {
    // The app still works online without it.
  }

  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}
