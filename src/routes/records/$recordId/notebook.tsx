import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * ELN-004: the deep-linkable canonical record route. The page itself lives in
 * `-notebook-page` and is loaded on demand, so the editor stack stays out of
 * the first load.
 */
export const Route = createFileRoute('/records/$recordId/notebook')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: lazyRouteComponent(
    () => import('./-notebook-page'),
    'RecordNotebookRoute',
  ),
})
