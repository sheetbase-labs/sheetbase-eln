import { createFileRoute, redirect } from '@tanstack/react-router'

import { CampaignsPage } from '#/components/campaigns/campaigns-page'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/campaigns/')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: Page,
})

function Page() {
  const { context } = Route.useRouteContext()
  return (
    <CampaignsPage
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
      canEditModels={hasCapability(context.workspace?.role, 'schema.edit')}
    />
  )
}
