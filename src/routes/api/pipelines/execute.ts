import { createFileRoute } from '@tanstack/react-router'
import {
  handlePipelineExecute,
  handlePipelineRunState,
} from '#/lib/pipeline-run-requests.server'

/**
 * POST /api/pipelines/execute — queue a started Pipeline run (or the
 * continuation of a waiting one after a decision) for a worker. The request
 * returns at once; nothing executes inside it. The run must already exist
 * (api.start_pipeline_run) with status running.
 *
 * GET /api/pipelines/execute?runId=… — the run and its queue state, so a client
 * can follow it to the end.
 *
 * Workers run the transform SQL on the sandbox login and complete or fail the
 * run with the run actor's identity through the canonical RPCs. See
 * docs/subsystems/pipelines.md.
 */
export const Route = createFileRoute('/api/pipelines/execute')({
  server: {
    handlers: {
      POST: ({ request }) => handlePipelineExecute(request),
      GET: ({ request }) => handlePipelineRunState(request),
    },
  },
})
