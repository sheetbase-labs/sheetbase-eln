import { createFileRoute } from '@tanstack/react-router'

import { handleDatasetPublish } from '#/lib/extensions/dataset-publish.server'

/**
 * POST /api/plugins/publish-dataset/<datasetId>: send a dataset's rows to
 * another system with a plugin publisher. See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/publish-dataset/$id')({
  server: {
    handlers: {
      POST: ({ request, params }) => handleDatasetPublish(request, params.id),
    },
  },
})
