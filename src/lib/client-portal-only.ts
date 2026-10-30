/**
 * A client account (`client_viewer`) belongs in the client portal. Every other
 * page is the internal app, so a client who opens one is sent back to the
 * portal instead of being shown navigation and records meant for the team.
 * The database already refuses their reads; this keeps the interface honest.
 */
const CLIENT_PATHS = ['/client-portal', '/sign-in', '/accept-invitation']

export function clientPortalRedirect(
  role: string | null | undefined,
  pathname: string,
): { to: '/client-portal' } | null {
  if (role !== 'client_viewer') return null
  const allowed = CLIENT_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
  return allowed ? null : { to: '/client-portal' }
}
