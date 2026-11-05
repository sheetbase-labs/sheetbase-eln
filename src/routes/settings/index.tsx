import { createFileRoute, redirect } from '@tanstack/react-router'

import { settingsHomePath } from '#/components/settings/settings-nav'
import { settingsAccessOf } from '#/lib/settings-access'

/**
 * The entry point to Settings: opens the first section the signed-in role may
 * open, so an admin lands on General and everyone else on their own profile.
 */
export const Route = createFileRoute('/settings/')({
  beforeLoad: ({ context }) => {
    const { workspace } = context.context
    throw redirect({
      to: settingsHomePath(workspace?.role, settingsAccessOf(workspace)),
    })
  },
})
