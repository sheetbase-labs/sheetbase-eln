'use client'

/**
 * EXP-05.2 — the connected offline surfaces the Notebook mounts.
 *
 * `OfflineStatusBanner` reads the live-event status (the same signal the
 * app-shell indicator uses; there is no second connection state), the last
 * time this tab synced, and the unsynced count, and renders the banner plus
 * the offline-capabilities note only while offline. `UnsyncedChangesSection`
 * renders the inspector's list from the device store.
 *
 * Both are client-only: they render nothing before mount so server markup
 * never contains an "offline" claim that hydration would contradict.
 */

import * as React from 'react'

import {
  useLiveCoordinator,
  useLiveStatus,
} from '#/components/live/live-event-provider'
import { OfflineBanner, OfflineCapabilitiesNote } from './offline-banner'
import {
  isConnectionDown,
  useLastSyncedAt,
  useOfflineEdits,
} from './offline-edits'
import { useSessionExpired } from '#/lib/session-expiry'
import { UnsyncedChangesList } from './unsynced-changes'

export interface OfflineStatusBannerProps {
  className?: string
  capabilitiesClassName?: string
  /** The workspace allows offline editing (default). When false the banner says edits are not kept. */
  offlineEditingAllowed?: boolean
}

export function OfflineStatusBanner({
  className,
  capabilitiesClassName,
  offlineEditingAllowed = true,
}: OfflineStatusBannerProps) {
  const status = useLiveStatus()
  const coordinator = useLiveCoordinator()
  const lastSyncedAt = useLastSyncedAt(status)
  const { unsyncedCount, refresh } = useOfflineEdits()
  const [mounted, setMounted] = React.useState(false)
  const [retrying, setRetrying] = React.useState(false)
  // The global session banner owns the "session ended" message; this one
  // would wrongly say "keep working" and offer a Retry that cannot succeed.
  const sessionExpired =
    useSessionExpired() || status.lastResetReason === 'session_expired'
  const offline = isConnectionDown(status.status) && !sessionExpired

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // A reconnect can be the moment the device store's drafts become sendable;
  // re-read it so the banner's count reflects the latest stored state.
  React.useEffect(() => {
    if (status.status === 'live') refresh()
  }, [status.status, refresh])

  React.useEffect(() => {
    if (!isConnectionDown(status.status)) setRetrying(false)
  }, [status.status])

  if (!mounted || !offline) return null

  return (
    <>
      <OfflineBanner
        offline
        lastSyncedAt={lastSyncedAt}
        unsyncedCount={unsyncedCount}
        offlineEditingAllowed={offlineEditingAllowed}
        retrying={retrying}
        onRetry={() => {
          setRetrying(true)
          coordinator?.reconnect()
        }}
        className={className}
      />
      {offlineEditingAllowed ? (
        <OfflineCapabilitiesNote className={capabilitiesClassName} />
      ) : null}
    </>
  )
}

/**
 * The inspector's "Unsynced changes" section. Renders nothing while nothing
 * is waiting, so the Properties tab is unchanged in the common case.
 */
export function UnsyncedChangesSection({ className }: { className?: string }) {
  const { edits, loading } = useOfflineEdits()
  if (loading || edits.length === 0) return null
  return <UnsyncedChangesList edits={edits} className={className} />
}
