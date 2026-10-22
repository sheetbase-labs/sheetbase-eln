import { createFileRoute } from '@tanstack/react-router'
import { handlePipelineTryDraft } from '#/lib/pipeline-run-requests.server'

/**
 * POST /api/pipelines/try-draft — run the configuration open in the editor on
 * chosen input Dataset Versions and answer with a preview, recording nothing.
 * See docs/subsystems/pipelines.md.
 */
export const Route = createFileRoute('/api/pipelines/try-draft')({
  server: {
    handlers: {
      POST: ({ request }) => handlePipelineTryDraft(request),
    },
  },
})
