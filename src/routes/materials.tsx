import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { z } from 'zod'

import { tabs as materialsTabs } from './-materials-page-model'
import type { MaterialTab } from './-materials-page'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** The screen's tab, as the URL names it. */
const tabField = z.enum(materialsTabs)

/** A search field the URL carries as text. */
const textField = z.string()

/** The shell's one-shot New command, as a link or a typed URL spells it. */
const newField = z.union([z.literal(true), z.literal('true')])

/** The materials screen's search, as the URL carries it. */
interface MaterialsSearch {
  q?: string
  tab?: MaterialTab
  selected?: string
  new?: true
}

export const Route = createFileRoute('/materials')({
  validateSearch: (search): MaterialsSearch => ({
    new: newField.safeParse(search.new).success ? true : undefined,
    q: textField.safeParse(search.q).data,
    selected: textField.safeParse(search.selected).data,
    tab: tabField.safeParse(search.tab).data,
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
