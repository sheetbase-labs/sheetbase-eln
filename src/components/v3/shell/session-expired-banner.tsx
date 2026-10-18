import { useLiveStatus } from '#/components/live/live-event-provider'
import { signInHrefFor, useSessionExpired } from '#/lib/session-expiry'

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
  if (!expired) return null
  const here =
    path ??
    (typeof window === 'undefined'
      ? '/'
      : `${window.location.pathname}${window.location.search}`)
  return (
    <div
      role="alert"
      data-session-expired
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning-border bg-warning-wash px-4 py-2 text-label text-fg md:px-6"
    >
      <span>
        <b className="font-semibold">Your session ended.</b> Sign in again to
        keep working. Edits held on this device are kept and sync after you sign
        in.
      </span>
      <a className="ml-auto font-medium" href={signInHrefFor(here)}>
        Sign in
      </a>
    </div>
  )
}
