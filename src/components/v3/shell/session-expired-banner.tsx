import { useEffect, useRef } from 'react'

import { useLiveStatus } from '#/components/live/live-event-provider'
import { signInHrefFor, useSessionExpired } from '#/lib/session-expiry'
import { t } from '#/copy'

/**
 * J-SET-05: the session ended while the tab was open. Reads the central
 * session-expiry signal (any 401 from the data boundary) and the live stream's
 * `session_expired` reset, and names the cause with a sign-in link that returns
 * to this page. Edits held on this device are not discarded.
 */
export function SessionExpiredBanner({
  expired: expiredOverride,
  path,
}: {
  expired?: boolean
  path?: string
} = {}) {
  const stored = useSessionExpired()
  const live = useLiveStatus()
  const expired =
    expiredOverride ?? (stored || live.lastResetReason === 'session_expired')
  const ref = useRef<HTMLDivElement>(null)
  // The shell reads this height to start below the banner, so the banner never
  // covers the search box or the New button.
  useEffect(() => {
    const element = ref.current
    if (!expired || !element) return
    const root = document.documentElement
    const sync = () =>
      root.style.setProperty(
        '--session-banner-h',
        `${element.getBoundingClientRect().height}px`,
      )
    sync()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      root.style.removeProperty('--session-banner-h')
    }
  }, [expired])
  if (!expired) return null
  const here =
    path ??
    (typeof window === 'undefined'
      ? '/'
      : `${window.location.pathname}${window.location.search}`)
  return (
    <div
      ref={ref}
      role="alert"
      data-session-expired
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning-border bg-warning-wash px-4 py-2 text-label text-fg md:px-6"
    >
      <span>
        <b className="font-semibold">
          {t('settings.shell.sessionExpiredBanner.sessionEnded')}
        </b>
        {t('settings.shell.sessionExpiredBanner.signAgainKeep')}
      </span>
      <a className="ml-auto font-medium" href={signInHrefFor(here)}>
        {t('settings.shell.sessionExpiredBanner.sign')}
      </a>
    </div>
  )
}
