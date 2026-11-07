import { createFileRoute, redirect } from '@tanstack/react-router'

import { CampaignView } from '#/components/campaigns/campaign-view'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/campaigns/$campaignId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: Page,
})

function Page() {
  const { context } = Route.useRouteContext()
  const { campaignId } = Route.useParams()
  return (
    <CampaignView
      recordId={campaignId}
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
