import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { PlatesPage } from '#/components/plates/plates-page'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** What the plates page reads from the URL. */
interface PlatesSearch {
  run?: string
}

/** The run to show, as the URL states it; anything else reads as absent. */
const PLATES_SEARCH = z.object({ run: z.string().min(1).optional() })

/**
 * Plates: plate reads checked against their own controls, hits and potency,
 * and the worklists that move liquid for them (migration 0104).
 */
export const Route = createFileRoute('/plates')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; the schema decodes every value before use.
  validateSearch: (search: Record<string, unknown>): PlatesSearch =>
    PLATES_SEARCH.catch({}).parse(search),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: PlatesRoute,
})

function PlatesRoute() {
  const { context } = Route.useRouteContext()
  const { run } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <PlatesPage
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
      workspaceId={context.workspace?.id ?? ''}
      runId={run}
      onOpenRun={(id) => void navigate({ search: { run: id } })}
    />
  )
}
