import * as React from 'react'

/**
 * Server-provided capability flag threaded through the router context.
 * Defaults to disabled so public/SSR shells never open a connection; the
 * root route sets it once from `auth.collaborationEnabled`.
 */
export const CollaborationEnabledContext = React.createContext(false)

/** True when the current deployment has collaboration enabled. */
export function useCollaborationEnabled(): boolean {
  return React.useContext(CollaborationEnabledContext)
}
