import * as React from 'react'

import { useDevFlag } from '#/lib/dev-flags'

/**
 * Server-provided capability flag threaded through the router context.
 * Defaults to disabled so public/SSR shells never open a connection; the
 * root route sets it once from `auth.collaborationEnabled`.
 */
export const CollaborationEnabledContext = React.createContext(false)

/** True when the current deployment has collaboration enabled. */
export function useCollaborationEnabled(): boolean {
  const deployed = React.useContext(CollaborationEnabledContext)
  // The dev toolbar can switch it off for this browser; never on.
  const devOn = useDevFlag('collaboration')
  return deployed && devOn
}
