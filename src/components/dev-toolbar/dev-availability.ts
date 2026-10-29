/**
 * Who may see the toolbar, given whether it is switched on. Development builds
 * show it to anyone running them; a production build only to workspace owners
 * and admins.
 */
export function devToolbarAvailable({
  dev,
  role,
  enabled,
}: {
  dev: boolean
  role: string | null | undefined
  enabled: boolean
}): boolean {
  if (dev) return enabled
  return enabled && (role === 'owner' || role === 'admin')
}
