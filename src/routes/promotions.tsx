import { t } from '#/copy'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { ColumnPromotionsPanel } from '#/components/v3/sheets/column-promotions-panel'
import { PageHeader } from '#/components/v3/ui/layout'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** Where a column promotion request from the Inbox opens: every promotion
 * still waiting, with Approve, Return and Apply on each. */
export const Route = createFileRoute('/promotions')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: PromotionsPage,
})

function PromotionsPage() {
  const { context } = Route.useRouteContext()
  return (
    <div className="px-4 py-4 md:px-6">
      <PageHeader
        title={t('notebook.promotions.title')}
        meta={t('notebook.promotions.meta')}
      />
      <ColumnPromotionsPanel
        role={context.workspace?.role}
        user={{ id: context.user.id, name: context.user.name }}
      />
    </div>
  )
}
