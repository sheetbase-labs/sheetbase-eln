import { createFileRoute } from '@tanstack/react-router'
import { handlePipelineWebhook } from '#/lib/pipeline-webhook.server'

export const Route = createFileRoute('/api/pipelines/webhook/$definitionId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePipelineWebhook(request, params.definitionId),
      PUT: ({ request, params }) =>
        handlePipelineWebhook(request, params.definitionId),
      POST: ({ request, params }) =>
        handlePipelineWebhook(request, params.definitionId),
    },
  },
})
