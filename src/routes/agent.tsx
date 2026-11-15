import { Suspense, lazy } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { Skeleton } from '#/components/ui/skeleton'
import { signInRedirect } from '#/lib/sign-in-redirect'

// The chat library loads when the page opens, not with the shell.
const AgentPage = lazy(() => import('#/components/assist/agent-page'))

/** The chat in the address, when it was saved. */
const agentSearchSchema = z.object({
  c: z.uuid().optional().catch(undefined),
})

type AgentSearch = z.infer<typeof agentSearchSchema>

/**
 * The Agent page: a full-page chat with the assistant and the person's saved
 * chats. The same assistant as the side panel (tools, confirm cards, budget and
 * agent permissions); the open chat is `?c=<id>`.
 */
export const Route = createFileRoute('/agent')({
  validateSearch: (search): AgentSearch => agentSearchSchema.parse(search),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: AgentRoute,
})

function AgentRoute() {
  const { context } = Route.useRouteContext()
  const { c } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-3 p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      }
    >
      <AgentPage
        workspaceId={context.workspace?.id ?? null}
        role={context.workspace?.role ?? null}
        chatId={c ?? null}
        onOpenChat={(id) => void navigate({ search: { c: id }, replace: true })}
        onNewChat={() => void navigate({ search: {}, replace: false })}
      />
    </Suspense>
  )
}
