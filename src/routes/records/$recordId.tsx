import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import {
  redirectExperimentRecord,
  resolveIdentifierParam,
} from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * EXP-01.1 — the record page is a layout: the header and tabs live in the
 * child routes, and each tab is its own URL. The parent only resolves auth and
 * passes the context down. An experiment has one page, so its record URL
 * redirects to `/experiments/$expId` here, before anything renders.
 */
export const Route = createFileRoute('/records/$recordId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    await resolveIdentifierParam({
      entity: 'record',
      ref: params.recordId,
      href: location.href,
    })
    await redirectExperimentRecord({
      ref: params.recordId,
      pathname: location.pathname,
      search: location.searchStr,
      hash: location.hash ? `#${location.hash.replace(/^#/, '')}` : '',
    })
    return { context }
  },
  component: RecordLayout,
})

function RecordLayout() {
  return <Outlet />
}
