/**
 * EXT-02 host hook: enabled-install contributions for the current caller.
 *
 * Reads the workspace installs through the public EXT-01 client surface
 * and resolves them through the single registry for the caller's role.
 * Loading and failure resolve to empty points — contributed UI degrades
 * to "group absent", never an error surface (the Favourites/Projects
 * palette precedent).
 */
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import type { DataClient } from '#/lib/data-client'
import { extensionQueryKeys, listExtensions } from '#/lib/extensions/client'
import {
  resolveExtensionContributions,
  type ResolvedExtensionPoints,
} from '#/lib/extensions/registry'

export function useExtensionPoints(
  client: DataClient,
  workspaceId: string | null | undefined,
  role: string | null | undefined,
): ResolvedExtensionPoints & { isLoading: boolean } {
  const installsQuery = useQuery({
    queryKey: [...extensionQueryKeys.extensions, workspaceId ?? 'none'],
    queryFn: () => listExtensions(client),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  })
  const points = React.useMemo<ResolvedExtensionPoints>(() => {
    const installs = (installsQuery.data ?? []).filter(
      (install) => !workspaceId || install.workspace_id === workspaceId,
    )
    return resolveExtensionContributions(installs, role)
  }, [installsQuery.data, role, workspaceId])
  return { ...points, isLoading: installsQuery.isLoading }
}
