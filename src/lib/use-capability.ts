import { useRouteContext } from '@tanstack/react-router'
import { hasCapability } from '#/lib/capability'
import type { Capability } from '#/lib/capability'

/** Whether the signed-in person's workspace role holds a capability, for a
 * screen that decides which write controls to offer. */
export function useHasCapability(capability: Capability): boolean {
  const { auth } = useRouteContext({ from: '__root__' })
  return hasCapability(auth?.workspace?.role, capability)
}
