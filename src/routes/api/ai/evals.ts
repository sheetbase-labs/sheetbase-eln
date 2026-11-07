import { createFileRoute } from '@tanstack/react-router'

import { handleAiEvalRun } from '#/lib/ai-evals-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/ai/evals')({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) =>
        handleAiEvalRun(request, realSessionAuthDeps),
    },
  },
})
