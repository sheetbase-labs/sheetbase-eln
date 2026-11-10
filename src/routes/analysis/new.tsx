import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import { z } from 'zod'

import { parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** The analysis screen's own search params, on top of the shared create context. */
interface AnalysisSearch {
  x?: string
  y?: string
  mode?: string
  view?: string
  definition?: string
  snapshot?: string
}

/**
 * The raw URL values for the analysis params. A value the screen does not
 * read is ignored, exactly as a hand-written type check would skip it.
 */
const analysisSearch = z.looseObject({
  x: z.string().optional().catch(undefined),
  y: z.string().optional().catch(undefined),
  view: z.string().optional().catch(undefined),
  definition: z.string().min(1).optional().catch(undefined),
  // A snapshot of `dataset` to read instead of its live rows.
  snapshot: z.string().min(1).optional().catch(undefined),
  mode: z.enum(['chart', 'analyse', 'compare']).optional().catch(undefined),
})

export const Route = createFileRoute('/analysis/new')({
  validateSearch: (search): CreateContextSearch & AnalysisSearch => {
    const next: CreateContextSearch & AnalysisSearch =
      parseCreateContext(search)

    const extra = analysisSearch.parse(search)

    if (extra.x !== undefined) next.x = extra.x

    if (extra.y !== undefined) next.y = extra.y

    if (extra.view !== undefined) next.view = extra.view

    if (extra.definition !== undefined) next.definition = extra.definition

    if (extra.snapshot !== undefined) next.snapshot = extra.snapshot

    if (extra.mode !== undefined) next.mode = extra.mode

    return next
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) throw redirect(signInRedirect(location))

    return { context }
  },
  component: lazyRouteComponent(
    () => import('./-analysis-studio-page'),
    'AnalysisStudio',
  ),
})
