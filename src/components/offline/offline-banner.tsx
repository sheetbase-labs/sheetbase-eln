'use client'

/**
 * EXP-05.2 — the offline banner (canvas/NbOffline.dc.html).
 *
 * When the live-event stream is offline the banner tells the user three
 * things honestly: they are offline, their edits are held on this device,
 * and when the stream last synced. Retry asks the coordinator to reconnect.
 * Nothing renders while online, so the surface stays quiet when healthy.
 */

import { t } from '#/copy'
import { RefreshCw, WifiOff } from 'lucide-react'

import { cn } from '#/lib/utils'
import { Button } from '#/components/v3/ui/button'
import { Spinner } from '#/components/v3/ui/spinner'
import { formatClockTime } from '#/components/offline/offline-edits'

export interface OfflineBannerProps {
  /** True while the live-event stream is offline. */
  offline: boolean
  /** ISO time the stream last caught up; null until this tab has synced. */
  lastSyncedAt?: string | null
  /** How many edits are waiting on this device. */
  unsyncedCount?: number
  onRetry?: () => void
  /** False when the workspace has turned offline editing off. */
  offlineEditingAllowed?: boolean
  /** True while a reconnect attempt is in flight. */
  retrying?: boolean
  className?: string
}

export function OfflineBanner({
  offline,
  lastSyncedAt = null,
  unsyncedCount = 0,
  onRetry,
  retrying = false,
  offlineEditingAllowed = true,
  className,
}: OfflineBannerProps) {
  if (!offline) return null
  const syncNote = lastSyncedAt
    ? t('notebook.offlineBanner.lastSyncedClocktime', {
        clockTime: formatClockTime(lastSyncedAt),
      })
    : t('notebook.offlineBanner.notSyncedYetOn')
  const pending =
    unsyncedCount > 0
      ? t('notebook.offlineBanner.unsyncedChanges', { count: unsyncedCount })
      : null
  return (
    <div
      role="status"
      data-offline-banner
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning-border bg-warning-wash px-4 py-2 text-label text-warning-text md:px-6',
        className,
      )}
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="text-fg">
        <b className="font-semibold">
          {t('notebook.offlineBanner.youReOffline')}
        </b>{' '}
        {offlineEditingAllowed
          ? t('notebook.offlineBanner.keepWorkingEditsAre')
          : t('notebook.offlineBanner.offlineEditingIsTurned')}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        {pending ? <span data-offline-pending>{pending}</span> : null}
        <span data-offline-last-sync className="text-fg-muted">
          {syncNote}
        </span>
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onRetry}
            disabled={retrying}
            data-offline-retry
          >
            {retrying ? (
              <Spinner size={12} />
            ) : (
              <RefreshCw className="size-3" aria-hidden="true" />
            )}
            {retrying
              ? t('common.states.retrying')
              : t('notebook.offlineBanner.retryNow')}
          </Button>
        ) : null}
      </span>
    </div>
  )
}

/**
 * The "Available offline / Needs a connection" explainer the design places
 * under the document. Static and truthful: it lists what the app can and
 * cannot do without a connection.
 */
export function OfflineCapabilitiesNote({ className }: { className?: string }) {
  return (
    <div
      data-offline-capabilities
      className={cn(
        'max-w-[680px] space-y-1 rounded-md bg-surface-muted px-3 py-2.5 text-label',
        className,
      )}
    >
      <p className="font-medium text-fg">
        {t('notebook.offlineBanner.availableOffline')}
      </p>
      <p className="text-fg-muted">
        {t('notebook.offlineBanner.editingTextAndSheet')}
      </p>
      <p className="pt-1 font-medium text-fg">
        {t('notebook.offlineBanner.needsAConnection')}
      </p>
      <p className="text-fg-muted">
        {t('notebook.offlineBanner.importsReRunningAnalyses')}
      </p>
    </div>
  )
}
