import { createFileRoute, redirect } from '@tanstack/react-router'

import { PluginPage } from '#/components/extensions/plugin-page'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** A page a plugin adds to the sidebar. See docs/development/build-a-plugin.md. */
export const Route = createFileRoute('/plugins/$key/$id')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) throw redirect(signInRedirect(location))

    return { context }
  },
  component: PluginSidebarPage,
})

function PluginSidebarPage() {
  const { key, id } = Route.useParams()

  return <PluginPage extensionKey={key} id={id} kind="pages" />
}
