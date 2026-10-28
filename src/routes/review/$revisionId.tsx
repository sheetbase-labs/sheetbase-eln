import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

import { workspaceSearchSchema } from './-workspace-search'

/**
 * REV-007 — Review & Approvals workspace route. The workspace itself lives in
 * `-revision-page` and is loaded on demand.
 */
export const Route = createFileRoute('/review/$revisionId')({
  validateSearch: workspaceSearchSchema,
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    await resolveIdentifierParam({
      entity: 'review',
      ref: params.revisionId,
      href: location.href,
    })
    return { context }
  },
  component: lazyRouteComponent(
    () => import('./-revision-page'),
    'ReviewWorkspaceRoute',
  ),
})
