import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (roadmap-4/ui-app3): submitted evidence. The frozen revision reads
 * exactly as it was signed and never changes; when the live record has moved on,
 * that is stated and the way forward is an amendment, never an edit.
 *
 * MOB-02.4: below the phone breakpoint the wide order/block/content table and
 * the inspector's integrity facts become one readable column (the blocks as
 * wrapping rows, the hash stated inline), while the amendment stays a desktop
 * action and the page says so. */
export const Route = createFileRoute('/evidence/$revisionId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: lazyRouteComponent(
    () => import('./-evidence-page'),
    'EvidencePage',
  ),
})
