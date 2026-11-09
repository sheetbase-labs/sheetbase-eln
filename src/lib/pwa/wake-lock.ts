/**
 * Keep the screen on while someone is doing something they cannot touch the
 * phone for: a timer running, a code being scanned, a protocol being followed.
 * The browser drops the lock whenever the page is hidden, so it is taken again
 * when the page comes back. Browsers without the API just let the screen dim.
 */
import { useEffect } from 'react'

interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

interface WakeLockApi {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

export function wakeLockSupported(nav: Navigator = navigator): boolean {
  return 'wakeLock' in nav
}

/**
 * Holds a screen wake lock while `active`. Returns nothing: the lock is a
 * courtesy, never a requirement, so a refusal is silent.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return

    if (!wakeLockSupported()) return
    const api = (navigator as Navigator & { wakeLock: WakeLockApi }).wakeLock
    let sentinel: WakeLockSentinelLike | null = null
    const state = { cancelled: false }
    const stopped = () => state.cancelled

    const acquire = async () => {
      if (stopped() || sentinel || document.visibilityState !== 'visible')
        return

      try {
        const next = await api.request('screen')

        if (stopped()) {
          void next.release().catch(() => undefined)

          return
        }

        sentinel = next
        next.addEventListener('release', () => {
          if (sentinel === next) sentinel = null
        })
      } catch {
        // Low battery or a policy refused it; the screen may dim as usual.
      }
    }

    const onVisible = () => void acquire()

    void acquire()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      state.cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      const held = sentinel
      sentinel = null

      if (held) void held.release().catch(() => undefined)
    }
  }, [active])
}
