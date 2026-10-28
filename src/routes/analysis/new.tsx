import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/analysis/new')({
  validateSearch: (
    search: Record<string, unknown>,
  ): CreateContextSearch & {
    x?: string
    y?: string
    mode?: string
    view?: string
    definition?: string
    snapshot?: string
  } => {
    const next: CreateContextSearch & {
      x?: string
      y?: string
      mode?: string
      view?: string
      definition?: string
      snapshot?: string
    } = parseCreateContext(search)
    if (typeof search.x === 'string') next.x = search.x
    if (typeof search.y === 'string') next.y = search.y
    if (typeof search.view === 'string') next.view = search.view
    if (typeof search.definition === 'string' && search.definition)
      next.definition = search.definition
    // A snapshot of `dataset` to read instead of its live rows.
    if (typeof search.snapshot === 'string' && search.snapshot)
      next.snapshot = search.snapshot
    if (
      search.mode === 'chart' ||
      search.mode === 'analyse' ||
      search.mode === 'compare'
    ) {
      next.mode = search.mode
    }
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
