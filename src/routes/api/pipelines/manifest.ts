import { createFileRoute } from '@tanstack/react-router'
import { handlePipelineManifest } from '#/lib/pipeline-run-requests.server'

/**
 * GET /api/pipelines/manifest?runId=… — the signed, hash-chained manifest of a
 * succeeded run: its pinned definition version, input and output digests, and
 * the signature with the public key that verifies it.
 */
export const Route = createFileRoute('/api/pipelines/manifest')({
  server: {
    handlers: {
      GET: ({ request }) => handlePipelineManifest(request),
    },
  },
})
