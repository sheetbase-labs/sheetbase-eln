import { createFileRoute } from '@tanstack/react-router'
import { handlePipelineExecute } from '#/lib/pipeline-execute.server'

/**
 * POST /api/pipelines/execute — execute a started Pipeline run server-side.
 * The run must already exist (api.start_pipeline_run) with status running.
 * The transform SQL runs in the sandboxed pipeline_worker role; the run is
 * completed or failed with the run actor's identity through the canonical
 * RPCs. See docs/pipelines.md.
 */
export const Route = createFileRoute('/api/pipelines/execute')({
  server: {
    handlers: {
      POST: ({ request }) => handlePipelineExecute(request),
    },
  },
})
