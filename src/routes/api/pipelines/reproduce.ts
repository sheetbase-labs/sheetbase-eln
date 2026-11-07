import { createFileRoute } from '@tanstack/react-router'
import { handlePipelineReproduce } from '#/lib/pipeline-run-requests.server'

/**
 * POST /api/pipelines/reproduce — re-run a finished run from the version,
 * parameters and inputs it pinned, into scratch, and answer with whether it
 * matches. See docs/api/provenance-api.md.
 */
export const Route = createFileRoute('/api/pipelines/reproduce')({
  server: {
    handlers: {
      POST: ({ request }) => handlePipelineReproduce(request),
    },
  },
})
