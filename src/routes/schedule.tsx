import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { parseCreateContext } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/schedule')({
  // A deep link may ask to book one instrument (the registry inspector's Book
  // action): `?book=<instrumentId>` opens the dialog with it preselected.
  // `?experiment=` names the experiment the booking is for (it starts the
  // title) and `?returnTo=` is where to go once the person has booked or
  // dismissed the dialog.
  validateSearch: (
    search: Record<string, unknown>,
  ): { book?: string; experiment?: string; returnTo?: string } => {
    const { experiment, returnTo } = parseCreateContext(search)
    return {
      ...(typeof search.book === 'string' && search.book
        ? { book: search.book }
        : {}),
      ...(experiment ? { experiment } : {}),
      ...(returnTo ? { returnTo } : {}),
    }
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: lazyRouteComponent(() => import('./-schedule-page'), 'Schedule'),
})
