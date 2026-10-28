import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import type { MaterialTab } from './-materials-page'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/materials')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; tab?: MaterialTab; selected?: string; new?: true } => ({
    new: search.new === true || search.new === 'true' ? true : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    tab:
      search.tab === 'expiring' ||
      search.tab === 'quarantine' ||
      search.tab === 'expired' ||
      search.tab === 'instock'
        ? search.tab
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: lazyRouteComponent(
    () => import('./-materials-page'),
    'MaterialsRoute',
  ),
})
