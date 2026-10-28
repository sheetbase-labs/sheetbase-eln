import { lazy, Suspense } from 'react'

import { useCollaborationEnabled } from '#/lib/collaboration/collaboration-enabled'

// The Liveblocks client is large and most deployments never turn collaboration
// on, so it loads only when the server says it is enabled.
const LiveblocksBoundary = lazy(() => import('./liveblocks-boundary'))

/**
 * Root collaboration boundary (COLLAB). Mounted once under the app shell;
 * children only ever see collaboration surfaces when the deployment has a
 * Liveblocks secret configured. With collaboration disabled this renders
 * children unchanged — no client is created, no room connects and the
 * Liveblocks code is never downloaded.
 */
export function CollaborationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const enabled = useCollaborationEnabled()
  if (!enabled) return <>{children}</>
  return (
    <Suspense fallback={null}>
      <LiveblocksBoundary>{children}</LiveblocksBoundary>
    </Suspense>
  )
}
