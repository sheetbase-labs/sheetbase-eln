import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { z } from 'zod'

import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** What the composed sheet page reads from the URL. */
interface ComposedSheetSearch {
  projectId: string | undefined
  commentId?: string
  paste?: boolean
}

export const Route = createFileRoute('/sheets/$sheetId')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; the project id is decoded below and the other values are compared, never used raw.
  validateSearch: (search: Record<string, unknown>): ComposedSheetSearch => {
    const projectId = z.string().safeParse(search.projectId)

    return {
      projectId: projectId.success ? projectId.data : undefined,
      commentId: z.uuid().optional().catch(undefined).parse(search.commentId),
      paste:
        search.paste === true || search.paste === 'true' ? true : undefined,
    }
  },
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth

    if (!context) throw redirect(signInRedirect(location))
    await resolveIdentifierParam({
      entity: 'sheet',
      ref: params.sheetId,
      href: location.href,
    })

    return { context }
  },
  component: lazyRouteComponent(
    () => import('./-sheet-page'),
    'ComposedSheetRoute',
  ),
})
