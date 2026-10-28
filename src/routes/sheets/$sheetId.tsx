import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { z } from 'zod'

import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/sheets/$sheetId')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    projectId: string | undefined
    commentId?: string
    paste?: boolean
  } => ({
    projectId:
      typeof search.projectId === 'string' ? search.projectId : undefined,
    commentId: z.uuid().optional().catch(undefined).parse(search.commentId),
    paste: search.paste === true || search.paste === 'true' ? true : undefined,
  }),
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
