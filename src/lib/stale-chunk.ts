import { t } from '#/copy'

/**
 * A deploy replaces the hashed script files a tab already holds, so a lazy
 * import can fail with "Failed to fetch dynamically imported module" until the
 * page is reloaded. This is not the person's fault and not something the
 * assistant can fix, so it is retried, then the page reloads on its own.
 */

const RELOAD_KEY = 'sheetbase.stale-chunk-reload'
const RELOAD_WINDOW_MS = 30_000

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A failed import is a caught throw, untyped by definition.
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''

  return /dynamically imported module|importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    message,
  )
}

/** The plain words shown when a script file is out of date. */
export function staleChunkMessage(): string {
  return t('notebook.assistantPanel.proposal.updated')
}

/** True when this words came from a stale script file, so it is not fed to the assistant. */
export function isStaleChunkReason(reason: string): boolean {
  return reason.includes(staleChunkMessage())
}

/** Reloads once per half minute; returns false when it already did. */
export function reloadForNewVersion(): boolean {
  if (typeof window === 'undefined') return false

  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0)

    if (Date.now() - last < RELOAD_WINDOW_MS) return false
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // Storage can be blocked; reload anyway, once, below.
  }

  window.location.reload()

  return true
}

/**
 * Loads a lazy module. A failure is retried once, then the page reloads to get
 * the new files and the person gets a plain message instead of a file name.
 */
export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (first) {
    if (!isStaleChunkError(first)) throw first

    await new Promise((resolve) => setTimeout(resolve, 400))

    try {
      return await load()
    } catch (second) {
      if (!isStaleChunkError(second)) throw second
      reloadForNewVersion()
      throw new Error(staleChunkMessage())
    }
  }
}

/** Reloads when Vite cannot preload a page's script files after a deploy. */
export function installStaleChunkReload(): () => void {
  const handler = (event: Event) => {
    if (reloadForNewVersion()) event.preventDefault()
  }

  window.addEventListener('vite:preloadError', handler)

  return () => window.removeEventListener('vite:preloadError', handler)
}
