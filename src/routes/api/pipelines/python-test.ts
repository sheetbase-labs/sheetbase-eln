import { createFileRoute } from '@tanstack/react-router'
import { handlePythonTestRun } from '#/lib/pipeline-python-test.server'

/**
 * POST /api/pipelines/python-test — run a Python step on sample rows without
 * saving or recording anything. The code runs in the same isolated container a
 * pipeline run uses; see docs/operations/pipeline-python.md.
 */
export const Route = createFileRoute('/api/pipelines/python-test')({
  server: {
    handlers: {
      POST: ({ request }) => handlePythonTestRun(request),
    },
  },
})
