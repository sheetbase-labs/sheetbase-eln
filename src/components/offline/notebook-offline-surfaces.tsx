'use client'

import { useQuery } from '@tanstack/react-query'

import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import type { OfflineEditScope, OfflineEditStore } from '#/lib/offline/store'
import { OfflineReplayRunner } from './offline-replay'
import { OfflineStatusBanner } from './offline-status'

/**
 * J-SET-08: the notebook's offline surfaces, gated on the workspace's
 * "Allow offline editing" setting. The setting is read once the notebook loads
 * (while online), so it is still known when the connection drops. When it is
 * off, the banner says so and asks the person to reconnect, and the replay
 * runner is not mounted: nothing is promised, kept or replayed on this device.
 * Drafts already on the device are never deleted; they stay listed in the
 * inspector.
 */
export function NotebookOfflineSurfaces({
  store,
  scope,
  className,
  capabilitiesClassName,
  replayClassName,
}: {
  store: OfflineEditStore
  scope: OfflineEditScope
  className?: string
  capabilitiesClassName?: string
  replayClassName?: string
}) {
  const general = useQuery({
    queryKey: [...workspaceGeneralQueryKey, 'offline-gate'],
    queryFn: () => fetchWorkspaceGeneral(),
    staleTime: Infinity,
  })
  // Unknown (not loaded, or the read failed) is treated as allowed, so a
  // failed read never silently removes the offline safety net.
  const allowed = general.data?.offlineEditingAllowed !== false
  return (
    <>
      <OfflineStatusBanner
        className={className}
        capabilitiesClassName={capabilitiesClassName}
        offlineEditingAllowed={allowed}
      />
      {allowed ? (
        <OfflineReplayRunner
          store={store}
          scope={scope}
          className={replayClassName}
        />
      ) : null}
    </>
  )
}
