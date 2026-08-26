import {
  LiveblocksProvider,
  collaborationClientOptions,
  useCollaborationEnabled,
} from '#/lib/collaboration/liveblocks.config'

/**
 * Root collaboration boundary (COLLAB). Mounted once under the app shell;
 * children only ever see collaboration surfaces when the deployment has a
 * Liveblocks secret configured. With collaboration disabled this renders
 * children unchanged — no client is created and no room connects.
 */
export function CollaborationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const enabled = useCollaborationEnabled()
  if (!enabled) return <>{children}</>
  return (
    <LiveblocksProvider {...collaborationClientOptions}>
      {children}
    </LiveblocksProvider>
  )
}
