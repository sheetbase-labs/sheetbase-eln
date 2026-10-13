import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The Settings nav labels its first section "General" but points at /settings.
 * /settings/general is the address people reach for, so send it to the real
 * page instead of leaving them on a not-found screen.
 */
export const Route = createFileRoute('/settings/general')({
  beforeLoad: () => {
    throw redirect({ to: '/settings' })
  },
})
